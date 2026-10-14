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
    for (const args of argSets) {
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

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);