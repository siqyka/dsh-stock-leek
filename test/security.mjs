/**
 * 安全回归测试：node test/security.mjs
 *
 * 覆盖四类外部可控输入的攻击面：
 *   1. normalizeApiCode 输出净化 —— code 会拼进上游 URL，绝不能含 URL 结构字符
 *   2. 路由端到端健壮性 —— 恶意 code/q 不得导致 500、不得在响应体泄漏堆栈或脚本
 *   3. 配置 POST 净化 —— 原型污染 / 超大字段 / 越界数值 / 长度溢出必须被拦截或钳制
 *   4. SSE 事件注入 —— 恶意股票名不得伪造 SSE 帧边界
 *
 * 这些检查的目的不是「当前有没有 bug」，而是**锁住行为**：
 * 任何人日后改动解析或清洗逻辑，这里会第一时间报警。
 */
import http from "node:http";
import { useTestConfigPath, verifyConfigPathIsolation } from "./config-guard.mjs";

// 必须先设配置路径，再动态导入 index.js！
// 静态 import 会被提升到本语句之前执行，而 index.js 在模块顶层就解析 CONFIG_PATH，
// 那样守卫设置的环境变量来不及生效 → 测试会写到真实配置文件（覆盖用户的持仓数据）。
useTestConfigPath("security");

const { apply, normalizeApiCode } = await import("../index.js");
// 实锤校验：确认生效路径确实是隔离路径（防将来有人改回静态 import）
await verifyConfigPathIsolation();

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
    fails++;
  }
}
async function safeHit(base, path, opts) {
  try {
    const r = await fetch(base + path, Object.assign({ signal: AbortSignal.timeout(20000) }, opts || {}));
    let body = "";
    try { body = await r.text(); } catch { /* 流式或已销毁 */ }
    return { status: r.status, body };
  } catch (e) {
    return { status: -1, body: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------- 1. 输出净化
console.log("== 1. normalizeApiCode 输出不得含 URL 结构字符 ==");
// 这些字符一旦进入 URL 拼接，可能逃逸查询参数 / 追加参数 / 注入协议
const DANGER = /[?#/\s&=%@\\"'`|;<>]/;
const normCases = [
  // 合法输入（允许被规范化，如 600519 → sh600519）
  "sh000001", "sz399001", "600519", "hk00700", "hkHSI", "usAAPL", "us.AAPL", "usr_ixic",
  "bj899050", "gb_ixic",
  // 攻击输入：必须被剥掉危险字符
  "sh000001&f=evil", "sh000001?x=1", "sh000001#frag", "sh000001/x",
  "AAPL%20or%201=1", "AAPL\n", "AAPL\t", "sh600519%2f%2e%2e", "us.AAPL.ON",
  "usAAPL;drop", "..%2F", "sh600519&&", "javascript:alert(1)",
  "sh600519`whoami`", "sh000001 $(id)", "sh000001{}", "sh000001|id",
  "\x00sh600519", "sh600519\r\nSet-Cookie:x", "sh000001\"'<>", "sh000001=1&b=2",
];
let sanitizeOk = true;
const sanitizeBad = [];
for (const c of normCases) {
  let out;
  try { out = normalizeApiCode(c); } catch (e) { out = "THREW:" + e.message; }
  const hasDanger = typeof out === "string" ? DANGER.test(out) : false;
  if (hasDanger) { sanitizeOk = false; sanitizeBad.push({ in: c, out }); }
}
check("全部输入净化后不含 URL 结构字符", sanitizeOk, sanitizeBad.slice(0, 3));

// 美股交易所后缀必须剥掉（实测 smartbox 搜索返回的美股代码自带 OQ/AM 后缀）：
// 行情接口碰巧容忍 `usAAPLOQ`，但分时/K线接口不认 → 详情页「无分时/无K线」。
// 同时防误伤：本身以 N/AM/OQ 结尾的真实代码（AON、TSM、USO）不能被剥坏。
{
  const suffixCases = [
    ["usAAPLOQ", "usAAPL"],   // 纳斯达克
    ["usTSLAOQ", "usTSLA"],
    ["usAPLYAM", "usAPLY"],   // NYSE American（ETF）
    ["usAAPL", "usAAPL"],     // 已干净：不变
    ["usAON", "usAON"],       // 误伤检查：AON 结尾不是后缀
    ["usTSM", "usTSM"],       // 误伤检查
    ["usUSO", "usUSO"],       // 误伤检查
  ];
  const bad = [];
  for (const [input, expect] of suffixCases) {
    let out;
    try { out = normalizeApiCode(input); } catch (e) { out = "THREW:" + e.message; }
    if (out !== expect) bad.push({ input, out, expect });
  }
  check("美股交易所后缀被剥（OQ/AM），且不误伤真实代码", bad.length === 0, bad.slice(0, 3));
}

// ---------------------------------------------------------------- 2. 端到端健壮性
const routes = new Map();
apply({ effect: (fn) => fn(), webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path); } } });
const server = http.createServer((req, res) => {
  const p = new URL(req.url || "/", "http://x").pathname;
  const h = routes.get(p);
  if (!h) { res.writeHead(404); res.end("{}"); return; }
  try { h(req, res); } catch { try { res.writeHead(500); res.end("{}"); } catch { /* 已销毁 */ } }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

console.log("\n== 2. 恶意输入端到端（不得 500 / 不得泄漏堆栈或脚本） ==");
const malicious = [
  "sh000001%26f%3Devil", "sh000001%3Fx%3D1", "AAPL%2520or%25201%3D1",
  "sh600519%2F..%2F", "x%0Ainj", "%0A", "javascript%3Aalert%281%29",
  "sh000001%23frag", "a".repeat(200),
  "sh600519%22%3E%3Cscript%3Ealert%281%29%3C/script%3E",
];
let e2eOk = true;
const e2eBad = [];
for (const m of malicious) {
  for (const ep of ["quotes?codes=", "minute?code=", "kline?code="]) {
    const r = await safeHit(base, `/dsh-stock-leek/${ep}${m}`);
    const leaky = /<script|ReferenceError|TypeError:|at Object\.|at async/.test(r.body);
    const okStatus = r.status === 200 || r.status === 400;
    if (!okStatus || leaky) { e2eOk = false; e2eBad.push({ ep, m, status: r.status, leaky }); }
  }
}
check("30 个恶意 code 输入全部安全返回", e2eOk, e2eBad.slice(0, 3));

let searchOk = true;
const searchBad = [];
for (const m of ["%E8%8C%85%E5%8F%B0%22%3E%3Cscript%3E", "%0d%0aSet-Cookie:x", "a%00b", "<img src=x onerror=alert(1)>"]) {
  const r = await safeHit(base, `/dsh-stock-leek/search?q=${m}`);
  if (r.status !== 200 || /<script|<img/i.test(r.body)) { searchOk = false; searchBad.push({ m, status: r.status }); }
}
check("4 个恶意搜索词全部安全返回", searchOk, searchBad);

// ---------------------------------------------------------------- 3. 配置净化
console.log("\n== 3. 配置 POST 净化（污染/溢出/越界必须被拦截） ==");
const post = async (cfg) => {
  const r = await safeHit(base, "/dsh-stock-leek/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: cfg }) });
  let j = null;
  try { j = JSON.parse(r.body); } catch { /* ignore */ }
  return { status: r.status, j };
};

{
  // 原型污染：__proto__ / constructor 不得生效
  await post({ watchlist: [{ code: "sh600519", name: "x" }], ["__proto__"]: { polluted: true }, constructor: { polluted: true } });
  const polluted = {}.polluted === true || {}.polluted === true;
  check("原型污染无效（__proto__/constructor）", !polluted, { polluted });
}
{
  // 巨量列表：必须被截断到 300
  const { j } = await post({ watchlist: Array.from({ length: 5000 }, (_, i) => ({ code: `sh${String(i).padStart(6, "0")}`, name: "x" })) });
  check("watchlist 巨量输入被截断到 300", j?.config?.watchlist?.length === 300, j?.config?.watchlist?.length);
}
{
  // 负成本/负股数：必须归零
  const { j } = await post({ positions: [{ code: "sh600519", cost: -999, qty: -999 }] });
  const p = (j?.config?.positions || [])[0] || {};
  check("负成本/负股数归零", p.cost === 0 && p.qty === 0, { cost: p.cost, qty: p.qty });
}
{
  // 非数字：归零
  const { j } = await post({ positions: [{ code: "sh600519", cost: "abc", qty: "xyz" }] });
  const p = (j?.config?.positions || [])[0] || {};
  check("非数字 cost/qty 归零", p.cost === 0 && p.qty === 0, { cost: p.cost, qty: p.qty });
}
{
  // pollMs 越界：钳制
  const { j: j1 } = await post({ pollMs: 1e12 });
  check("pollMs 极大值钳制到 120000", j1?.config?.pollMs === 120000, j1?.config?.pollMs);
  const { j: j2 } = await post({ pollMs: 1 });
  check("pollMs 极小值钳制到 2000", j2?.config?.pollMs === 2000, j2?.config?.pollMs);
  const { j: j3 } = await post({ pollMs: "notanumber" });
  check("pollMs 非数字回落默认 5000", j3?.config?.pollMs === 5000, j3?.config?.pollMs);
}
{
  // 颜色注入：必须是合法 hex
  const { j } = await post({ riseColor: "red; background:url(x)", fallColor: "#fff\" onload=\"alert(1)" });
  const ok = /^#[0-9a-fA-F]{3,8}$/.test(j?.config?.riseColor) && /^#[0-9a-fA-F]{3,8}$/.test(j?.config?.fallColor);
  check("颜色注入被拒（回落默认 hex）", ok, { rise: j?.config?.riseColor, fall: j?.config?.fallColor });
}
{
  // code 超长：必须被拒
  const { j } = await post({ watchlist: [{ code: "sh" + "1".repeat(500), name: "x" }] });
  check("超长 code 被拒收", (j?.config?.watchlist || []).length === 0, j?.config?.watchlist);
}
{
  // txns 溢出：截断到 200
  const { j } = await post({ positions: [{ code: "sh600519", cost: 1, qty: 1, txns: Array.from({ length: 500 }, (_, i) => ({ price: i + 1, qty: 1, date: "2026-01-01" })) }] });
  check("txns 溢出截断到 200", (j?.config?.positions?.[0]?.txns || []).length === 200, j?.config?.positions?.[0]?.txns?.length);
}
{
  // ma 白名单：只接受 [5,10,20,60]
  const { j } = await post({ ma: [5, 7, 10, 999, 20] });
  check("ma 白名单过滤", JSON.stringify(j?.config?.ma) === JSON.stringify([5, 10, 20]), j?.config?.ma);
}
{
  // 超大 body（≈16MB）：必须被拒（readBody 2MB 上限）
  const r = await safeHit(base, "/dsh-stock-leek/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { watchlist: Array.from({ length: 80000 }, (_, i) => ({ code: `sh${String(i % 1000000).padStart(6, "0")}`, name: "y".repeat(200) })) } }) });
  check("超大 body 被拒", r.status !== 200, { status: r.status });
}

// ---------------------------------------------------------------- 4. SSE 注入
console.log("\n== 4. SSE 事件注入（恶意 name 不得伪造帧） ==");
{
  // 理论根基：JSON.stringify 会把 \n 转成字面量 \n（两个字符），不产生真实换行
  const payload = { rows: [{ code: "x", name: "evil\n\ndata: {\"rows\":[]}\n\n" }] };
  const frame = "data: " + JSON.stringify(payload) + "\n\n";
  const realNewlines = frame.split("\n").length - 1;
  const injectedDataFrames = frame.split("\n\n").filter((f) => /^data:/.test(f.trim())).length;
  check("JSON 序列化后仅帧尾一个真实换行边界", realNewlines === 2, realNewlines);
  check("恶意 name 伪造不出额外 data: 帧", injectedDataFrames === 1, injectedDataFrames);
}
{
  // 端到端：真实 SSE 首帧必须是合法 JSON 且只有一帧
  const r = await safeHit(base, "/dsh-stock-leek/quotes?codes=sh000001");
  let parsedOk = true;
  try { JSON.parse(r.body); } catch { parsedOk = false; }
  check("/quotes 响应为合法 JSON", parsedOk);

  const es = await fetch(`${base}/dsh-stock-leek/stream?codes=sh000001`, { signal: AbortSignal.timeout(15000) });
  const reader = es.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let dataFrames = 0;
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < 10000 && dataFrames < 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() || "";
      for (const f of frames) if (f.startsWith("data:")) dataFrames++;
    }
  } catch { /* 超时即止 */ }
  try { await reader.cancel(); } catch { /* ignore */ }
  check("SSE 首推恰好 1 个 data: 帧", dataFrames === 1, dataFrames);
}

server.close();
console.log(fails === 0 ? "\nSECURITY ALL PASS" : `\n${fails} SECURITY FAILED`);
process.exit(fails === 0 ? 0 : 1);
