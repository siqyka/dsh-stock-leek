/**
 * 共享逻辑漂移检测：node test/shared-drift.mjs
 *
 * 背景：client.js 由 DSH 的 ModuleLoader 以「惰性 CJS 表」加载，
 * factory 内的 require 只接受无 "/" 无 ":" 的裸包名（见 host 的 exactPackageSpecifier），
 * 因此 client.js **无法** import 共享模块，只能保留一份内联副本。
 *
 * 代价就是存在「改了 shared.js 忘了改 client.js」的风险。
 * 本测试加载 client.js 的真实源码，把它的内联纯函数与 shared.js 的实现逐一对拍，
 * 任何一侧单独改动都会在这里暴露。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as shared from "../lib/shared.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = readFileSync(join(root, "client.js"), "utf8");

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
    fails++;
  }
}

/**
 * 从 client.js 源码里抠出某个函数体并 eval 成真函数。
 * 这样测的是**线上真正执行的那份代码**，而不是我们在测试里重写的替身。
 */
function extractFn(name, deps) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) return null;
  // 花括号配平（忽略字符串里的花括号：源码里这些函数里没有含 { 的字符串字面量）
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(start, i + 1);
  try {
    // 部分函数依赖同文件里的其它函数（闭包依赖）→ 显式注入，否则单独 eval 会 ReferenceError
    const depNames = Object.keys(deps || {});
    const pre = depNames.map((k) => "const " + k + " = __deps__[" + JSON.stringify(k) + "];").join("");
    // eslint-disable-next-line no-new-func
    return new Function("__deps__", "return (function(){" + pre + " return (" + body + "); })()")(deps || {});
  } catch {
    return null;
  }
}

console.log("== shared.js ↔ client.js 一致性 ==");

const TODAY = (() => {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
})();

// 常量
check("MA_ALL 一致", extractConst("MA_ALL") === shared.MA_ALL.join(), {
  client: extractConst("MA_ALL"),
  shared: shared.MA_ALL.join(),
});
check("MA_DEF 一致", extractConst("MA_DEF") === shared.MA_DEF.join(), {
  client: extractConst("MA_DEF"),
  shared: shared.MA_DEF.join(),
});

function extractConst(name) {
  const m = new RegExp("const " + name + " = \\[([^\\]]*)\\]").exec(src);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join();
}

// 纯格式化函数：逐输入对拍
const FORMATTERS = [
  ["fmtPrice", [1286, 1286.5, 12.345, 0.001, 12345, NaN, null, 99.999]],
  ["fmtPct", [1.234, -1.234, 0, NaN, null]],
  ["fmtTurn", [1.234, -0.005, NaN]],
  ["fmtQty", [1234, 12345, 1.2e8, 0, -5, NaN]],
  ["fmtMoney", [1234, 1.2e4, 1.2e8, 1.2e12, 0, NaN]],
  ["fmtTime", ["20261014153000", "15:30:00", "", null]],
  ["fmtSigned", [1234, -1234, 1.2e5, -1.2e8, 0]],
  ["fmtMoneyExact", [1234.56, -1234.56, 0, NaN]],
  ["fmtExact", [1234.56, -0.4, NaN]],
  ["displayCode", ["sh600519", "hk00700", "usAAPL", "sz300750", "", null]],
  ["marketLabel", ["sh600519", "hk00700", "usAAPL", "bj430047", "", null]],
  // 曲线刷新 tick：修复「盈亏走势不跟随设置刷新间隔」时引入的，必须两端一致。
  // 样本用 [updatedAt, pollMs] 成对给出——第二参数决定窗口大小，
  // 只测单参会漏掉「窗口被写死一分钟」这个原始 bug。
  ["curveRefreshTick", [
    [0, undefined], [1, undefined], [59999, undefined], [60000, undefined], [60001, undefined],
    [Date.now(), 5000], [Date.now(), 3000], [Date.now(), 30000], [Date.now(), 60000],
    [1000000, 1000], [1000000, 2000], [1000000, 5000],
    [NaN, 5000], [null, 5000], [-1, 5000], ["x", 5000],
    [Date.now(), NaN], [Date.now(), 0], [Date.now(), 500], [Date.now(), "6000"],
  ]],
];

for (const [name, samples] of FORMATTERS) {
  const clientFn = extractFn(name);
  if (!clientFn) {
    check(name + " 在 client.js 中可提取", false);
    continue;
  }
  const diffs = [];
  for (const s of samples) {
    // fmtMoney/fmtQty 的第二参是 code，两边都测 A股(手/万元) 与 港股(股/元)
    const argSets = name === "fmtMoney" || name === "fmtQty" ? [[s, "sh600519"], [s, "hk00700"], [s, undefined]] : [[s]];
    // 多参函数（curveRefreshTick）的样本写成 [a, b]，需展开成两个实参；
    // 单参函数的样本若是数组，本身就是一个入参（例如 displayCode("sh600519")）。
    // 用「函数形参个数」区分，避免把单参的数组入参误拆。
    const arity = clientFn.length;
    const effective = arity > 1 && Array.isArray(s) ? [s] : argSets;
    for (const args of effective) {
      let a, b;
      try {
        a = clientFn(...args);
      } catch (e) {
        a = "ERR:" + e.message;
      }
      try {
        b = shared[name](...args);
      } catch (e) {
        b = "ERR:" + e.message;
      }
      if (String(a) !== String(b)) diffs.push({ args, client: a, shared: b });
    }
  }
  check(name + " 与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 3));
}

// curveRefreshTick 的**语义**（不只是两端一致）：
// 上面那段对拍只能保证 client.js 与 shared.js 写的一样，
// 两边同时写错（比如都去掉时间分桶、或窗口都写死 60s）它照样绿。
// 所以这里直接对拍函数应满足的性质。
{
  const T = 1800000000000; // 固定基准，避免用 Date.now() 让断言随时间漂移
  const tick = shared.curveRefreshTick;
  check("同一窗口内：不同时间戳映射到同一 tick", tick(T, 5000) === tick(T + 4000, 5000), {
    a: tick(T, 5000), b: tick(T + 4000, 5000),
  });
  check("跨过窗口后 tick 推进", tick(T, 5000) !== tick(T + 6000, 5000), {
    a: tick(T, 5000), b: tick(T + 6000, 5000),
  });
  // 用户报的 bug：窗口写死 60s，刷新间隔调 3s 也不生效
  check("窗口取自 pollMs 而非固定值", tick(T, 3000) !== tick(T, 60000), {
    p3000: tick(T, 3000), p60000: tick(T, 60000),
  });
  check("pollMs 越细、tick 越密（3s 比 30s 更早变化）", tick(T, 3000) !== tick(T, 30000), {
    p3000: tick(T, 3000), p30000: tick(T, 30000),
  });
  check("无效时间戳/间隔回落到确定的兜底值", tick(0, 5000) === 0 && tick(NaN, 5000) === 0 && tick(T) === tick(T, 5000), {
    zero: tick(0, 5000), nan: tick(NaN, 5000), fallback: tick(T),
  });
}

// clamp：client.js 与 shared.js 各一份
{
  const cf = extractFn("clamp");
  const diffs = [];
  for (const args of [[5, 1, 10], [-1, 0, 1], [11, 1, 10], [0.5, 0, 1]]) {
    if (String(cf(...args)) !== String(shared.clamp(...args))) diffs.push(args);
  }
  check("clamp 与 shared.js 行为一致", diffs.length === 0, diffs);
}

// todayPnl：盈亏口径是这个项目最容易被改错的逻辑，必须严格对拍
{
  // client.js 的 todayPnl 依赖同文件的 quoteDate，两边用同一个实现保证只比对算法本身
  const clientQuoteDate = extractFn("quoteDate");
  const cf = extractFn("todayPnl", { quoteDate: clientQuoteDate });
  check("todayPnl 在 client.js 中可提取", !!cf);
  if (cf) {
    const cases = [
      // 无当日变动 → (现价-昨收)*股数
      [{ code: "sh600519", qty: 100, txns: [] }, { price: 100, yestclose: 95 }, 500],
      // 无当日变动，昨收 0
      [{ code: "sh600519", qty: 100, txns: [] }, { price: 100, yestclose: 0 }, 10000],
      // 无当日变动，缺昨收 → 0
      [{ code: "sh600519", qty: 100, txns: [] }, { price: 100, yestclose: null }, 0],
      // 当日买入 100 股 @100（有变动）→ 昨仓 = 200-100 = 100
      [{ code: "sh600519", qty: 200, txns: [{ date: TODAY, qty: 100, price: 100 }] }, { price: 110, yestclose: 90 }, 3000],
      // 当日买入但无昨收 → 返回 0
      [{ code: "sh600519", qty: 200, txns: [{ date: TODAY, qty: 100, price: 100 }] }, { price: 110, yestclose: null }, 0],
      // 当日买入+卖出混合：昨仓 100，卖出 50@120 买入 100@100
      [
        { code: "sh600519", qty: 150, txns: [{ date: TODAY, qty: 100, price: 100 }, { date: TODAY, qty: -50, price: 120 }] },
        { price: 110, yestclose: 90 },
        150 * 110 + 50 * 120 - 100 * 100 - 100 * 90,
      ],
      // 非今日的变动应被忽略
      [{ code: "sh600519", qty: 100, txns: [{ date: "2000-01-01", qty: 50, price: 1 }] }, { price: 100, yestclose: 95 }, 500],
    ];
    const diffs = [];
    for (const [p, q, expect] of cases) {
      let a, b;
      try {
        a = cf(p, q);
      } catch (e) {
        a = "ERR:" + e.message;
      }
      try {
        b = shared.todayPnl(p, q);
      } catch (e) {
        b = "ERR:" + e.message;
      }
      if (String(a) !== String(b)) diffs.push({ p, q, client: a, shared: b });
      if (expect !== null && a !== expect) diffs.push({ expect, actual: a, p });
    }
    check("todayPnl 与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 3));
  }
}

// 关键口径自检：确保 shared.js 自身语义没被改坏（防止两边一起错）
{
  const p = { code: "sh600519", qty: 200, txns: [{ date: TODAY, qty: 100, price: 100 }] };
  // 昨仓 100 股 × 昨收 90 = 9000；现持仓 200 × 110 = 22000；今日买入 100×100 = 10000
  // → 22000 - 10000 - 9000 = 3000
  const v = shared.todayPnl(p, { price: 110, yestclose: 90, time: "" });
  check("todayPnl 现金流口径自检（买入不被算成盈亏）", v === 3000, v);
}

// realizedPnl：清仓后累计盈亏的接住逻辑，两端必须一致且口径正确
{
  const clientQuoteDate = extractFn("quoteDate");
  const cf = extractFn("realizedPnl", { quoteDate: clientQuoteDate });
  check("realizedPnl 在 client.js 中可提取", !!cf);
  if (cf) {
    const cases = [
      // 昨仓 100 成本 10，今日全部 @12 卖出 → 已实现 1200 - 0 - 100×10 = 200
      [{ code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: -100, price: 12 }] }, { price: 12, yestclose: 10 }, 200],
      // 当日买入又清仓：昨仓 0 → 1200 - 1000 - 0 = 200
      [{ code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: 100, price: 10 }, { date: TODAY, qty: -100, price: 12 }] }, { price: 12, yestclose: 10 }, 200],
      // 亏损清仓：成本 10 卖 8 → 800 - 0 - 100×10 = -200
      [{ code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: -100, price: 8 }] }, { price: 8, yestclose: 10 }, -200],
      // 无当日成交 → 0
      [{ code: "sh600519", qty: 0, cost: 10, txns: [] }, { price: 12, yestclose: 10 }, 0],
      // 非今日成交 → 0
      [{ code: "sh600519", qty: 0, cost: 10, txns: [{ date: "2000-01-01", qty: -100, price: 12 }] }, { price: 12, yestclose: 10 }, 0],
      // 还有持仓时按昨仓折算（成本 10，持 100 卖 50@12）→ 600 - 0 - 100×10 = -400
      [{ code: "sh600519", qty: 50, cost: 10, txns: [{ date: TODAY, qty: -50, price: 12 }] }, { price: 12, yestclose: 10 }, -400],
      // 无成本 → 退化为纯现金流
      [{ code: "sh600519", qty: 0, txns: [{ date: TODAY, qty: -100, price: 12 }] }, { price: 12, yestclose: 10 }, 1200],
      // 无行情 → 0
      [{ code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: -100, price: 12 }] }, null, 0],
    ];
    const diffs = [];
    for (const [p, q, expect] of cases) {
      let a, b;
      try {
        a = cf(p, q);
      } catch (e) {
        a = "ERR:" + e.message;
      }
      try {
        b = shared.realizedPnl(p, q);
      } catch (e) {
        b = "ERR:" + e.message;
      }
      if (String(a) !== String(b)) diffs.push({ p, client: a, shared: b });
      if (expect !== null && a !== expect) diffs.push({ expect, actual: a, p });
    }
    check("realizedPnl 与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 3));
  }
}

// computeEarnings / earningsDetail：两端各自的口径自检（防止两边一起错）
{
  const clientQuoteDate = extractFn("quoteDate");
  const ce = extractFn("computeEarnings", { quoteDate: clientQuoteDate, todayPnl: shared.todayPnl, realizedPnl: shared.realizedPnl });
  const ed = extractFn("earningsDetail", { quoteDate: clientQuoteDate, todayPnl: shared.todayPnl, realizedPnl: shared.realizedPnl, displayCode: shared.displayCode });
  check("computeEarnings 在 client.js 中可提取", !!ce);
  check("earningsDetail 在 client.js 中可提取", !!ed);
  const q = { sh600519: { price: 12, yestclose: 10, time: "" } };
  const closedPos = { code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: -100, price: 12 }] };
  if (ce) {
    const r = ce({ positions: [closedPos] }, q);
    check("computeEarnings 清仓后仍计今日盈亏", r.today === 200, r.today);
    check("computeEarnings 清仓后累计不归零", r.pnl === 200, r.pnl);
    check("computeEarnings 清仓后 has 仍为真（界面要展示）", r.has === true, r.has);
    const r2 = ce({ positions: [closedPos] }, {});
    check("computeEarnings 无行情时不计入", r2.today === 0 && r2.pnl === 0, { today: r2.today, pnl: r2.pnl });
  }
  if (ed) {
    const d = ed({ positions: [closedPos] }, q);
    check("earningsDetail 清仓行仍出现", d.today === 200 && d.rows.length === 1, { today: d.today, rows: d.rows.length });
    check("earningsDetail 清仓行标 closed", !!(d.rows[0] && d.rows[0].closed), d.rows[0]);
  }
}

// isStaleClosedPosition：当日清仓保留、下一交易日移除。两端一致 + 语义正确
{
  const cf = extractFn("isStaleClosedPosition");
  check("isStaleClosedPosition 在 client.js 中可提取", !!cf);
  if (cf) {
    const cases = [
      // 清仓当日：行情日期 == 清仓日 → 保留
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: -100, price: 12 }] }, "2026-10-15", false],
      // 下一个交易日：行情日期 > 清仓日 → 移除
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: -100, price: 12 }] }, "2026-10-16", true],
      // 周末：行情日期仍停在周五 → 不删（关键：本地日期会误删，这里不能）
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-16", qty: -100, price: 12 }] }, "2026-10-16", false],
      // 还有持仓 → 永不视为过期
      [{ code: "sh600519", qty: 100, txns: [{ date: "2026-10-15", qty: -100, price: 12 }] }, "2026-10-20", false],
      // 无成交记录（手动改股数为 0）→ 保留，不臆断
      [{ code: "sh600519", qty: 0, txns: [] }, "2026-10-20", false],
      [{ code: "sh600519", qty: 0 }, "2026-10-20", false],
      // 拿不到行情日期（停牌/未订阅）→ 保留，不误删
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: -100, price: 12 }] }, "", false],
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: -100, price: 12 }] }, null, false],
      // 多笔成交：看**最后一笔**的日期，不是第一笔
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: 100, price: 10 }, { date: "2026-10-15", qty: -100, price: 12 }] }, "2026-10-15", false],
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-15", qty: 100, price: 10 }, { date: "2026-10-14", qty: -100, price: 12 }] }, "2026-10-16", true],
      // 乱序 txns 也要取最大日期
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-10-14", qty: 100, price: 10 }, { date: "2026-10-15", qty: -100, price: 12 }] }, "2026-10-15", false],
      // null / undefined 持仓
      [null, "2026-10-20", false],
      [undefined, "2026-10-20", false],
      // 跨长假（国庆）：行情日期从 09-30 跳到 10-09 → 期间不删
      [{ code: "sh600519", qty: 0, txns: [{ date: "2026-09-30", qty: -100, price: 12 }] }, "2026-09-30", false],
    ];
    const diffs = [];
    for (const [p, ref, expect] of cases) {
      let a, b;
      try { a = cf(p, ref); } catch (e) { a = "ERR:" + e.message; }
      try { b = shared.isStaleClosedPosition(p, ref); } catch (e) { b = "ERR:" + e.message; }
      if (String(a) !== String(b)) diffs.push({ p, ref, client: a, shared: b });
      if (expect !== null && a !== expect) diffs.push({ expect, actual: a, p, ref });
    }
    check("isStaleClosedPosition 与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 3));
  }
}

// 清仓（qty=0）口径自检：今日已实现盈亏不能因为"没持仓"而消失
{
  // 昨仓 100 股、成本 10；今天全部 @12 卖出 → 清仓
  //   今日 = 0×现价 + 1200(卖出) − 0(买入) − 100×昨收
  const closed = { code: "sh600519", qty: 0, cost: 10, txns: [{ date: TODAY, qty: -100, price: 12 }] };
  const today = shared.todayPnl(closed, { price: 12, yestclose: 10, time: "" });
  check("清仓股的今日盈亏 = 当日卖出现金流", today === 200, today);

  // 汇总层：清仓股必须计入 today（这是用户报的 bug）
  const cfg = { positions: [closed] };
  const earn = shared.computeEarnings(cfg, { sh600519: { price: 12, yestclose: 10, time: "" } });
  check("清仓后汇总仍计入该股今日盈亏", earn.today === 200, earn.today);
  check("清仓后市值/成本归零", earn.value === 0 && earn.cost === 0, { value: earn.value, cost: earn.cost });

  // 累计盈亏必须在清仓瞬间保持连续：
  //   卖出前 (12−10)×100 = 200 ；清仓后已实现 = 1200 − 0 − 100×成本10 = 200
  check("清仓前后累计盈亏连续（不跳变）", earn.pnl === 200, earn.pnl);

  // 明细层同样不能丢
  const d = shared.earningsDetail(cfg, { sh600519: { price: 12, yestclose: 10, time: "" } });
  check("清仓后在明细里仍出现该股今日盈亏", d.today === 200 && d.rows.length === 1, { today: d.today, rows: d.rows.length });
  check("清仓行带 closed 标记供前端显示「已清仓」", !!(d.rows[0] && d.rows[0].closed), d.rows[0]);

  // 昨仓清仓（今天买入又卖出）也要算对
  const intraday = { code: "sh600519", qty: 0, cost: 10, txns: [
    { date: TODAY, qty: 100, price: 10 }, { date: TODAY, qty: -100, price: 12 },
  ] };
  const e2 = shared.computeEarnings({ positions: [intraday] }, { sh600519: { price: 12, yestclose: 10, time: "" } });
  check("当日买入又清仓：今日 +200 且无昨仓残留", e2.today === 200 && e2.pnl === 200, { today: e2.today, pnl: e2.pnl });

  // 没行情的照旧整只跳过（不能凭空造数）
  const noQuote = shared.computeEarnings({ positions: [closed] }, {});
  check("无行情的持仓不计入汇总", noQuote.today === 0 && noQuote.pnl === 0, { today: noQuote.today, pnl: noQuote.pnl });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);