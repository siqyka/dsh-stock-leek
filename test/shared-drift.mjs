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

// isMarketOpen 时段函数的三市场语义：两端一致 + 关键边界（同一 now 显式传入，
// client 副本的 marketNow 兜底不参与——测试不依赖浏览器全局 __sl_now__）。
{
  const cw = extractFn("marketWindows");
  const cm = extractFn("marketMinutes");
  const ci = extractFn("isMarketOpen", { marketWindows: cw, marketMinutes: cm });
  check("marketWindows 在 client.js 中可提取", !!cw);
  check("isMarketOpen 在 client.js 中可提取", !!ci);
  const codes = ["sh600519", "sz300750", "bj430047", "hk00700", "usAAPL", "gb_IXIC", "", null];
  const diffs = [];
  for (const c of codes) {
    if (String(cw && cw(c)) !== String(shared.marketWindows(c))) diffs.push({ c, kind: "windows" });
  }
  // 固定时刻：A股盘中 10:00 / 午休 12:00 / 美股盘中 10:00（美东）/ 周末
  const NOWS = [
    new Date(Date.UTC(2026, 9, 15, 2, 0, 0)), // 北京 10:00（周四）
    new Date(Date.UTC(2026, 9, 15, 4, 0, 0)), // 北京 12:00 午休
    new Date(Date.UTC(2026, 9, 14, 14, 30, 0)), // 美东 10:30（美股盘中）
    new Date(Date.UTC(2026, 9, 17, 2, 0, 0)), // 周六
  ];
  for (const c of ["sh600519", "hk00700", "usAAPL"]) {
    for (const n of NOWS) {
      const a = ci ? ci(c, n) : null;
      const b = shared.isMarketOpen(c, n);
      if (String(a) !== String(b)) diffs.push({ c, n: n.toISOString(), client: a, shared: b });
      const am = cm ? cm(c, n) : null;
      const bm = shared.marketMinutes(c, n);
      if (String(am) !== String(bm)) diffs.push({ c, n: n.toISOString(), kind: "minutes" });
    }
  }
  check("时段函数与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 4));
  // 语义边界：午休 A 股算休市（12:00 落在两窗口之间），周末全休
  check("A股午休不在交易时段", shared.isMarketOpen("sh600519", NOWS[1]) === false);
  check("A股 10:00 在交易时段", shared.isMarketOpen("sh600519", NOWS[0]) === true);
  check("周六全市场休", codes.every((c) => !shared.isMarketOpen(c, NOWS[3])));
}

// 预警清洗：sanitizeAlert / sanitizeAlerts 两端一致 + 关键拒绝路径
{
  const ca = extractFn("sanitizeAlert", { ALERT_TYPES: shared.ALERT_TYPES, ALERT_HYSTERESIS: shared.ALERT_HYSTERESIS });
  const cs = extractFn("sanitizeAlerts", { sanitizeAlert: ca });
  check("sanitizeAlert 在 client.js 中可提取", !!ca);
  check("sanitizeAlerts 在 client.js 中可提取", !!cs);
  const CASES = [
    [{ id: "a1", code: "sh600519", type: "price_above", value: 1500 }, true],
    [{ id: "a2", code: "hk00700", type: "limit_near", value: 2 }, false], // 港股无涨跌停
    [{ id: "bad id!", code: "sh600519", type: "price_above", value: 1 }, false], // id 字符集
    [{ id: "a3", code: "sh600519", type: "unknown_type", value: 1 }, false],
    [{ id: "a4", code: "sh600519", type: "pct_up", value: NaN }, false],
    [{ id: "a5", code: "sh600519", type: "pct_up", value: -1 }, false],
    [{ id: "a6", code: "sh600519", type: "cost_above", value: 10 }, true],
    [{ id: "a7", code: "__proto__", type: "pct_up", value: 3 }, true], // code 是合法字符集，id 不是（这里 id 合法）
    [{ id: "constructor", code: "sh600519", type: "pct_up", value: 3 }, true], // id 字符集允许
    [null, false],
    ["x", false],
  ];
  const diffs = [];
  for (const [c, ok] of CASES) {
    const a = ca ? ca(c) : null;
    const b = shared.sanitizeAlert(c);
    if (String(JSON.stringify(a)) !== String(JSON.stringify(b))) diffs.push({ c, client: a, shared: b });
    if (ok && !b) diffs.push({ expect: "accept", c });
    if (!ok && b) diffs.push({ expect: "reject", c });
  }
  check("sanitizeAlert 与 shared.js 行为一致", diffs.length === 0, diffs.slice(0, 4));
  // 上限 50：给 60 条只收 50
  const many = []; for (let i = 0; i < 60; i++) many.push({ id: "r" + i, code: "sh600519", type: "pct_up", value: 3 });
  const arrA = cs ? cs(many) : null;
  const arrB = shared.sanitizeAlerts(many);
  check("sanitizeAlerts 与 shared.js 一致", String(JSON.stringify(arrA)) === String(JSON.stringify(arrB)));
  check("sanitizeAlerts 上限 50", arrB.length === 50, arrB.length);
  check("sanitizeAlerts 去重 id", shared.sanitizeAlerts([many[0], { ...many[0], code: "sz300750" }]).length === 1);
  // quoteDayFor：三个市场的时间戳格式**各不相同**，必须都能解析。
  // 早先只认 14 位 → 美股/港股一律返回 null → 规则被判 no-day 永不触发（实测发现）。
  const cd = extractFn("quoteDayFor");
  const DAY_CASES = [
    ["20261014161401", "20261014", "A股 14 位数字"],
    ["2026-10-15 12:14:40", "20261015", "美股 横杠+空格"],
    ["2026/10/15 16:08:42", "20261015", "港股 斜杠+空格"],
    ["2026-10-15", "20261015", "仅日期（无时刻）"],
    ["bad", null, "脏值"],
    ["2026", null, "过短"],
    ["", null, "空串"],
  ];
  {
    const diffs = [];
    for (const [t, expect, label] of DAY_CASES) {
      const a = cd ? cd({ time: t }) : null;
      const b = shared.quoteDayFor({ time: t });
      if (String(a) !== String(b)) diffs.push({ t, client: a, shared: b });
      if (String(b) !== String(expect)) diffs.push({ t, label, expect, actual: b });
    }
    check("quoteDayFor 两端一致且覆盖三市场格式", diffs.length === 0, diffs.slice(0, 4));
    check("quoteDayFor 脏值返回 null", shared.quoteDayFor({ time: "2026" }) === null && shared.quoteDayFor(null) === null);
  }
}

// stepAlert 状态机（仅 shared 有；Host 评估用，client 不评估）：滞回 + 跨日 + 悬空成本
{
  const rule = (t, v) => ({ id: "x1", code: "sh600519", type: t, value: v, enabled: true });
  const D = "20261015";
  const st = shared.stepAlert;
  // 上穿：armed → fired 报一次
  let r = st(rule("price_above", 1500), { price: 1501, time: D + "100000" }, null, { day: D });
  check("price_above 上穿触发 fired", r.fired === true && r.state.phase === "fired", r);
  // 停在阈值上方：不重复报（滞回的核心目的）
  r = st(rule("price_above", 1500), { price: 1502, time: D + "100001" }, { phase: "fired", day: D }, { day: D });
  check("price_above 停阈值上方不重复报", r.fired === false && r.state.phase === "fired", r);
  // 回落不足滞回带宽：仍 fired
  r = st(rule("price_above", 1500), { price: 1495, time: D + "100002" }, { phase: "fired", day: D }, { day: D }); // 1495 > 1500*0.995=1492.5
  check("回落不足滞回带宽不重置", r.state.phase === "fired", r);
  // 回落超过带宽：重新 armed
  r = st(rule("price_above", 1500), { price: 1490, time: D + "100003" }, { phase: "fired", day: D }, { day: D });
  check("回落过滞回带宽重置 armed", r.state.phase === "armed" && r.fired === false, r);
  // 下穿镜像
  r = st(rule("price_below", 1400), { price: 1399, time: D + "100000" }, null, { day: D });
  check("price_below 下穿触发", r.fired === true, r);
  r = st(rule("price_below", 1400), { price: 1399.5, time: D + "100000" }, { phase: "fired", day: D }, { day: D });
  check("price_below 停在下方不重复报", r.fired === false, r);
  r = st(rule("price_below", 1400), { price: 1401, time: D + "100000" }, { phase: "fired", day: D }, { day: D }); // 1401 < 1400*1.005=1407
  check("price_below 反弹不足带宽不重置", r.state.phase === "fired", r);
  r = st(rule("price_below", 1400), { price: 1410, time: D + "100000" }, { phase: "fired", day: D }, { day: D });
  check("price_below 反弹过带宽重置", r.state.phase === "armed", r);
  // 跨日重置：昨天 fired，今天同条件重新报
  r = st(rule("price_above", 1500), { price: 1501, time: "20261016100000" }, { phase: "fired", day: "20261015" }, { day: "20261016" });
  check("跨日 fired 回 armed 并当日重新可触发", r.state.phase === "fired" && r.fired === true && r.state.day === "20261016", r);
  // pct_down 语义：value 为正 N%，判 pct ≤ -N
  r = st(rule("pct_down", 3), { percent: -3.5, time: D + "100000" }, null, { day: D });
  check("pct_down 跌幅达阈触发", r.fired === true, r);
  r = st(rule("pct_down", 3), { percent: -2.9, time: D + "100000" }, null, { day: D });
  check("pct_down 跌幅不足不触发", r.fired === false, r);
  // 悬空成本：cost_above 无 cost 时跳过不误触发
  r = st(rule("cost_above", 0), { price: 10, time: D + "100000" }, null, { day: D, cost: undefined });
  check("cost_above 无成本价跳过不触发", r.fired === false && r.skipped === "no-data", r);
  r = st(rule("cost_above", 0), { price: 10, time: D + "100000" }, null, { day: D, cost: 9 });
  check("cost_above 成本有效时触发", r.fired === true, r);
  // limit_near：-1 哨兵不得算成触发
  r = st(rule("limit_near", 2), { price: 100, limitUp: -1, limitDown: -1, time: D + "100000" }, null, { day: D });
  check("limit_near 哨兵 -1 跳过不误触", r.fired === false && r.skipped === "no-data", r);
  r = st(rule("limit_near", 2), { price: 100, limitUp: 101, limitDown: 99, time: D + "100000" }, null, { day: D });
  check("limit_near 逼近涨停触发", r.fired === true, r);
  // 行情缺日界（陈旧/脏 time）：no-day，绝不触发
  r = st(rule("price_above", 1), { price: 5, time: "" }, null, { day: "" });
  check("无行情日界跳过触发（宁可不报）", r.fired === false && r.skipped === "no-day", r);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);