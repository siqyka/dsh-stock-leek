/**
 * 路由集成测试：mock 一个最小 cordis ctx（webServer.register + effect），
 * 起本地 http server，逐个请求验证响应结构。
 *   node test/test-routes.mjs
 *   DSH_STOCK_LEEK_CONFIG=/path/to/other.json node test/test-routes.mjs
 *
 * 注意：本测试会 POST /config 覆盖配置文件。配置路径由 config-guard 强制隔离
 * （未指定 → 系统临时目录；指向真实配置 → 直接拒绝启动）。
 */
import http from "node:http";
import { useTestConfigPath, verifyConfigPathIsolation } from "./config-guard.mjs";

useTestConfigPath("routes");

const { apply, __alertTickForTest, getAlertsPathForTest, getConfigPathForTest, getAlertStatsForTest, __stopAlertLoopForTest } = await import("../index.js");
// 实锤校验：确认生效路径确实是隔离路径（防将来有人改回静态 import）
await verifyConfigPathIsolation();

const routes = new Map();
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    register: ({ path, handler }) => {
      routes.set(path, handler);
      return () => routes.delete(path);
    },
  },
};
apply(ctx);

const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const h = routes.get(path);
  if (!h) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no route " + path }));
    return;
  }
  h(req, res);
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

async function get(path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(20000) });
  return { status: r.status, json: await r.json() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, json: await r.json() };
}

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    fails++;
    console.log("  FAIL", label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : "");
  }
}

console.log("routes:", [...routes.keys()].join(", "));

// 1. config GET
let r = await get("/dsh-stock-leek/config");
check("config 200", r.status === 200);
check("config has indices", Array.isArray(r.json.config?.indices) && r.json.config.indices.length >= 8);
check("config barIndices", Array.isArray(r.json.config?.barIndices));
check("config quotes snapshot", Array.isArray(r.json.quotes) && r.json.quotes.length > 0, r.json.error);
const sh = (r.json.quotes || []).find((x) => x.code === "sh000001");
check("sh000001 quote fields", sh && sh.name && typeof sh.price === "number" && typeof sh.percent === "number", sh);

// 2. quotes
r = await get("/dsh-stock-leek/quotes?codes=sh000001,sz399001,300750,00700,AAPL,899050");
check("quotes 200", r.status === 200);
check("quotes rows>=5", (r.json.rows || []).length >= 5, r.json.error);
const names = (r.json.rows || []).map((x) => x.name).join(" / ");
console.log("       ", names);

// 3. minute
r = await get("/dsh-stock-leek/minute?code=sh000001");
check("minute points", (r.json.points || []).length > 10, r.json.error);
check("minute prevClose", typeof r.json.prevClose === "number");

// 4. kline
r = await get("/dsh-stock-leek/kline?code=sh600519&period=day&count=60");
check("kline candles", (r.json.candles || []).length >= 50, r.json.error);
const last = (r.json.candles || []).slice(-1)[0];
check("kline ohlc sane", last && last.high >= Math.max(last.open, last.close) && last.low <= Math.min(last.open, last.close), last);

// 5. search
r = await get("/dsh-stock-leek/search?q=" + encodeURIComponent("茅台"));
check("search 茅台", (r.json.rows || []).some((x) => x.code === "sh600519"), r.json.rows?.slice(0, 3));
r = await get("/dsh-stock-leek/search?q=" + encodeURIComponent("恒生"));
check("search 恒生 has index", (r.json.rows || []).some((x) => x.code === "hkHSI" || x.type === "ZS"), r.json.rows?.slice(0, 5));

// 6. POST config
r = await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "600519", name: "x" }], pollMs: 999999, barIndices: ["sh000001"], ma: [5, 20, 60] } });
check("config POST ok", r.json.ok === true);
check("config POST poll clamped", r.json.config.pollMs === 120000, r.json.config.pollMs);
check("config POST 持久化 ma", JSON.stringify(r.json.config.ma) === JSON.stringify([5, 20, 60]), JSON.stringify(r.json.config.ma));
r = await get("/dsh-stock-leek/config?quotes=0");
check("config persisted watchlist", r.json.config.watchlist.length === 1 && r.json.config.watchlist[0].code === "sh600519");
check("config 读取回 ma（全局通用）", JSON.stringify(r.json.config.ma) === JSON.stringify([5, 20, 60]), JSON.stringify(r.json.config.ma));
// ma 白名单：非法周期被剔除、重复去重；允许空数组（全部关闭）
r = await post("/dsh-stock-leek/config", { config: { ...r.json.config, ma: [20, 7, "x", 20, 999] } });
check("config ma 白名单过滤", JSON.stringify(r.json.config.ma) === JSON.stringify([20]), JSON.stringify(r.json.config.ma));
r = await post("/dsh-stock-leek/config", { config: { ...r.json.config, ma: [] } });
check("config ma 允许空数组（全部关闭）", Array.isArray(r.json.config.ma) && r.json.config.ma.length === 0, JSON.stringify(r.json.config.ma));
r = await post("/dsh-stock-leek/config", { config: { ...r.json.config, ma: "bad" } });
check("config ma 非数组回落默认", JSON.stringify(r.json.config.ma) === JSON.stringify([5, 10, 20]), JSON.stringify(r.json.config.ma));

// 6a2. pnlCurve：盈亏走势展开状态（用户点按后需记住）
{
  const baseCfg = (await get("/dsh-stock-leek/config?quotes=0")).json.config;
  check("默认 pnlCurve 展开", baseCfg.pnlCurve === true, baseCfg.pnlCurve);
  r = await post("/dsh-stock-leek/config", { config: { ...baseCfg, pnlCurve: false } });
  check("pnlCurve 可收起", r.json.config.pnlCurve === false, r.json.config.pnlCurve);
  r = await get("/dsh-stock-leek/config?quotes=0");
  check("pnlCurve 收起状态已持久化", r.json.config.pnlCurve === false, r.json.config.pnlCurve);
  // 非布尔值应被丢弃并回落默认（不能因为脏数据把曲线卡在错误状态）
  r = await post("/dsh-stock-leek/config", { config: { ...baseCfg, pnlCurve: "no" } });
  check("pnlCurve 非布尔回落默认", r.json.config.pnlCurve === true, r.json.config.pnlCurve);
}

// 6b. 备份与损坏恢复
{
  const { readFileSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const cfgPath = process.env.DSH_STOCK_LEEK_CONFIG;

  // 先写入两版，产生 .bak
  await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "600519", name: "A" }], ma: [5, 10, 20] } });
  await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "300750", name: "B" }], ma: [5] } });
  check("写入后生成 .bak", existsSync(cfgPath + ".bak"));
  const bak = JSON.parse(readFileSync(cfgPath + ".bak", "utf8"));
  check(".bak 是上一版内容", bak.watchlist[0].code === "sh600519", bak.watchlist[0].code);

  // 损坏主文件 → 应回退 .bak，并给出 warning，损坏原文留存
  writeFileSync(cfgPath, "{ this is not valid json", "utf8");
  r = await get("/dsh-stock-leek/config?quotes=0");
  check("损坏时回退备份", r.json.config.watchlist[0].code === "sh600519", r.json.config.watchlist[0].code);
  check("损坏时给出 warning", typeof r.json.warning === "string" && r.json.warning.includes(".corrupt"), r.json.warning);
  check("损坏原文已留存", existsSync(cfgPath + ".corrupt") && readFileSync(cfgPath + ".corrupt", "utf8").includes("not valid json"));

  // 保存成功后告警清除
  r = await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "sh000001", name: "C" }] } });
  check("保存成功后标记已恢复", r.json.recoveredFromCorruption === true);
  r = await get("/dsh-stock-leek/config?quotes=0");
  check("恢复后 warning 消失", r.json.warning === null, r.json.warning);

  // 损坏且无备份 → 用默认值，但不崩溃
  rmSync(cfgPath + ".bak", { force: true });
  writeFileSync(cfgPath, "]]] broken", "utf8");
  r = await get("/dsh-stock-leek/config?quotes=0");
  check("损坏且无备份回落默认", r.json.ok === true && Array.isArray(r.json.config.positions));
  check("无备份仍给出 warning", typeof r.json.warning === "string", r.json.warning);

  // 空文件视为首次运行，不是损坏
  writeFileSync(cfgPath, "   ", "utf8");
  r = await get("/dsh-stock-leek/config?quotes=0");
  check("空文件不算损坏", r.json.warning === null, r.json.warning);

  // 恢复干净状态供后续用例
  await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "600519", name: "x" }], pollMs: 5000, barIndices: ["sh000001"], ma: [5, 10, 20] } });
  rmSync(cfgPath + ".corrupt", { force: true });
}

// 6c. 版本号与多标签页冲突检测
{
  r = await get("/dsh-stock-leek/config?quotes=0");
  const rev0 = r.json.rev;
  check("config 透出 rev", Number.isFinite(rev0) && rev0 > 0, String(rev0));

  // 正常写入：rev 递增，无冲突
  r = await post("/dsh-stock-leek/config", { config: { ...r.json.config, barStyle: "compact" } });
  check("写入后 rev 递增", r.json.rev === rev0 + 1, rev0 + " → " + r.json.rev);
  check("同版本写入无冲突", r.json.conflict === false, r.json.conflict);

  // 模拟另一个标签页：拿着旧 rev 写入 → 应报 conflict
  const stale = { ...r.json.config, barStyle: "full", __rev: rev0 };
  await post("/dsh-stock-leek/config", { config: { ...r.json.config, watchlist: [{ code: "600519", name: "other tab" }] } });
  r = await post("/dsh-stock-leek/config", { config: stale });
  check("过期 rev 写入报冲突", r.json.conflict === true, r.json.conflict);

  r = await get("/dsh-stock-leek/config?quotes=0");
  check("rev 随每次写入递增", r.json.rev === rev0 + 3, String(r.json.rev));
  check("配置内容以最后写入为准", r.json.config.barStyle === "full", r.json.config.barStyle);

  // 还原
  await post("/dsh-stock-leek/config", { config: { watchlist: [{ code: "600519", name: "x" }], pollMs: 5000, barIndices: ["sh000001"], ma: [5, 10, 20] } });
}

// 6d. SSE 行情推送：握手帧 + 订阅代码后收到 data 帧
{
  const controller = new AbortController();
  const res = await fetch(base + "/dsh-stock-leek/stream?codes=sh600519", {
    headers: { accept: "text/event-stream" },
    signal: controller.signal,
  });
  check("stream 返回 200", res.status === 200, res.status);
  check("stream 是 SSE", String(res.headers.get("content-type") || "").includes("text/event-stream"), res.headers.get("content-type"));
  check("stream 禁用缓存/缓冲", String(res.headers.get("cache-control") || "").includes("no-cache"), res.headers.get("cache-control"));

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let dataFrame = null;
  const deadline = Date.now() + 12000;
  // 期望：先 retry 帧，随后一帧 data: {rows:[...]}
  while (Date.now() < deadline && !dataFrame) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    if (buf.includes("retry:")) check("SSE 先发 retry 指令", true);
    const m = /data: (.+)/.exec(buf);
    if (m) {
      try {
        const payload = JSON.parse(m[1]);
        if (Array.isArray(payload.rows) && payload.rows.length) dataFrame = payload;
      } catch { /* 半帧，等下次 */ }
    }
  }
  controller.abort();
  check("SSE 首帧含 retry 指令", buf.includes("retry:"), JSON.stringify(buf.slice(0, 40)));
  check("SSE 推送了行情行", !!dataFrame, dataFrame ? (dataFrame.rows[0].code + " " + dataFrame.rows[0].price) : "未收到");
  check("SSE 行结构含涨跌字段", !!dataFrame && dataFrame.rows[0].percent !== undefined, dataFrame && Object.keys(dataFrame.rows[0]).join(","));
}

// 6.5 预警：清洗 + 状态机 + 落盘隔离 + 总开关（docs/alerts-plan.md §3/§4/§6）
{
  const DAY = "20261015";
  const q = (price, extra) => Object.assign({ code: "sh600519", name: "贵州茅台", price, percent: 1, time: DAY + "100000" }, extra || { now: NOW });
  const cfgFor = (alerts, remind) => ({ watchlist: [], positions: [], alerts, remind: remind === undefined ? true : remind });
  let seq = 0; // 每段独立 ruleId：.alerts 跨用例持久，避免滞回状态互相污染
  /**
   * 评估时刻必须与行情日期一致：`applyAlertTick` 有交易日判据（报价日必须
   * 等于市场本地当日），否则一律跳过。测试传固定行情 `time=DAY+...`，
   * 就得同时传一个「上海时区当日 == DAY」的 now，否则触发断言全空转。
   * DAY=20261015 → 用该日北京 10:00（= UTC 02:00）。
   */
  const NOW = new Date(Date.UTC(2026, 9, 15, 2, 0, 0));

  // POST 含合法+脏规则：合法保留、脏拒绝（id 字符集 / 类型 / 港美股 limit_near）
  const badPost = await post("/dsh-stock-leek/config", {
    config: {
      watchlist: [{ code: "sh600519", name: "茅台" }],
      alerts: [
        { id: "good1", code: "sh600519", type: "price_above", value: 1500, enabled: true },
        { id: "bad id", code: "sh600519", type: "price_above", value: 1 }, // id 非法字符
        { id: "good2", code: "hk00700", type: "limit_near", value: 2 }, // 港股无涨跌停
        { id: "good3", code: "sh600519", type: "no_such_type", value: 1 }, // 未知类型
        { id: "good4", code: "sh600519", type: "pct_up", value: -5 }, // 负值
      ],
    },
  });
  const kept = badPost.json.config?.alerts || [];
  check("alerts 清洗只留合法规则", kept.length === 1 && kept[0].id === "good1", kept);

  // 状态机：**每个交易日只提示一次**（用户要求），下次符合条件须等次日
  const mId = "m" + seq;
  const base = cfgFor([{ id: mId, code: "sh600519", type: "price_above", value: 10, enabled: true }]);
  let t = __alertTickForTest(base, [q(11)], { now: NOW });
  check("上穿触发 fired", t.fired.length === 1 && t.fired[0].ruleId === mId && t.fired[0].price === 11, t.fired);

  t = __alertTickForTest(base, [q(12)], { now: NOW });
  check("停阈值上方不重复报", t.fired.length === 0, t.fired);

  // 核心：当日回落到阈值下方（含跌穿滞回带）**不再**重置，也不重复报
  t = __alertTickForTest(base, [q(9.96)], { now: NOW });
  check("当日小幅回落：保持 fired 不报", t.fired.length === 0 && t.data.states[mId].phase === "fired", t.data.states[mId]);

  t = __alertTickForTest(base, [q(9)], { now: NOW }); // 深度回落，旧版会回 armed
  check("当日深度回落也不重置（每日仅一次）", t.fired.length === 0 && t.data.states[mId].phase === "fired", t.data.states[mId]);

  t = __alertTickForTest(base, [q(11)], { now: NOW }); // 当日重新上穿
  check("当日重新上穿仍不报（同一天只提示一次）", t.fired.length === 0, t.fired);

  // 跨日重置：先在 D15 建立 fired 态，再到 D16 用同一规则——
  // 只有「昨日 fired + 今日仍在上穿」同时成立才说明跨日真的重置了（非空洞）
  const dId = "d" + seq;
  const dayCfg = cfgFor([{ id: dId, code: "sh600519", type: "price_above", value: 10, enabled: true }]);
  __alertTickForTest(dayCfg, [{ code: "sh600519", price: 11, percent: 1, time: "20261015100000" }], { now: NOW });
  // 次日：now 必须同步到次日——交易日判据要求「报价日 == 市场本地当日」，
  // 用 D15 的 now 会被判据挡掉，跨日断言就变成空转。
  const NOW2 = new Date(Date.UTC(2026, 9, 16, 2, 0, 0)); // 20261016 北京 10:00
  const dd = __alertTickForTest(dayCfg, [{ code: "sh600519", price: 11, percent: 1, time: "20261016100000" }], { now: NOW2 });
  check("跨日强制重置并重新触发", dd.fired.some((e) => e.ruleId === dId), dd.fired);

  // 交易日判据本身：报价日 != 市场本地当日（节假日/未开市）→ 跳过不触发。
  // 没有这条，节假日里「价格恒定满足条件」会误报一次。
  const holId = "h" + seq;
  const hol = __alertTickForTest(
    cfgFor([{ id: holId, code: "sh600519", type: "price_above", value: 10, enabled: true }]),
    [{ code: "sh600519", price: 99, percent: 1, time: "20261015100000" }], // 报价停在 D15
    { now: NOW2 }); // 而市场本地已是 D16 → 该市场今天没开
  check("报价日落后于市场当日 → 跳过不触发（节假日防误报）", hol.fired.length === 0 && hol.skipped.includes(holId), hol);

  // 反向对照：同一报价，若 now 也停在 D15（当天）→ 必须触发。
  // 两条一起才证明跳过是「日期不匹配」造成的，而不是规则本身不工作。
  const hol2 = __alertTickForTest(
    cfgFor([{ id: "h2" + seq, code: "sh600519", type: "price_above", value: 10, enabled: true }]),
    [{ code: "sh600519", price: 99, percent: 1, time: "20261015100000" }],
    { now: NOW });
  check("同报价在当日则正常触发（对照，防假绿）", hol2.fired.length === 1, hol2.fired);

  // 总开关：remind=false → 一律不评估（即使上穿）
  const off = __alertTickForTest(cfgFor([{ id: "o" + seq, code: "sh600519", type: "price_above", value: 10, enabled: true }], false), [q(11)], { now: NOW });
  check("总开关 remind=false 不触发", off.fired.length === 0, off.fired);

  // 悬空成本：cost_above 找不到持仓成本 → 跳过不误触
  const orphan = __alertTickForTest(cfgFor([{ id: "c1", code: "sh600519", type: "cost_above", value: 0, enabled: true }]), [q(50)], { now: NOW });
  check("cost_above 无成本价跳过", orphan.fired.length === 0 && orphan.skipped.includes("c1"), { fired: orphan.fired, skipped: orphan.skipped });
  const withCost = __alertTickForTest(
    { watchlist: [], positions: [{ code: "sh600519", cost: 9, qty: 100 }], alerts: [{ id: "c2", code: "sh600519", type: "cost_above", value: 0, enabled: true }], remind: true },
    [q(11)], { now: NOW });
  check("cost_above 成本有效时触发", withCost.fired.some((e) => e.ruleId === "c2"), withCost.fired);

  // 无行情日界（time 脏）：跳过触发，宁可不报不乱报
  const noDay = __alertTickForTest(cfgFor([{ id: "n1", code: "sh600519", type: "price_above", value: 10, enabled: true }]), [{ code: "sh600519", price: 11, percent: 1, time: "" }], { now: NOW });
  check("无行情日界跳过触发", noDay.fired.length === 0 && noDay.skipped.includes("n1"), noDay);

  // 落盘隔离：账本落在隔离临时路径派生的 .alerts，且 events 已持久化
  const alertsPath = getAlertsPathForTest();
  const cfgPath = getConfigPathForTest();
  check("alerts 路径派生自 configPath（继承 pid 隔离）", alertsPath === cfgPath + ".alerts" && !alertsPath.endsWith("alerts.json"), { alertsPath, cfgPath });

  // /alerts GET 回读：结构与已写入事件一致
  const hist = await get("/dsh-stock-leek/alerts");
  check("/alerts 返回 events 数组", hist.status === 200 && Array.isArray(hist.json.events), hist.json && hist.json.events);
  check("/alerts 记录了已触发事件", hist.json.events.some((e) => e.type === "price_above"), hist.json.events && hist.json.events.slice(-1));

  // 验收 #5：未启用规则 → 评估循环完全休眠，**零上游请求**。
  // 观测点：循环确实在跑（ticks 增长），但 fetches 一步不动。
  {
    await post("/dsh-stock-leek/config", { config: { watchlist: [], positions: [], alerts: [], remind: true } });
    const s0 = getAlertStatsForTest();
    await wait(300); // 给循环至少一次 tick 的机会（无规则时退避 60s，首拍立即执行）
    const s1 = getAlertStatsForTest();
    check("无规则时循环仍在跑（ticks 增长）", s1.ticks > s0.ticks, { before: s0.ticks, after: s1.ticks });
    check("无规则时零上游请求（fetches 不动）", s1.fetches === s0.fetches, { before: s0.fetches, after: s1.fetches });
  }

  // 注：评估循环「定时器未被 unref」这条不能用本进程断言——
  // 本进程跑着 http server（活动句柄），unref 的定时器照样会触发，
  // 区分不出来（实测：把 unref 加回去，本文件里的行为断言仍然全绿）。
  // 该回归由独立子进程的 test/alert-loop-ref.mjs 负责：只有子进程在
  // 「除该定时器外无其它句柄」时才暴露差别。

  // 验收 #5 反向对照：**有**启用规则且盘中 → fetches 必须增长
  // （否则上一条可能只是"循环根本没工作"而假绿）
  {
    await post("/dsh-stock-leek/config", {
      config: { watchlist: [], positions: [], remind: true, alerts: [{ id: "live1", code: "sh600519", type: "price_above", value: 1, enabled: true }] },
    });
    const s2 = getAlertStatsForTest();
    // 只在 A 股交易时段验证（非交易时段循环按设计退避，不能据此判失败）
    const nowBJ = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60000);
    const mins = nowBJ.getUTCHours() * 60 + nowBJ.getUTCMinutes();
    const wd = nowBJ.getUTCDay();
    const openNow = wd >= 1 && wd <= 5 && ((mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900));
    await wait(400);
    const s3 = getAlertStatsForTest();
    if (openNow) {
      check("盘中 + 有规则 → 确实打了上游（对照，防假绿）", s3.fetches > s2.fetches, { before: s2.fetches, after: s3.fetches });
    } else {
      console.log("  skip  盘中对照（当前非 A 股交易时段，循环按设计退避）");
      check("非交易时段有规则也不打上游（休市门控）", s3.fetches === s2.fetches, { before: s2.fetches, after: s3.fetches });
    }
    await post("/dsh-stock-leek/config", { config: { watchlist: [], positions: [], alerts: [], remind: true } });
  }
}

// 7. probe
r = await get("/dsh-stock-leek/probe");
console.log("  probe:", r.json.checks.map((c) => `${c.ok ? "✓" : "✗"}${c.label}(${c.ms}ms)`).join("  "));
check("probe all ok", r.json.ok === true);

server.close();
// 评估循环的定时器不 unref（见 index.js schedule 注释）→ 必须显式停掉，
// 否则测试跑完后它还会继续打上游，也可能挂住进程退出
__stopAlertLoopForTest();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
