/**
 * 端到端集成测试：
 *   host index.js（mock ctx）→ 真实 http server
 *   client.js 的 fetch → 打到该 server
 *   用 mini-React 渲染所有视图，验证不抛错且渲染出真实行情
 *   零外部依赖（自带 mini-React），可脱离 node_modules 运行
 *   node test/e2e-render.mjs
 *
 * 注意：渲染流程会添加自选并 POST /config。配置路径由 config-guard 强制隔离
 * （未指定 → 系统临时目录；指向真实配置 → 直接拒绝启动）。
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { useTestConfigPath } from "./config-guard.mjs";

useTestConfigPath("e2e");

const { apply: hostApply, __alertTickForTest, __stopAlertLoopForTest } = await import("../index.js");

// ---------- 起 host 路由 ----------
const routes = new Map();
hostApply({
  effect: (fn) => fn(),
  webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path); } },
});
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const h = routes.get(path);
  if (!h) { res.writeHead(404); res.end("{}"); return; }
  h(req, res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = "http://127.0.0.1:" + server.address().port;

// ---------- mini React（支持函数组件 + 类组件；hooks 按节点隔离） ----------
let curNode = null;
/** 排队等待「ref 已挂载」后再执行的 effect（见 React.useEffect 内注释） */
const pendingEffects = [];
class ReactComponent {
  constructor(props) { this.props = props; this.state = this.state || {}; }
  setState(patch) { this.state = Object.assign({}, this.state, typeof patch === "function" ? patch(this.state, this.props) : patch); }
}
const React = {
  Component: ReactComponent,
  Fragment: "@@fragment",
  createElement: (type, props, ...children) => {
    const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
    const p = Object.assign({}, props || {});
    if (flat.length) p.children = flat; // 类组件 render 里用 this.props.children
    return { type, props: p, children: flat };
  },
  useState: (init) => {
    if (!curNode.__h) curNode.__h = [];
    const i = curNode.__hi++;
    if (!(i in curNode.__h)) curNode.__h[i] = { v: typeof init === "function" ? init() : init };
    const slot = curNode.__h[i];
    return [slot.v, (nv) => { slot.v = typeof nv === "function" ? nv(slot.v) : nv; }];
  },
  useEffect: (fn, deps) => {
    const i = curNode.__hi++;
    if (!curNode.__h) curNode.__h = [];
    const prev = curNode.__h[i];
    const same = prev && deps && prev.deps && prev.deps.length === deps.length && prev.deps.every((d, k) => d === deps[k]);
    if (prev && same) return;
    if (prev && prev.cleanup) { try { prev.cleanup(); } catch { /* ignore */ } }
    // 真实 React 里 ref 在 commit 阶段先挂好，passive effect 才执行；
    // 这里 effect 体若在 walk 期间就地跑，会早于 attachRefs，
    // 于是「读 ref.current 量行高」这类 effect 永远拿到 null。
    // 故推迟到 attachRefs 之后再执行，顺序才对齐真实 React。
    pendingEffects.push({ fn, hookState: curNode.__h, i });
    curNode.__h[i] = { deps, cleanup: null };
  },
  useRef: (v) => {
    if (!curNode.__h) curNode.__h = [];
    const i = curNode.__hi++;
    if (!(i in curNode.__h)) curNode.__h[i] = { current: v };
    return curNode.__h[i];
  },
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useSyncExternalStore: (_s, get) => get(),
};
global.window = global.window || {};
global.window.React = React;

// ---------- DOM stubs ----------
const store = new Map();
function mkEl() {
  return {
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, appendChild() {}, addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 30 }),
    contains: () => false, offsetWidth: 0, querySelectorAll: () => [],
  };
}
// document 事件：照 window 同款收集 + 派发。
// 必须真的能派发——client 用 visibilitychange 决定「隐藏时断开行情流、
// 但保持预警流」，这条破例只能靠派发该事件来验证。
const DOC_L = {};
global.document = {
  createElement: mkEl,
  head: { appendChild() {} },
  addEventListener: (t, f) => { (DOC_L[t] = DOC_L[t] || []).push(f); },
  removeEventListener: (t, f) => { if (DOC_L[t]) DOC_L[t] = DOC_L[t].filter((x) => x !== f); },
  hidden: false,
  querySelector: (sel) => {
    // LF_TEST_SEAT=1 走「能测到 composer seat」的真实探测分支；
    // global.__forceSeat 供单个用例临时打开（默认不开，避免影响其它断言）
    if (process.env.LF_TEST_SEAT === "1" || global.__forceSeat) {
      // 模拟 composer seat：预警弹窗的定位要沿 parentElement 往上爬几层
      // 才拿得到"对话面板"几何（useConversationRect 的实现），所以这里必须
      // 造出父链——否则探测分支永远走不到，只剩回退路径，
      // 「窄窗口下钳制」这类断言会完全空转（踩过）。
      const mkBox = (r) => ({
        getBoundingClientRect: () => r,
        parentElement: null,
      });
      // 三层父链：seat(920×140 @240,620) → 面板(1000×700 @120,80)
      const panel = mkBox({ left: 120, top: 80, right: 1120, bottom: 780, width: 1000, height: 700 });
      const mid = mkBox({ left: 160, top: 560, right: 1080, bottom: 780, width: 920, height: 220 });
      mid.parentElement = panel;
      const seat = mkBox({ left: 240, top: 620, right: 1160, bottom: 760, width: 920, height: 140 });
      seat.parentElement = mid;
      return seat;
    }
    return null; // 默认：找不到 composer seat → 回退视口左下角
  },
};
global.__docDispatch = (t, ev) => { for (const f of (DOC_L[t] || []).slice()) f(ev || {}); };
global.window.document = global.document;

// EventSource 替身：记录实例与开关状态，供「预警流隐藏不断」这类断言使用。
// 不做真实网络——真实路由已由 http server 覆盖，这里只验证生命周期语义。
const ES_INSTANCES = [];
class FakeEventSource {
  constructor(url) {
    this.url = String(url);
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    ES_INSTANCES.push(this);
  }
  close() { this.closed = true; }
  /** 测试驱动：投递一帧 */
  emit(obj) { if (!this.closed && typeof this.onmessage === "function") this.onmessage({ data: JSON.stringify(obj) }); }
}
global.EventSource = FakeEventSource;
global.window.EventSource = FakeEventSource;
global.__esOpen = (kind) => ES_INSTANCES.some((e) => !e.closed && e.url.indexOf(kind) >= 0);
global.__esLast = (kind) => ES_INSTANCES.filter((e) => e.url.indexOf(kind) >= 0).slice(-1)[0];
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.window.localStorage = global.localStorage;
const WIN_L = {};
global.window.addEventListener = (t, f) => { (WIN_L[t] = WIN_L[t] || []).push(f); };
global.window.removeEventListener = (t, f) => { if (WIN_L[t]) WIN_L[t] = WIN_L[t].filter((x) => x !== f); };
global.__winDispatch = (t, ev) => { for (const f of (WIN_L[t] || []).slice()) f(ev); };
const jsonResponse = (obj, status = 200) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => obj, text: async () => JSON.stringify(obj),
  clone() { return this; },
});
global.window.innerWidth = 1400;
global.window.innerHeight = 900;
global.window.matchMedia = () => ({ matches: false });
const REAL_FETCH = global.fetch;
// POST /config 的累计次数：让「等配置落库」变成等条件，而不是睡固定 700ms
let configPostCount = 0;
// LF_DROP_MA=1：模拟旧版 host（不认识 ma 字段，保存后回填的配置里没有它）
const patchedFetch = async (url, opts) => {
  const u = String(url);
  if (/\/config/.test(u) && opts && opts.method === "POST") configPostCount++;
  const r = await REAL_FETCH(u.startsWith("http") ? u : ORIGIN + u, opts);
  if (process.env.LF_DROP_MA === "1" && /\/config/.test(u) && opts && opts.method === "POST") {
    const j = await r.clone().json();
    if (j && j.config) { delete j.config.ma; return jsonResponse(j, r.status); }
  }
  return r;
};
global.window.fetch = patchedFetch;
global.fetch = patchedFetch;
global.AbortSignal = AbortSignal;
global.confirm = () => false;
global.alert = () => {};

// ---------- 旧 localStorage 键名搬迁（插件改名前用 lf.* 前缀）----------
// 必须在加载 client 之前塞入，搬迁在 factory 执行时跑
store.set("lf.theme.v1", "light");
store.set("lf.bar.pos.v1", JSON.stringify({ x: 33, y: 44 }));
store.set("lf.overlay.size.v1", JSON.stringify({ w: 500, h: 400 }));
// 同时验证「搬迁逻辑确实在工作」：本次禁用它，下面三条断言必须失败。
// 若哪天有人把 IIFE 删了，这里会静默通过——所以必须真的把它关掉再跑一遍。
if (process.env.SL_NO_LS_MIGRATE === "1") global.__SL_NO_LS_MIGRATE__ = true;

// ---------- 加载 client ----------
let clientDef = null;
global.window.__ModuleLoader__ = { load: (def) => { clientDef = def; } };
await import("../client.js");
if (!clientDef) throw new Error("client did not register");
const clientMod = clientDef.factory((n) => {
  if (n === "react") return React;
  throw new Error("unexpected require " + n);
});

// 搬迁断言：值保住了、旧键清掉了
if (process.env.SL_NO_LS_MIGRATE === "1") {
  check("[自检] 关掉搬迁后旧键应留在原地", store.has("lf.theme.v1") && !store.has("sl.theme.v1"), { old: store.has("lf.theme.v1"), new: store.has("sl.theme.v1") });
} else {
  check("旧键 lf.theme.v1 的值搬到新键", store.get("sl.theme.v1") === "light", store.get("sl.theme.v1"));
  check("旧键 lf.bar.pos.v1 的值搬到新键", store.get("sl.bar.pos.v1") === JSON.stringify({ x: 33, y: 44 }), store.get("sl.bar.pos.v1"));
  check("旧键搬迁后已删除", !store.has("lf.theme.v1") && !store.has("lf.bar.pos.v1"), true);
}
// 清掉刚才塞的种子数据，否则会污染后续用例（如「floating 使用 fixed 锚定」依赖默认位置）
for (const k of ["sl.theme.v1", "sl.bar.pos.v1", "sl.overlay.size.v1", "lf.theme.v1", "lf.bar.pos.v1", "lf.overlay.size.v1"]) store.delete(k);

// ---------- 捕获 slot 注册（一个 slot 可能有多个 occupant） ----------
const slots = {}; // key -> [registrations]
const ctx = {
  slots: {
    inject: (key, cb) => { const r = cb(); (slots[key] = slots[key] || []).push(r); return () => {}; },
    register: (meta, render) => ({ name: meta.name, id: meta.id, render }),
  },
  get: () => undefined,
  effect: (fn) => fn(),
};
clientMod.apply(ctx);
function findReg(key, id) { return (slots[key] || []).find((r) => r.id === id); }

// ---------- 渲染辅助 ----------
const HOOK_STORE = new Map();
function walk(node, out, path) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, out, path + "/" + i));
    return out;
  }
  if (typeof node.type === "function") {
    const key = path + "#" + (node.type.name || "anon");
    const prev = curNode;
    curNode = node;
    try {
      let child;
      if (node.type.prototype instanceof ReactComponent) {
        // 类组件（ErrorBoundary）：new + render
        if (!node.__inst) node.__inst = new node.type(Object.assign({}, node.props));
        node.__inst.props = Object.assign({}, node.props);
        child = node.__inst.render();
      } else {
        // 函数组件：hooks 按树路径跨渲染复用（模拟 React reconciliation）
        if (!HOOK_STORE.has(key)) HOOK_STORE.set(key, []);
        node.__h = HOOK_STORE.get(key);
        node.__hi = 0;
        child = node.type(Object.assign({}, node.props));
      }
      node.__rendered = child;
      walk(child, out, key);
    } catch (e) {
      node.__error = e;
      out.push({ error: e, fn: node.type.name });
    } finally {
      curNode = prev;
    }
    return out;
  }
  if (node.children) node.children.forEach((c, i) => walk(c, out, path + ">" + i));
  return out;
}
function renderTree(node) {
  const errs = [];
  for (let pass = 0; pass < 4; pass++) {
    const found = walk(node, [], "root");
    attachRefs(node);
    // ref 就位后再跑 effect，顺序与真实 React 一致
    const q = pendingEffects.splice(0);
    for (const e of q) {
      let cleanup;
      try { cleanup = e.fn(); } catch { /* ignore */ }
      e.hookState[e.i] = { deps: e.hookState[e.i].deps, cleanup: typeof cleanup === "function" ? cleanup : null };
    }
    for (const f of found) if (f.error) errs.push(f);
  }
  return errs;
}
/** mini-React 不挂 ref：渲染后遍历，把 props.ref 赋一个带 getBoundingClientRect 的假元素 */
function collectIdxRows(node, acc) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { for (const n of node) collectIdxRows(n, acc); return acc; }
  if (node.props && node.props["data-sl-idx"] !== undefined) acc.push(node);
  if (node.__rendered) collectIdxRows(node.__rendered, acc);
  if (node.children) collectIdxRows(node.children, acc);
  return acc;
}
function attachRefs(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) attachRefs(n); return; }
  if (node.props && node.props.ref) {
    const fake = mkEl();
    fake.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 24, width: 200, height: 24 });
    // 模拟真实尺寸：指数悬浮栏约 260×28（resize 钳制逻辑按 offsetWidth/offsetHeight 计算）
    fake.offsetWidth = 260;
    fake.offsetHeight = 28;
    // 可排序容器：querySelectorAll("[data-sl-idx]") 返回堆叠假行（top = idx*30, height 28）
    fake.querySelectorAll = (sel) => {
      if (sel !== "[data-sl-idx]") return [];
      const idxs = [];
      collectIdxRows(node, idxs);
      idxs.sort((a, b) => Number(a.props["data-sl-idx"]) - Number(b.props["data-sl-idx"]));
      return idxs.map((rn, i) => {
        const el = mkEl();
        const top = i * 30;
        el.getBoundingClientRect = () => ({ left: 0, top, right: 200, bottom: top + 28, width: 200, height: 28 });
        return el;
      });
    };
    if (typeof node.props.ref === "function") { try { node.props.ref(fake); } catch { /* ignore */ } }
    else node.props.ref.current = fake;
  }
  if (node.__rendered) attachRefs(node.__rendered);
  if (node.children) for (const c of node.children) attachRefs(c);
}
function textOf(node, acc = []) {
  if (node === null || node === undefined) return acc;
  if (typeof node === "string" || typeof node === "number") { acc.push(String(node)); return acc; }
  if (Array.isArray(node)) { for (const n of node) textOf(n, acc); return acc; }
  if (typeof node.type === "function") {
    // 组件节点：只走渲染产物（children 是传给组件的插槽，已由 __rendered 覆盖）
    if (node.__rendered) textOf(node.__rendered, acc);
    else if (node.props && node.props.children) textOf(node.props.children, acc);
    return acc;
  }
  if (node.children) for (const c of node.children) textOf(c, acc);
  return acc;
}
/** 穿过组件/ErrorBoundary 层，找到第一个带 style 的宿主节点 props.style */
function rootStyleOf(node) {
  let cur = node;
  for (let i = 0; i < 8 && cur; i++) {
    if (typeof cur.type === "function") { cur = Array.isArray(cur.__rendered) ? cur.__rendered[0] : cur.__rendered; continue; }
    if (Array.isArray(cur)) { cur = cur[0]; continue; }
    if (cur.props && cur.props.style) return cur.props.style;
    cur = cur.__rendered;
  }
  return {};
}

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else { fails++; console.log("  FAIL", label, extra ? String(extra).slice(0, 400) : ""); }
}
function findNode(node, pred, seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node)) { for (const n of node) { const r = findNode(n, pred, seen); if (r) return r; } return null; }
  if (pred(node)) return node;
  if (node.__rendered) { const r = findNode(node.__rendered, pred, seen); if (r) return r; }
  if (node.children) { for (const c of node.children) { const r = findNode(c, pred, seen); if (r) return r; } }
  return null;
}
function click(node) {
  if (!node || !node.props || !node.props.onClick) return false;
  node.props.onClick({ stopPropagation() {}, preventDefault() {}, target: mkEl(), currentTarget: mkEl() });
  return true;
}
/** 触发右键（持仓行/自选行的 onContextMenu → 打开全局右键菜单） */
function contextMenu(node) {
  if (!node || !node.props || !node.props.onContextMenu) return false;
  node.props.onContextMenu({ button: 2, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
  return true;
}
/** 在已渲染树里找右键菜单项按钮（className 含 sl-menu-item，按标签子串匹配） */
function findMenuItem(root, labelSub) {
  // 菜单项现在带线性 SVG 图标（children[0] 是 svg，文字在后面的 span 里），
  // 不能只看 children[0] —— 用 textOf 聚合整项文字再匹配。
  return findNode(root, (n) => n.type === "button"
    && String((n.props && n.props.className) || "").indexOf("sl-menu-item") >= 0
    && textOf(n).join("").indexOf(labelSub) >= 0);
}
/** 关闭右键菜单（ContextMenu 的 Escape useEffect 监听 window keydown） */
function dismissMenu() { global.__winDispatch("keydown", { key: "Escape" }); }
/** 找持仓行根 div（className 以 sl-pos 开头，可右键） */
function posRow(root) {
  return findNode(root, (n) => n.type === "div"
    && String((n.props && n.props.className) || "").startsWith("sl-pos")
    && typeof n.props.onContextMenu === "function");
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 配置落库防抖改成 0：线上 500ms 是为了合并连续改动（拖排序等），
// 测试里却逼着每条「等落库」的用例各睡 700ms——整个套件 25 秒里有一大截是这么来的。
// 注意必须在 client.js 被加载**之前**设好，见本文件顶部的全局 stub 区。
globalThis.__SL_SAVE_DEBOUNCE__ = 0;

/**
 * 把「当前时间」钉死在一个确定的**盘中**时刻（2026-10-15 周四 14:45 北京时间）。
 *
 * 指数栏现在按时段自动展开/收起，于是「跑测试时恰好是几点」直接决定断言成不成立：
 * 收盘后跑，"指数栏出现收益胶囊"必挂。钉死时间后，用例与真实钟点无关。
 */
const TS_IN_SESSION = Date.parse("2026-10-15T06:45:00Z"); // 14:45 北京
globalThis.__sl_now__ = TS_IN_SESSION;

/** 设定指数栏判定用的当前时间（毫秒时间戳）；传 null 恢复真实时间 */
const setNow = (ts) => { globalThis.__sl_now__ = ts; };

/** 读出当前指数栏的可见文本 */
const barTexts = () => {
  let bn = floatReg.render({});
  renderTree(bn);
  return textOf(bn).join(" ");
};

/** 指数栏里有没有指数胶囊 / 收益胶囊 */
const barHas = (cls) => {
  let bn = floatReg.render({});
  renderTree(bn);
  return !!findNode(bn, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf(cls) >= 0);
};
/**
 * 指数胶囊的 className 就是裸的 "sl-chip"（收益胶囊是 "sl-chip sl-chip-earn"）。
 * 用「className 恰好等于 sl-chip」来认它——别指望 sl-chip-idx，那个不存在（踩过）。
 */
const barHasIndex = () => {
  let bn = floatReg.render({});
  renderTree(bn);
  return !!findNode(bn, (n) => n.type === "span" && String((n.props && n.props.className) || "") === "sl-chip");
};

/**
 * 轮询等待某个条件成立。
 *
 * 固定 sleep 是测试变慢的主因：绝大多数「等 X 准备好」其实几十毫秒就绪，
 * 但没人敢赌，只能睡满上限。改成轮询后，常态路径立刻返回；
 * 慢的时候也不会比原来的固定上限更糟（超时即放弃）。
 */
async function until(pred, timeoutMs = 3000, step = 20) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() - t0 >= timeoutMs) return false;
    await wait(step);
  }
}

/** 等 store 里出现某只股票的行情（首屏 /quotes 往返） */
const waitQuotes = (code, timeout = 5000) =>
  until(() => !!((global.__sl_test_state__ || {}).quotes || {})[code], timeout);

/**
 * 解析带「万/亿」后缀的金额（floatSigned/fmtSigned 会自动换算单位）。
 * 只支持 +/- 数字 + 可选单位，够用即可。
 */
function parseAmt(s) {
  if (s === undefined || s === null) return NaN;
  const m = /([+-]?[\d.]+)\s*(万|亿)?/.exec(String(s));
  if (!m) return NaN;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return NaN;
  if (m[2] === "万") n *= 1e4;
  else if (m[2] === "亿") n *= 1e8;
  return n;
}

/**
 * 从**指数栏收益胶囊的悬浮浮层**里读今日/累计金额。
 *
 * 刻意不读持仓页表头：那条路径历史上本来就是对的（它逐行算，不跳过 qty=0），
 * 读它会让断言变绿却测不到被修的 bug——踩过一次。
 * 胶囊浮层走的是 earningsDetail，正是清仓后丢收益的那条路径。
 */
function readBarEarn(root) {
  const txt = textOf(root || {}).join(" ");
  const t = /今日收益\s*([+-][\d.]+\s*(?:万|亿)?)/.exec(txt);
  const p = /累计收益\s*([+-][\d.]+\s*(?:万|亿)?)/.exec(txt);
  return { today: t ? parseAmt(t[1]) : NaN, pnl: p ? parseAmt(p[1]) : NaN, txt };
}

/** 指数栏里是否还有收益胶囊（无持仓时 computeEarnings.has=false，胶囊不渲染） */
function readBarEarnText() {
  let bn = floatReg.render({});
  renderTree(bn);
  return !!findNode(bn, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-chip-earn") >= 0);
}

// ---------- 1. 指数栏（默认 floating：经 shell.overlay 锚定，新会话页也显示） ----------
const dockReg = findReg("conversation.composer.dock", "dsh-stock-leek.bar");
const floatReg = findReg("shell.overlay", "dsh-stock-leek.floating-bar");
const ovReg = findReg("shell.overlay", "dsh-stock-leek");
check("dock 槽位注册存在", !!dockReg);
check("floating 栏注册存在", !!floatReg);
check("overlay 注册存在", !!ovReg);

let barNode = floatReg.render({});
let errs = renderTree(barNode);
check("FloatingIndexBar 无渲染错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
// floating 模式下 composer.dock 内的 IndexBar 应返回 null（避免双份）
const dockNode = dockReg.render({});
renderTree(dockNode);
check("floating 模式下 dock IndexBar 不渲染", textOf(dockNode).join("").trim() === "", textOf(dockNode).join(" ").slice(0, 80));
// 等 /config 与 /quotes 返回：原来无脑睡 1500ms，实际通常几百毫秒就好了。
// 改成等条件——store 里出现指数行情即继续，顺带把网络抖动的影响也削掉。
await until(() => Object.keys((global.__sl_test_state__ || {}).quotes || {}).length > 0, 6000);
barNode = floatReg.render({});
errs = renderTree(barNode);
check("FloatingIndexBar 二次渲染无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
let barText = textOf(barNode).join(" ");
console.log("   指数栏文本:", barText.slice(0, 220));
check("指数栏含上证/深证", /上证/.test(barText) && /深证/.test(barText), barText.slice(0, 160));
check("指数栏含点位数字", /\d{4}\.\d|\d{3}\.\d/.test(barText), barText.slice(0, 160));
// 需求③：左下角用简称（不显示「上证指数/深证成指」全称）
check("指数栏用简称（无全称）", !/上证指数/.test(barText) && !/深证成指/.test(barText), barText.slice(0, 160));
// 需求①：可自由移动 —— ⚙ 设置按钮即拖动手柄（无独立 📈 按钮）
const gear = findNode(barNode, (n) => n.type === "button" && String((n.props && n.props.className) || "").indexOf("sl-gear") >= 0);
check("⚙ 设置按钮存在且为拖动手柄", !!gear && typeof gear.props.onPointerDown === "function");
check("指数栏已无独立📈按钮", !/打开行情悬浮窗/.test(textOf(barNode).join(" ")));
// 模拟拖动：⚙ onPointerDown 记录起点 → window pointermove(>阈值) → pointerup → 位置变手动（left/top）
if (gear) {
  gear.props.onPointerDown({ button: 0, clientX: 30, clientY: 800, preventDefault() {}, stopPropagation() {} });
  global.__winDispatch("pointermove", { clientX: 260, clientY: 420 });
  global.__winDispatch("pointerup", {});
  const dragged = floatReg.render({});
  renderTree(dragged);
  const dstyle = rootStyleOf(dragged);
  console.log("   拖动后 style:", JSON.stringify(dstyle).slice(0, 150));
  check("拖动后改为手动定位（left/top，无 bottom）", dstyle.position === "fixed" && typeof dstyle.left === "number" && typeof dstyle.top === "number" && dstyle.bottom === undefined, JSON.stringify(dstyle).slice(0, 150));
  check("拖动位置已持久化", !!global.localStorage.getItem("sl.bar.pos.v1"), global.localStorage.getItem("sl.bar.pos.v1"));
  // 拖动结束后的 click 应被抑制（不误开设置）：pointerup 后同步立即 click → 悬浮窗仍关闭
  const gear2 = findNode(dragged, (n) => n.type === "button" && String((n.props && n.props.className) || "").indexOf("sl-gear") >= 0);
  if (gear2 && gear2.props.onClick) gear2.props.onClick({ stopPropagation() {}, preventDefault() {} });
  const afterSuppressed = textOf(ovReg.render({})).join(" ");
  check("拖动后 click 被抑制（不误开设置）", !findNode(ovReg.render({}), (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-panel"), afterSuppressed.slice(0, 80));
  // 双击手柄 → 回到自动锚定（bottom 恢复）
  gear2.props.onDoubleClick({ preventDefault() {}, stopPropagation() {} });
  const back = floatReg.render({});
  renderTree(back);
  const bstyle = rootStyleOf(back);
  check("双击回到自动锚定（bottom 恢复）", typeof bstyle.bottom === "number" && bstyle.top === undefined, JSON.stringify(bstyle).slice(0, 150));
}

// 回归：窗口缩小 → 悬浮栏贴边可见；窗口放大 → 回到用户原来的位置。
// 反面教训：曾把钳制结果回写 localStorage，导致"放大缩小放大后位置回不去"。
{
  // 1. 先拖一次，产生手动位置（前面的拖动测试最后被双击清掉了，这里重新造）
  const g = findNode(barNode, (n) => n.type === "button" && String((n.props && n.props.className) || "").indexOf("sl-gear") >= 0);
  check("找到拖动手柄 ⚙", !!g);
  if (g) {
    g.props.onPointerDown({ button: 0, clientX: 100, clientY: 800, preventDefault() {}, stopPropagation() {} });
    global.__winDispatch("pointermove", { clientX: 400, clientY: 300 }); // 拖到 x≈300, y≈300
    global.__winDispatch("pointerup", {});
  }
  const cur = JSON.parse(global.localStorage.getItem("sl.bar.pos.v1") || "null");
  check("已产生手动位置", !!cur, cur);
  const origX = cur ? cur.x : 0;
  const origY = cur ? cur.y : 0;
  const origRaw = global.localStorage.getItem("sl.bar.pos.v1");

  // 2. 缩小窗口：1400×900 → 400×300 → 渲染位置必须被钳进视口
  global.window.innerWidth = 400;
  global.window.innerHeight = 300;
  global.__winDispatch("resize", {});
  const smallTree = floatReg.render({});
  renderTree(smallTree);
  const smallStyle = rootStyleOf(smallTree);
  console.log("   缩小后 rendered:", JSON.stringify({ left: smallStyle.left, top: smallStyle.top }), "| 存储:", global.localStorage.getItem("sl.bar.pos.v1"));
  check("缩小时后渲染位置在视口内（left ≤ innerWidth-100）", typeof smallStyle.left === "number" && smallStyle.left <= 400 - 100, smallStyle.left);
  check("缩小时后渲染位置在视口内（top ≤ innerHeight-60）", typeof smallStyle.top === "number" && smallStyle.top <= 300 - 60, smallStyle.top);
  // 关键断言：存储里的**原始坐标必须原样保留**，不能被钳制值覆盖
  check("存储保留用户原位坐标（未被钳制值覆盖）", global.localStorage.getItem("sl.bar.pos.v1") === origRaw, { orig: origRaw, now: global.localStorage.getItem("sl.bar.pos.v1") });

  // 3. 放大回原尺寸 → 渲染位置必须回到原位（这正是用户报告的故障点）
  global.window.innerWidth = 1400;
  global.window.innerHeight = 900;
  global.__winDispatch("resize", {});
  const bigTree = floatReg.render({});
  renderTree(bigTree);
  const bigStyle = rootStyleOf(bigTree);
  console.log("   放大后 rendered:", JSON.stringify({ left: bigStyle.left, top: bigStyle.top }), "（原位:", origX, origY, "）");
  check("放大后回到用户原位 x", bigStyle.left === origX, { want: origX, got: bigStyle.left });
  check("放大后回到用户原位 y", bigStyle.top === origY, { want: origY, got: bigStyle.top });
}
// 锚定样式：fixed + left/bottom（穿透 ErrorBoundary 找到根 div style）
const rootStyle = rootStyleOf(barNode);
console.log("   floating 根 div style:", JSON.stringify(rootStyle).slice(0, 160));
check("floating 使用 fixed 锚定", rootStyle.position === "fixed" && typeof rootStyle.bottom === "number", JSON.stringify(rootStyle).slice(0, 160));

// ---------- 2. 点击指数胶囊 → 打开大悬浮窗 ----------
const chip = findNode(barNode, (n) => n.type === "span" && String((n.props && n.props.className) || "") === "sl-chip");
check("指数栏存在可点击指数胶囊", !!chip);
click(chip);

const ov = ovReg;
let ovNode = ov.render({});
errs = renderTree(ovNode);
check("Overlay 展开无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));

// ---------- 2.1 FreshBadge 数据新鲜度徽标 ----------
const freshBadge = findNode(ovNode, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-fresh") >= 0);
check("标题栏存在 FreshBadge 徽标", !!freshBadge);
if (freshBadge) {
  const badgeText = String((freshBadge.children && freshBadge.children[0]) || "");
  const badgeClass = String(freshBadge.props.className || "");
  const badgeTip = String(freshBadge.props["data-sltip"] || "");
  console.log("   FreshBadge:", { text: badgeText, class: badgeClass, tip: badgeTip.slice(0, 80) });
  // 已拿到行情时：⏱Ns 正计时（正计时，越大越旧）
  check("FreshBadge 显示 ⏱Ns 数据年龄", /^⏱(\d+)s$/.test(badgeText), badgeText);
  // 数据新鲜（刚拉过行情）时不应标陈旧
  check("数据新鲜时无 stale 类", badgeClass.indexOf("sl-fresh-stale") < 0, badgeClass);
  check("FreshBadge 带 tooltip", /刷新间隔/.test(badgeTip), badgeTip);
}

let ovText = textOf(ovNode).join(" ");
console.log("   悬浮窗(大盘)片段:", ovText.slice(0, 300));
check("大盘 tab 标题", /上证指数/.test(ovText), ovText.slice(0, 120));
check("大盘 tab 有行情数字", /\d{3,6}\.\d/.test(ovText), ovText.slice(0, 120));
check("大盘含左下角勾选列", /栏/.test(ovText));

// ---------- 2b. 列表超过 10 行时内部出现滚动条 ----------
// 默认配置有 12 个指数，正好超过阈值；测试桩里假行高为 28px，
// 因此期望上限 = 28 * 10 + 1 = 281px（+1 容纳行间分隔线）。
{
  const listNode = findNode(ovNode, (n) => String((n.props && n.props.className) || "").indexOf("sl-sortable") === 0);
  const cls = String((listNode && listNode.props && listNode.props.className) || "");
  const rawCap = (listNode && listNode.props && listNode.props.style && listNode.props.style.maxHeight) || "";
  // style.maxHeight 是 "281px" 这样的字符串，Number("281px") 是 NaN，必须先剥掉单位
  const capPx = parseInt(String(rawCap), 10);
  check("超 10 行时列表加滚动类", cls.indexOf("sl-sortable-cap") >= 0, cls);
  check("滚动上限按实测行高算（28px×10+1=281）", capPx === 281, { raw: rawCap, got: capPx });
  // 关键：上限落在**列表容器**上，而不是整个 .sl-body——
  // 否则表头和底部搜索框会被一起滚走，那正是本次要修的问题。
  const bodyNode = findNode(ovNode, (n) => (n.props && n.props.className) === "sl-body");
  check("滚动上限不在 .sl-body 上（表头/搜索框保持可见）", !(bodyNode && bodyNode.props.style && bodyNode.props.style.maxHeight), bodyNode && bodyNode.props.style);
}
const titleOf = (node) => {
  const t = findNode(node, (n) => n.type === "span" && String((n.props && n.props.className) || "") === "sl-title");
  return t ? { text: String((t.children && t.children[0]) || ""), tip: String(t.props["data-sltip"] || "") } : null;
};
// 标题彩蛋：无持仓时固定「📈 观望中」，有持仓后随今日盈亏变脸
const t0 = titleOf(ovNode);
check("无持仓时标题为观望中", !!t0 && t0.text === "📈 观望中", t0 && t0.text);
check("标题带变脸提示", !!t0 && /变脸/.test(t0.tip), t0 && t0.tip);

// ---------- 3. 切换 tab ----------
function clickTab(label) {
  const t = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === label);
  click(t);
  ovNode = ov.render({});
  const e = renderTree(ovNode);
  check("tab " + label + " 无错误", e.length === 0, e[0] && (e[0].error.stack || e[0].error));
  return textOf(ovNode).join(" ");
}
ovText = clickTab("自选");
check("自选含贵州茅台/宁德时代", /茅台|宁德/.test(ovText), ovText.slice(0, 200));
ovText = clickTab("持仓");
check("持仓 tab 有表头", /成本价|还没有持仓/.test(ovText), ovText.slice(0, 200));
ovText = clickTab("设置");
check("设置含数据源测试按钮", /测试数据源/.test(ovText), ovText.slice(0, 200));
check("设置含刷新间隔", /刷新间隔/.test(ovText));
check("设置含放置方式", /放置方式/.test(ovText) && /悬浮锚定/.test(ovText), ovText.slice(0, 240));
// 切到 dock 放置：floating 栏应停渲，composer.dock 内 IndexBar 应渲染
const dockBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "嵌入输入框");
check("设置含嵌入输入框选项", !!dockBtn);
click(dockBtn);
await wait(200);
const floatNode2 = floatReg.render({});
renderTree(floatNode2);
check("dock 模式下 floating 栏不渲染", textOf(floatNode2).join("").trim() === "", textOf(floatNode2).join(" ").slice(0, 80));
const dockNode2 = dockReg.render({});
renderTree(dockNode2);
check("dock 模式下 IndexBar 渲染出上证", /上证/.test(textOf(dockNode2).join(" ")), textOf(dockNode2).join(" ").slice(0, 120));
// 位置：宿主把 dock 槽位与「上下文占用(52%)」并排放在同一个 flex 行里，槽位默认在前。
// 需求是排在 52% 之后 → 靠给自己 order:1 实现（宿主容器类名是哈希的，不能去改它）。
{
  const dbgRoot = findNode(dockNode2, (n) => n.type === "div" && String((n.props && n.props.className) || "").indexOf("sl-root") >= 0);
  // dockNode2 是**组件节点**，props.style 是 undefined；真正的样式在它渲染出的
  // sl-root div 上（与 textOf 必须跟 __rendered 是同一个道理，踩过一次）。
  const st = (dbgRoot && dbgRoot.props && dbgRoot.props.style) || {};
  check("dock 模式下自带 order:1（排在上下文占用之后）", String(st.order) === "1", { order: st.order, style: st });
  check("同时保留主题色变量（extraStyle 没把原样式覆盖掉）",
    !!st["--sl-up"] && !!st["--sl-down"], Object.keys(st));
}
// 切回 floating
const floatBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "悬浮锚定");
click(floatBtn);
await wait(200);
clickTab("大盘");

// ---------- 4. 详情（分时/K线）：切到自选页再点第一行 ----------
clickTab("自选");
const row = findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "").indexOf("sl-sortable-row") >= 0 && typeof n.props["data-sltip"] === "string" && n.props["data-sltip"].indexOf("高 ") >= 0);
check("找到可点击行情行", !!row);
click(row);
ovNode = ov.render({});
errs = renderTree(ovNode);
check("详情渲染无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
// 等日K 的 K 线真的画出来（原来睡 1200ms 等 /kline 往返）
await until(() => {
  ovNode = ov.render({});
  renderTree(ovNode);
  return !!findNode(ovNode, (n) => n.type === "svg");
}, 6000);
ovNode = ov.render({});
renderTree(ovNode);
ovText = textOf(ovNode).join(" ");
check("详情含分时/K线切换", /分时/.test(ovText) && /日K/.test(ovText), ovText.slice(0, 240));
check("详情含指标", /今开|昨收|最高/.test(ovText), ovText.slice(0, 240));
check("详情已屏蔽「🤖 分析」入口", ovText.indexOf("分析") < 0 && !findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("分析") >= 0), ovText.slice(0, 240));

// 五档盘口：**左卖右买**两列，且手数/金额可切换
{
  const txtOf = (root) => {
    const seg = [];
    (function inner(x) {
      // 字符串判断必须在"非对象就返回"之前，否则文本会被静默丢掉（踩过）
      if (typeof x === "string" || typeof x === "number") { seg.push(String(x)); return; }
      if (!x || typeof x !== "object") return;
      if (Array.isArray(x)) { x.forEach(inner); return; }
      if (typeof x.type === "function") { inner(x.__rendered); return; }
      if (x.children) x.children.forEach(inner);
      else if (x.props && x.props.children !== undefined) inner(x.props.children);
    })(root);
    return seg.join(" ");
  };
  const collect = (root, pred) => {
    const out = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (pred(n)) out.push(n);
      if (typeof n.type === "function") { walk(n.__rendered); return; }
      if (n.children) n.children.forEach(walk);
    })(root);
    return out;
  };
  const ob = findNode(ovNode, (n) => String((n.props && n.props.className) || "") === "sl-ob");
  check("详情页有五档盘口区块", !!ob, ovText.slice(0, 240));
  if (ob) {
    // 1) 两列结构：左卖右买（DOM 顺序 = 视觉顺序，flex 行内先出现的在左边）
    const askSide = collect(ob, (n) => String((n.props && n.props.className) || "").indexOf("sl-ob-side-ask") >= 0);
    const bidSide = collect(ob, (n) => String((n.props && n.props.className) || "").indexOf("sl-ob-side-bid") >= 0);
    check("盘口分成卖盘/买盘两列", askSide.length === 1 && bidSide.length === 1, { ask: askSide.length, bid: bidSide.length });
    // 关键：卖盘列必须排在买盘列**之前**（= 在左侧）
    const allSides = collect(ob, (n) => {
      const c = String((n.props && n.props.className) || "");
      return c.indexOf("sl-ob-side") >= 0;
    });
    check("卖盘在左、买盘在右（左卖右买）",
      allSides.length === 2 && /ask/.test(String(allSides[0].props.className)) && /bid/.test(String(allSides[1].props.className)),
      allSides.map((s) => s.props.className));

    // 2) 每列内部的档位顺序：卖 5→1（向中间收敛）、买 1→5
    const lvOf = (side, ch) => collect(side, (n) => String((n.props && n.props.className) || "") === "sl-ob-lv")
      .map((n) => { const m = new RegExp(ch + "(\\d)").exec(txtOf(n)); return m ? Number(m[1]) : null; });
    if (askSide.length === 1) {
      const askLv = lvOf(askSide[0], "卖");
      // 卖1 在最上、往下是卖5（与买盘同向：都从贴近现价的一档开始）
      check("卖盘列自上而下是 卖1→卖5", askLv.length >= 2 && askLv.every((v, i) => v !== null && (i === 0 || askLv[i - 1] <= v)) && askLv[0] < askLv[askLv.length - 1], askLv);
    }
    if (bidSide.length === 1) {
      const bidLv = lvOf(bidSide[0], "买");
      check("买盘列自上而下是 买1→买5", bidLv.length >= 2 && bidLv.every((v, i) => v !== null && (i === 0 || bidLv[i - 1] <= v)) && bidLv[0] < bidLv[bidLv.length - 1], bidLv);
    }
    check("有列头标注 卖盘/买盘", /卖盘/.test(txtOf(ob)) && /买盘/.test(txtOf(ob)), txtOf(ob).slice(0, 120));

    // 3) 单位切换：默认「手数」，点「金额」后同一档显示金额
    check("默认按手数显示（出现「手」）", /手/.test(txtOf(ob)), txtOf(ob).slice(0, 160));
    const amtBtn = findNode(ob, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "金额");
    check("盘口有「金额」切换按钮", !!amtBtn);
    if (amtBtn) {
      click(amtBtn);
      ovNode = ov.render({}); renderTree(ovNode);
      const ob2 = findNode(ovNode, (n) => String((n.props && n.props.className) || "") === "sl-ob");
      const t2 = txtOf(ob2);
      // 金额口径不应再出现「N手」，而应出现万/元
      check("切到金额后不再显示「手」", !/\d+手/.test(t2), t2.slice(0, 180));
      check("切到金额后显示金额单位（万/元）", /万|亿/.test(t2) || /\d{2,}/.test(t2), t2.slice(0, 180));
      check("切单位后卖盘仍在买盘左侧（结构不变）",
        (() => {
          const ss = collect(ob2, (n) => String((n.props && n.props.className) || "").indexOf("sl-ob-side") >= 0);
          return ss.length === 2 && /ask/.test(String(ss[0].props.className));
        })(), null);
      // 切回手数，避免影响后续断言
      const lotsBtn = findNode(ob2, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "手数");
      if (lotsBtn) { click(lotsBtn); ovNode = ov.render({}); renderTree(ovNode); }
    }
  }
}
// 切到日K
const dayBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "日K");
click(dayBtn);
ovNode = ov.render({});
errs = renderTree(ovNode);
check("日K 渲染无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
// 等 MA 数值标注真的算出来（原来睡 1000ms）。
// 判据要用「MA5 <数字>」这种带数值的形状——只匹配 /MA5|MA10/ 会命中常驻的切换按钮，
// 条件立刻成立、实际 K 线还没加载完，后面的数值断言就会红（踩过）。
await until(() => {
  ovNode = ov.render({});
  renderTree(ovNode);
  return /MA5 [\d.]+/.test(textOf(ovNode).join(" "));
}, 6000);
ovNode = ov.render({});
renderTree(ovNode);
check("日K 含 MA 切换", /MA5|MA10/.test(textOf(ovNode).join(" ")));
// MA 选择全局通用：写入全局 config，切走再回来保持
{
  const MA_ALL_CASES = [5, 10, 20, 60];
  const maBtn = (p) => findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "MA" + p);
  const maOnCfg = () => MA_ALL_CASES.filter((p) => { const b = maBtn(p); return !!b && /sl-tab-on/.test(b.props.className || ""); });
  const before = maOnCfg();
  check("MA 默认写进全局配置", Array.isArray(before) && before.join() === "5,10,20", JSON.stringify(before));
  click(maBtn(20)); // 关掉 MA20
  ovNode = ov.render({}); renderTree(ovNode);
  check("取消勾选后配置更新", maOnCfg().join() === "5,10", JSON.stringify(maOnCfg()));
  check("取消勾选后不再显示 MA20 数值", !/MA20 [\d.]+/.test(textOf(ovNode).join(" ")), "");
  click(maBtn(60)); // 打开 MA60
  ovNode = ov.render({}); renderTree(ovNode);
  check("勾选后配置更新", maOnCfg().join() === "5,10,60", JSON.stringify(maOnCfg()));
  check("勾选后显示 MA60 数值", /MA60 [\d.]+/.test(textOf(ovNode).join(" ")), "");
  // 返回上一层再进入详情，MA 选择应保持
  const back2 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("返回") >= 0);
  click(back2);
  ovNode = ov.render({}); renderTree(ovNode);
  const row = findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "").indexOf("sl-sortable-row") >= 0 && typeof n.props.onClick === "function");
  if (row) click(row);
  await wait(600);
  ovNode = ov.render({}); renderTree(ovNode);
  const dayBtn2 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "日K");
  click(dayBtn2);
  await wait(900);
  ovNode = ov.render({}); renderTree(ovNode);
  const t2 = textOf(ovNode).join(" ");
  check("重进详情 MA 选择保持", /MA60 [\d.]+/.test(t2) && !/MA20 [\d.]+/.test(t2), t2.slice(0, 200));
  // 还原默认，避免污染后续用例
  click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "MA20"));
  click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "MA60"));
  ovNode = ov.render({}); renderTree(ovNode);
  check("MA 可还原为默认", maOnCfg().join() === "5,10,20", JSON.stringify(maOnCfg()));
  // 回归：host 回填的配置若丢掉 ma（旧版 host），选择不得弹回默认
  click(maBtn(20)); // 关掉 MA20
  await wait(150); // 配置落库：本机 Host + 防抖已置 0，150ms 足够（原 900ms）
  ovNode = ov.render({}); renderTree(ovNode);
  check("host 回填丢 ma 时不弹回默认", maOnCfg().join() === "5,10", JSON.stringify(maOnCfg()));
  click(maBtn(20)); // 恢复
  ovNode = ov.render({}); renderTree(ovNode);
  check("MA 恢复", maOnCfg().join() === "5,10,20", JSON.stringify(maOnCfg()));
}
// MA 数值：图表左上角显示 MA5/10/20 数值（与切换按钮的「MA5」区分：后面跟数字）
{
  const maText = textOf(ovNode).join(" ");
  check("图表显示MA数值", /MA5 [\d.]+/.test(maText) && /MA10 [\d.]+/.test(maText) && /MA20 [\d.]+/.test(maText), maText.slice(0, 200));
  // 未勾选的 MA60 不应显示数值
  check("未勾选的MA60不显示", !/MA60 [\d.]+/.test(maText), maText.slice(0, 200));
}
// K 线成本线：无持仓不画；有成本则画虚线 + 右侧标签，且成本被纳入价格范围
{
  const klineOf = () => findNode(ovNode, (n) => n.type === "svg" && Array.isArray(n.children) && n.children.length > 10);
  const lineBy = (node, pred) => {
    let found = null;
    (function walk(n) {
      if (!n || typeof n !== "object" || found) return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n.type === "line" && pred(n.props || {})) found = n.props;
      (n.children || []).forEach(walk);
    })(node);
    return found;
  };
  const txtAll = (node) => {
    const out = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === "text" && Array.isArray(n.children)) out.push(n.children.filter((c) => typeof c === "string").join(""));
      (n.children || []).forEach(walk);
    })(node);
    return out.join(" ");
  };
  const dashes = (p) => String((p && p.strokeDasharray) || "");
  // 当前详情是贵州茅台（无持仓）→ 不应有成本线
  let svg = klineOf();
  check("无持仓时不画成本线", svg ? !lineBy(svg, (p) => dashes(p) && String(p.stroke || "").indexOf("sl-") >= 0) : false, "");
  check("无持仓时不显示成本标签", svg ? !/成本 /.test(txtAll(svg)) : false, txtAll(svg || {}));
}

// K 线缩放/平移：默认窗口 → 滚轮缩小 → 复位回默认窗口
{
  const chart = findNode(ovNode, (n) => n.type === "div" && n.props && typeof n.props.onWheel === "function");
  check("K线容器已绑定滚轮/拖动", !!chart);
  if (chart) {
    const rerender = () => { ovNode = ov.render({}); renderTree(ovNode); return textOf(ovNode).join(" "); };
    // 可视根数：底栏可能是「90/121 根」或全量时「共 121 根」
    const visOf = (t) => { const m = /(\d+)\/(\d+) 根/.exec(t); if (m) return Number(m[1]); const f = /共 (\d+) 根/.exec(t); return f ? Number(f[1]) : null; };
    const firstDate = (t) => { const m = /(\d{4}-\d{2}-\d{2}) ~ /.exec(t); return m ? m[1] : null; };
    const initVis = visOf(rerender());
    check("初始为默认窗口并显示 N/total", !!initVis && initVis < 121, String(initVis));
    // 滚轮下滚 → 窗口扩大（可视根数变多）
    const rect = { getBoundingClientRect: () => ({ left: 0, width: 404, top: 0, height: 200 }) };
    chart.props.onWheel({ deltaY: 120, clientX: 200, currentTarget: rect, preventDefault() {} });
    const zoomVis = visOf(rerender());
    check("滚轮缩放后可视根数变多", !!zoomVis && !!initVis && zoomVis > initVis, initVis + " → " + zoomVis);
    // 复位按钮恢复（底栏，非右上角浮动）
    const rstBtn = findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "复位");
    check("底栏出现复位按钮", !!rstBtn);
    check("右上角不再有＋/－按钮", !findNode(ovNode, (n) => n.type === "button" && ["＋", "－"].includes(String((n.children && n.children[0]) || ""))));
    if (rstBtn) { rstBtn.props.onClick({ stopPropagation() {} }); check("点复位恢复默认窗口", visOf(rerender()) === initVis, visOf(rerender()) + " vs " + initVis); }
    check("默认窗口下复位按钮隐藏", !findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "复位"));
    // 拖动平移：向右拖 → 显示更早的数据（默认窗口在最新端，向左拖已无空间）
    const c2 = findNode(ovNode, (n) => n.type === "div" && n.props && typeof n.props.onWheel === "function");
    const d0 = firstDate(rerender());
    if (c2) {
      c2.props.onPointerDown({ clientX: 140, currentTarget: rect, preventDefault() {} });
      c2.props.onPointerMove({ clientX: 320, currentTarget: rect });
      c2.props.onPointerUp({ clientX: 320, currentTarget: rect });
      const d1 = firstDate(rerender());
      check("拖动平移到更早区间", !!d0 && !!d1 && d0 !== d1, d0 + " → " + d1);
      // 已到最早端继续左拖不应越界
      c2.props.onPointerDown({ clientX: 320, currentTarget: rect, preventDefault() {} });
      c2.props.onPointerMove({ clientX: 0, currentTarget: rect });
      const d2 = firstDate(rerender());
      check("平移不会越出数据范围", !!d2 && d2 === d0, d1 + " → " + d2);
      c2.props.onPointerUp({ clientX: 0, currentTarget: rect });
    }
    // 选中 K 线 → 顶部指标区切换：选中时显示单根信息，否则显示当日行情
    const chartOf = () => findNode(ovNode, (n) => n.type === "div" && n.props && typeof n.props.onClick === "function" && typeof n.props.onWheel === "function");
    const showCandle = (t) => /日期 .*开 .*高 .*低 .*收 /.test(t);
    const showToday = (t) => /今开 .*昨收 .*最高 .*最低/.test(t);
    const dateOf = (t) => (/日期\s+(\S+)/.exec(t) || [])[1] || null;
    check("未选中时顶部显示当日行情", showToday(rerender()), "");
    const clickAt = (x) => {
      const c = chartOf();
      c.props.onPointerDown({ clientX: x, currentTarget: rect, preventDefault() {} });
      c.props.onPointerUp({ clientX: x, currentTarget: rect });
      chartOf().props.onClick({ clientX: x, currentTarget: rect });
    };
    const dblClick = () => findNode(ovNode, (n) => n.type === "div" && n.props && typeof n.props.onDoubleClick === "function").props.onDoubleClick({ preventDefault() {} });
    const leave = () => chartOf().props.onPointerLeave({ clientX: 0, currentTarget: rect });
    if (chartOf()) {
      // 悬浮 → 顶部临时显示该根
      chartOf().props.onPointerMove({ clientX: 200, currentTarget: rect });
      const preview = rerender();
      check("悬浮时顶部显示单根K线信息", showCandle(preview), preview.slice(0, 160));
      check("单根信息含涨跌/量/振幅", /涨跌 /.test(preview) && /幅 /.test(preview) && /量 /.test(preview) && /振幅/.test(preview), preview.slice(0, 200));
      // 移开 → 回到当日行情（仅预览未钉住）
      leave();
      check("仅悬浮时移开即恢复当日行情", showToday(rerender()), "");
      // 点击钉住 → 移开仍显示该根
      clickAt(260);
      leave();
      check("点击钉住后移开仍显示该根", showCandle(rerender()), "");
      // 悬浮到别的 K 线，仍显示钉住的那根
      const pinnedDate = dateOf(rerender());
      chartOf().props.onPointerMove({ clientX: 340, currentTarget: rect });
      check("钉住优先于悬浮预览", dateOf(rerender()) === pinnedDate, String(pinnedDate));
      // 双击 → 取消钉住，回到当日行情
      dblClick();
      leave();
      check("双击取消钉住并恢复当日行情", showToday(rerender()), "");
      // 再点同一根可重新钉住 / 再点取消
      clickAt(260); leave();
      const on2 = showCandle(rerender());
      clickAt(260); leave();
      check("再次点击同一根可取消", on2 && showToday(rerender()), "");
      // 拖动平移后松手不应误钉住
      chartOf().props.onPointerDown({ clientX: 140, currentTarget: rect, preventDefault() {} });
      chartOf().props.onPointerMove({ clientX: 320, currentTarget: rect });
      chartOf().props.onPointerUp({ clientX: 320, currentTarget: rect });
      chartOf().props.onClick({ clientX: 320, currentTarget: rect });
      check("拖动平移后不误钉住", showToday(rerender()), "");
      leave();
    }
    // 钉住后 ← / → 逐根切换；到边界不越界；输入框内不抢按键
    if (chartOf()) {
      clickAt(200); // 钉住某根
      const d0 = dateOf(rerender());
      check("键盘切换前已钉住", !!d0, String(d0));
      global.__winDispatch("keydown", { key: "ArrowLeft", target: {} });
      const dPrev = dateOf(rerender());
      check("← 切换到前一根", !!dPrev && dPrev !== d0, d0 + " → " + dPrev);
      global.__winDispatch("keydown", { key: "ArrowRight", target: {} });
      check("→ 切换回后一根", dateOf(rerender()) === d0, dPrev + " → " + dateOf(rerender()));
      // 连续左移到数据起点后不再越界（每次按键后重渲染，等价浏览器的 React 重渲染）
      for (let i = 0; i < 200; i++) { global.__winDispatch("keydown", { key: "ArrowLeft", target: {} }); rerender(); }
      const atStart = dateOf(rerender());
      global.__winDispatch("keydown", { key: "ArrowLeft", target: {} });
      check("左移到起点后不越界", dateOf(rerender()) === atStart, String(atStart));
      for (let i = 0; i < 200; i++) { global.__winDispatch("keydown", { key: "ArrowRight", target: {} }); rerender(); }
      const atEnd = dateOf(rerender());
      global.__winDispatch("keydown", { key: "ArrowRight", target: {} });
      check("右移到终点后不越界", dateOf(rerender()) === atEnd, String(atEnd));
      // 输入框内按方向键不切换 K 线
      global.__winDispatch("keydown", { key: "ArrowLeft", target: { tagName: "INPUT" } });
      check("输入框内方向键不切换K线", dateOf(rerender()) === atEnd, String(dateOf(rerender())));
      // 双击取消钉住后，方向键失效
      findNode(ovNode, (n) => n.type === "div" && n.props && typeof n.props.onDoubleClick === "function").props.onDoubleClick({ preventDefault() {} });
      check("双击取消钉住后恢复当日行情", showToday(rerender()), "");
      global.__winDispatch("keydown", { key: "ArrowLeft", target: {} });
      check("未钉住时方向键无效", showToday(rerender()), "");
      // MA 数值随选中 K 线变化
      const maOf = (t, p) => { const m = new RegExp("MA" + p + " ([\\d.]+)").exec(t); return m ? m[1] : null; };
      const maLast = maOf(textOf(ovNode).join(" "), 5);
      clickAt(200);
      const maHover = maOf(rerender(), 5);
      check("MA5 随选中K线变化", !!maLast && !!maHover && maHover !== maLast, maLast + " → " + maHover);
      dblClick();
      check("取消钉住后MA回到最后一根", maOf(rerender(), 5) === maLast, maOf(rerender(), 5) + " vs " + maLast);
    }
  }
}

// ---------- 5. 添加自选（搜索流程） ----------
const backBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("返回") >= 0);
click(backBtn);
clickTab("自选");
const input = findNode(ovNode, (n) => n.type === "input" && typeof n.props.placeholder === "string" && n.props.placeholder.indexOf("搜索") >= 0);
check("自选页有搜索输入框", !!input);
input.props.onChange({ target: { value: "比亚迪" } });
renderTree(ovNode); // 触发 SearchBox 的 useEffect（设 320ms 防抖）
// 等搜索下拉真的出结果（原来睡 1200ms：320ms 防抖 + fetch 全程）
await until(() => {
  ovNode = ov.render({});
  renderTree(ovNode);
  return !!findNode(ovNode, (n) => n.type === "button" && n.props && String(n.props.className || "").indexOf("sl-sug") >= 0);
}, 6000);
ovNode = ov.render({});
renderTree(ovNode);
const sug = findNode(ovNode, (n) => n.type === "button" && n.props && String(n.props.className || "").indexOf("sl-sug") >= 0);
check("搜索出结果下拉", !!sug, textOf(ovNode).join(" ").slice(0, 200));
if (sug) {
  click(sug);
  await wait(400);
  ovNode = ov.render({});
  renderTree(ovNode);
  check("添加后自选含比亚迪", /比亚迪/.test(textOf(ovNode).join(" ")));
}

// ---------- 6. 持仓编辑（右键 → 编辑成本/股数 对话框 → 保存 → 盈亏） ----------
clickTab("持仓");
const addInput = findNode(ovNode, (n) => n.type === "input" && typeof n.props.placeholder === "string" && n.props.placeholder.indexOf("搜索添加持仓") >= 0);
check("持仓页有搜索框", !!addInput);
addInput.props.onChange({ target: { value: "600519" } });
renderTree(ovNode);
await wait(1000);
ovNode = ov.render({});
renderTree(ovNode);
const posSug = findNode(ovNode, (n) => n.type === "button" && n.props && String(n.props.className || "").indexOf("sl-sug") >= 0);
check("搜索出持仓候选（贵州茅台）", !!posSug, textOf(ovNode).join(" ").slice(0, 160));
if (posSug) {
  click(posSug); // addPosition(cost:0,qty:0)
  await wait(400);
  ovNode = ov.render({}); renderTree(ovNode);
  const row0 = posRow(ovNode);
  check("新增持仓出现行", !!row0);
  // 右键该行 → 菜单「编辑成本 / 股数」→ 打开对话框
  contextMenu(row0);
  ovNode = ov.render({}); renderTree(ovNode);
  const editMi = findMenuItem(ovNode, "编辑成本");
  check("右键菜单含「编辑成本 / 股数」", !!editMi, textOf(ovNode).join(" ").slice(0, 160));
  if (editMi) {
    click(editMi);
    dismissMenu();
    ovNode = ov.render({}); renderTree(ovNode);
    const costInput = findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 1274.89") >= 0);
    const qtyInput = findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 100") >= 0);
    check("编辑对话框有成本/股数输入", !!costInput && !!qtyInput, textOf(ovNode).join(" ").slice(0, 160));
    if (costInput && qtyInput) {
      costInput.props.onChange({ target: { value: "1000" } });
      ovNode = ov.render({}); renderTree(ovNode);
      findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 100") >= 0)
        .props.onChange({ target: { value: "100" } });
      ovNode = ov.render({}); renderTree(ovNode);
      const saveBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "保存");
      click(saveBtn); // updatePosition(cost:1000,qty:100) → 关对话框
      await wait(1200);
      ovNode = ov.render({});
      errs = renderTree(ovNode);
      check("保存持仓后无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
      const t = textOf(ovNode).join(" ");
      console.log("   持仓片段:", t.slice(0, 260));
      check("持仓显示盈亏（成本1000/股数100）", /累计|市值/.test(t) && /贵州茅台/.test(t) && /1000/.test(t), t.slice(0, 220));

      // 首次填上 qty>0 即视为「今天建仓」→ 必须落下 openedAt（行情日期口径）。
      // 没有它，todayPnl 会把新仓当成「昨天就持有」，今日盈亏按昨收算而虚增。
      //
      // 关键：要等 **Host 回包合并完成**再读，否则读到的是本地乐观值——
      // 那样连「Host 白名单不放行该字段」都测不出来（实测过：丢字段时这条照样绿）。
      await until(() => {
        const ps = ((global.__sl_test_state__ || {}).config?.positions) || [];
        const x = ps.find((v) => v.code === "sh600519") || {};
        return !!x.openedAt;
      }, 4000);
      const posNow0 = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
      // 直接读 Host 落盘文件：这是「字段真被持久化」的唯一硬证据。
      // 只读本地 state 的话，Host 白名单丢字段时本地乐观值仍带着它 → 断言空转（实测过）。
      const onDisk = (() => {
        try {
          const j = JSON.parse(readFileSync(process.env.DSH_STOCK_LEEK_CONFIG, "utf8"));
          return (j.positions || []).find((x) => x.code === "sh600519") || {};
        } catch (e) {
          return { __err: String(e && e.message) };
        }
      })();
      check("openedAt 已真正落盘（Host 白名单放行）", !!onDisk.openedAt, onDisk);
      const q0 = (global.__sl_test_state__ || {}).quotes?.["sh600519"] || {};
      const dayOf = (qq) => {
        const tt = String(qq.time || "");
        return /^\d{14}$/.test(tt) ? tt.slice(0, 4) + "-" + tt.slice(4, 6) + "-" + tt.slice(6, 8) : "";
      };
      const expectDay = dayOf(q0);
      check("首次填股数后落下了 openedAt", !!posNow0.openedAt, { openedAt: posNow0.openedAt, qty: posNow0.qty });
      check("openedAt 用的是行情日期（与 quoteDate 同口径）",
        !expectDay || posNow0.openedAt === expectDay, { openedAt: posNow0.openedAt, quoteDay: expectDay });

      // 再改一次股数：openedAt 不能被刷成新值（否则每次编辑都变成"今天建仓"）
      // 注意股数要**改回原值 100**：后面的买卖用例都基于「100 股、成本 1000」这条基线，
      // 改了不复位会把它们全带红（踩过）。
      const beforeOpened = posNow0.openedAt;
      contextMenu(posRow(ovNode));
      ovNode = ov.render({}); renderTree(ovNode);
      const editMi2 = findMenuItem(ovNode, "编辑成本");
      if (editMi2) {
        click(editMi2);
        dismissMenu();
        ovNode = ov.render({}); renderTree(ovNode);
        findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 100") >= 0)
          .props.onChange({ target: { value: "150" } });
        ovNode = ov.render({}); renderTree(ovNode);
        click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "保存"));
        await wait(600);
        ovNode = ov.render({}); renderTree(ovNode);
        // 复位回 100
        contextMenu(posRow(ovNode));
        ovNode = ov.render({}); renderTree(ovNode);
        const editMi3 = findMenuItem(ovNode, "编辑成本");
        if (editMi3) {
          click(editMi3);
          dismissMenu();
          ovNode = ov.render({}); renderTree(ovNode);
          findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 100") >= 0)
            .props.onChange({ target: { value: "100" } });
          ovNode = ov.render({}); renderTree(ovNode);
          click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "保存"));
          await wait(600);
          ovNode = ov.render({}); renderTree(ovNode);
        }
      }
      const posNow1 = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
      check("再次编辑股数不会刷新 openedAt", posNow1.openedAt === beforeOpened, { before: beforeOpened, after: posNow1.openedAt });
      check("股数已复位到基线 100", posNow1.qty === 100, posNow1.qty);
    }
  }
}

// ---------- 7. 持仓交易（右键 → 记一笔抽屉 → 交易记录二级页） ----------
clickTab("持仓");
ovNode = ov.render({}); renderTree(ovNode);
const prow = posRow(ovNode);
contextMenu(prow);
ovNode = ov.render({}); renderTree(ovNode);
const txnMi = findMenuItem(ovNode, "记一笔交易") || findMenuItem(ovNode, "收起交易");
check("右键菜单含「记一笔交易」入口", !!txnMi, textOf(ovNode).join(" ").slice(0, 160));
const recMi = findMenuItem(ovNode, "交易记录");
check("右键菜单含「交易记录」入口", !!recMi, textOf(ovNode).join(" ").slice(0, 160));
if (txnMi) {
  click(txnMi); // setOpenCode → 展开 TxnPanel
  dismissMenu();
  ovNode = ov.render({}); renderTree(ovNode);
  await wait(200);
  ovNode = ov.render({}); renderTree(ovNode);
  const panel = textOf(ovNode).join(" ");
  check("交易抽屉展开（买入/卖出/记一笔）", /买入/.test(panel) && /卖出/.test(panel) && /记一笔/.test(panel), panel.slice(0, 240));
  // 成交明细已移到二级页：抽屉里不该再有成交列表容器。
  // **按类名判**而不是按文本 `@价格` 判——此刻还没记过账，txns 为空，
  // 就算把列表渲染回来也是空的，文本断言会假绿（非空洞验证时实测只红了一条）。
  {
    const hasListCls = (root, cls) => !!findNode(root, (n) => n.type === "div" && String((n.props && n.props.className) || "").indexOf(cls) >= 0);
    check("抽屉里没有成交列表容器（sl-txn-list）", !hasListCls(ovNode, "sl-txn-list"), panel.slice(0, 240));
  }
  check("抽屉提示去交易记录页看明细", /交易记录/.test(panel), panel.slice(0, 240));
  const formInput = (ph) => findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === ph && typeof n.props.onChange === "function");
  // 记一笔买入 @1300 ×100
  formInput("价格").props.onChange({ target: { value: "1300" } });
  formInput("股数").props.onChange({ target: { value: "100" } });
  ovNode = ov.render({}); renderTree(ovNode);
  const addBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("记一笔") >= 0);
  click(addBtn);
  await wait(400);
  ovNode = ov.render({}); renderTree(ovNode);
  const afterBuy = textOf(ovNode).join(" ");
  console.log("   买入后:", afterBuy.slice(0, 240));
  check("买入后股数 100→200（成本 1150.00 后跟现价再跟持股 200）", /1150\.00\s+[\d.]+\s+200\b/.test(afterBuy), afterBuy.slice(0, 200));
  check("买入已写入配置（明细虽不在抽屉里，数据仍在）",
    !!(((global.__sl_test_state__ || {}).config?.positions || [])[0]?.txns || []).some((t) => t.price === 1300 && t.qty === 100),
    JSON.stringify((((global.__sl_test_state__ || {}).config?.positions || [])[0] || {}).txns));
  // 再记一笔卖出 @1350 ×50（切到「卖出」段）
  const sellTab = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "卖出");
  click(sellTab);
  ovNode = ov.render({}); renderTree(ovNode);
  formInput("价格").props.onChange({ target: { value: "1350" } });
  formInput("股数").props.onChange({ target: { value: "50" } });
  ovNode = ov.render({}); renderTree(ovNode);
  click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("记一笔") >= 0));
  await wait(400);
  ovNode = ov.render({}); renderTree(ovNode);
  const afterSell = textOf(ovNode).join(" ");
  console.log("   卖出后:", afterSell.slice(0, 300));
  check("卖出后股数 200→150（成本 1150.00 后跟现价再跟持股 150）", /1150\.00\s+[\d.]+\s+150\b/.test(afterSell), afterSell.slice(0, 200));
  errs = renderTree(ovNode);
  check("多笔交易后无渲染错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
  // 右键菜单项现显示笔数
  contextMenu(posRow(ovNode));
  ovNode = ov.render({}); renderTree(ovNode);
  check("交易记录菜单显示 2 笔", !!findMenuItem(ovNode, "2 笔"), textOf(ovNode).join(" ").slice(0, 160));

  // ---------- 7b. 交易记录二级页：只显示被右键那只股票 ----------
  const recMi2 = findMenuItem(ovNode, "交易记录");
  check("重新右键仍能进交易记录", !!recMi2);
  if (recMi2) {
    click(recMi2);
    dismissMenu();
    ovNode = ov.render({}); renderTree(ovNode);
    await wait(200);
    ovNode = ov.render({}); renderTree(ovNode);
    const rec = textOf(ovNode).join(" ");
    console.log("   交易记录页:", rec.slice(0, 300));
    const errsRec = renderTree(ovNode);
    check("交易记录页渲染无错误", errsRec.length === 0, errsRec[0] && errsRec[0].error.stack);
    check("交易记录页有返回头与标题", /←\s*返回/.test(rec) && /交易记录/.test(rec), rec.slice(0, 160));
    check("交易记录页显示该股名", /贵州茅台/.test(rec), rec.slice(0, 160));
    check("交易记录页列出两笔成交（@1300 / @1350）", /@1300\.00/.test(rec) && /@1350\.00/.test(rec), rec.slice(0, 300));
    check("交易记录页标注买卖方向", /买/.test(rec) && /卖/.test(rec), rec.slice(0, 200));
    check("交易记录页显示笔数汇总", /2\s*笔/.test(rec), rec.slice(0, 200));
    check("交易记录页有买/卖/净汇总", /买\s*[\d.]/.test(rec) && /卖\s*[\d.]/.test(rec) && /净\s*\d+\s*股/.test(rec), rec.slice(0, 260));
    check("今日成交带「今」标记", /今/.test(rec), rec.slice(0, 260));
    // 只显示被右键那只：不得混入其它股票的成交
    check("交易记录页只显示这只股票（无其它持仓名）", !/宁德时代|比亚迪/.test(rec), rec.slice(0, 200));

    // 删除一笔 → 回到 1 笔。列表最新在前，删的是那笔「卖 50」→ 股数回退到 200。
    // 遍历规则与 textOf 一致：**函数组件只走 __rendered**，否则 Fragment 的
    // __rendered 与 children 是同一批节点，会被数两遍（先踩到"找不到"，
    // 补了 __rendered 又踩到"翻倍"，两个坑都是 development.md §3 那一条）。
    const delBtns = [];
    (function collect(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(collect); return; }
      if (n.type === "button" && String((n.props && n.props.className) || "") === "sl-x" && /删除/.test(String((n.props && n.props["data-sltip"]) || ""))) delBtns.push(n);
      if (typeof n.type === "function") { collect(n.__rendered); return; }
      if (n.children) n.children.forEach(collect);
    })(ovNode);
    check("交易记录页每笔可删除", delBtns.length === 2, delBtns.length);
    if (delBtns.length === 2) {
      click(delBtns[0]);
      ovNode = ov.render({}); renderTree(ovNode);
      await wait(250);
      ovNode = ov.render({}); renderTree(ovNode);
      const afterDel = textOf(ovNode).join(" ");
      check("删除后只剩 1 笔", /1\s*笔/.test(afterDel) && !/2\s*笔/.test(afterDel), afterDel.slice(0, 260));
      const posNow = ((global.__sl_test_state__ || {}).config?.positions || [])[0] || {};
      check("删除已写入配置", (posNow.txns || []).length === 1, JSON.stringify(posNow.txns));
      check("撤销该笔同时回退股数（删卖出 → 150 回到 200）", posNow.qty === 200, posNow.qty);
      click(findNode(ovNode, (n) => n.type === "button" && /返回/.test(String(n.children && n.children[0]))));
      ovNode = ov.render({}); renderTree(ovNode);
      // 二级页标题带「交易记录：」冒号；抽屉里的指路提示没冒号，用它区分
      check("返回后回到持仓列表", !/交易记录：/.test(textOf(ovNode).join(" ")), textOf(ovNode).join(" ").slice(0, 160));
    }
  } else {
    dismissMenu(); // 进不去二级页也要关菜单，否则残留会干扰后续用例
  }
}

// ---------- 7c. 几笔交易之后**再改成本/股数**：旧流水必须被吸收，不能双重计算 ----------
// 用户明确指出的场景：改成本/股数不只发生在建仓前，也发生在若干笔交易之后。
// 那次修改等于宣告「此刻持仓就是这样」——之前的流水已被吸收，再叠一遍就是双算。
{
  const cfgP = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
  // 前置：此时已有 2 笔流水（买100@1300、卖50@1350），当前 150 股 / 成本 1150
  check("前置：该持仓已有交易流水", (cfgP.txns || []).length >= 1, (cfgP.txns || []).length);

  // 通过 UI 把成本/股数改为 500股 @2000（模拟"我其实是这样持仓的"）
  clickTab("持仓");
  ovNode = ov.render({}); renderTree(ovNode);
  contextMenu(posRow(ovNode));
  ovNode = ov.render({}); renderTree(ovNode);
  const mi = findMenuItem(ovNode, "编辑成本");
  check("能打开编辑对话框（前置）", !!mi);
  if (mi) {
    click(mi);
    dismissMenu();
    ovNode = ov.render({}); renderTree(ovNode);
    findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 1274.89") >= 0)
      .props.onChange({ target: { value: "2000" } });
    ovNode = ov.render({}); renderTree(ovNode);
    findNode(ovNode, (n) => n.type === "input" && String(n.props.placeholder || "").indexOf("如 100") >= 0)
      .props.onChange({ target: { value: "500" } });
    ovNode = ov.render({}); renderTree(ovNode);
    click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "保存"));
    await wait(700);
    ovNode = ov.render({}); renderTree(ovNode);

    const p1 = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
    // 改完之后当前持仓应**等于手填值**，不能被旧流水再叠加一遍
    check("改成本/股数后当前持仓 = 手填值（旧流水被吸收）",
      p1.qty === 500 && Math.abs(p1.cost - 2000) < 1e-6, { qty: p1.qty, cost: p1.cost });
    check("同时刷新了修正点 baseAt（用于区分之后的新流水）",
      typeof p1.baseAt === "number" && p1.baseAt > 0, { baseAt: p1.baseAt, baseQty: p1.baseQty, baseCost: p1.baseCost });
    // 关键：上面那条只看"赋值结果"，双重计算时也可能恰好相等（空转过一次）。
    // 这里再触发一次**删掉最后一笔流水**的动作——它会走 applyReplay，
    // 此时只有 baseAt 过滤正确，才能回到 500 股而不是又叠加老流水。
    if ((p1.txns || []).length >= 1) {
      contextMenu(posRow(ovNode));
      ovNode = ov.render({}); renderTree(ovNode);
      const recMi3 = findMenuItem(ovNode, "交易记录");
      if (recMi3) {
        click(recMi3);
        dismissMenu();
        ovNode = ov.render({}); renderTree(ovNode);
        const delBtns = [];
        (function walk(n) {
          if (!n || typeof n !== "object") return;
          if (Array.isArray(n)) { n.forEach(walk); return; }
          if (n.type === "button" && String((n.props && n.props.className) || "") === "sl-x"
            && /删除/.test(String((n.props && n.props["data-sltip"]) || ""))) delBtns.push(n);
          if (typeof n.type === "function") { walk(n.__rendered); return; }
          if (n.children) n.children.forEach(walk);
        })(ovNode);
        if (delBtns.length) {
          click(delBtns[0]); // 删最新一笔
          await wait(600);
          ovNode = ov.render({}); renderTree(ovNode);
          const p3 = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
          // 删掉的是修正前的老流水 → 因为被 baseAt 吸收，持仓应**纹丝不动**仍是 500@2000
          check("删掉修正前的老流水，持仓不受影响（证明吸收真的生效）",
            p3.qty === 500 && Math.abs(p3.cost - 2000) < 1e-6, { qty: p3.qty, cost: p3.cost });
          click(findNode(ovNode, (n) => n.type === "button" && /返回/.test(String(n.children && n.children[0]))));
          ovNode = ov.render({}); renderTree(ovNode);
        }
      }
    }

    // 修正之后**再记一笔**买入：应正常叠加到期初之上
    // 注意：菜单项是 toggle（已展开时叫「收起交易」），点它会把抽屉关掉。
    // 所以先确认抽屉当前是否已展开，只在收起时才去点。
    const drawerOpen = () => !!findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "价格");
    if (!drawerOpen()) {
      contextMenu(posRow(ovNode));
      ovNode = ov.render({}); renderTree(ovNode);
      const txnMi2 = findMenuItem(ovNode, "记一笔交易");
      if (txnMi2) {
        click(txnMi2);
        dismissMenu();
        ovNode = ov.render({}); renderTree(ovNode);
        await wait(150);
        ovNode = ov.render({}); renderTree(ovNode);
      }
    }
    const priceIn = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "价格");
    const qtyIn = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "股数");
    check("交易抽屉已展开（前置）", !!priceIn && !!qtyIn, textOf(ovNode).join(" ").slice(0, 180));
    if (priceIn && qtyIn) {
      priceIn.props.onChange({ target: { value: "1000" } });
      ovNode = ov.render({}); renderTree(ovNode);
      findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "股数").props.onChange({ target: { value: "100" } });
      ovNode = ov.render({}); renderTree(ovNode);
      click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("记一笔") >= 0));
      await wait(700);
      ovNode = ov.render({}); renderTree(ovNode);
      const p2 = ((global.__sl_test_state__ || {}).config?.positions || []).find((x) => x.code === "sh600519") || {};
      const wantCost = Math.round(((2000 * 500 + 1000 * 100) / 600) * 10000) / 10000;
      check("修正之后的新流水正常叠加（500@2000 + 100@1000 → 600股）",
        p2.qty === 600 && Math.abs(p2.cost - wantCost) < 1e-6, { qty: p2.qty, cost: p2.cost, want: wantCost });
    }
  }
}
// ---------- 8. 收益胶囊 hover 浮层（市值/累计收益+%/每只持仓今日盈亏+当日涨幅） ----------
{
  // 重新渲染悬浮指数栏（此时已有持仓 + 行情）
  let bNode = floatReg.render({});
  renderTree(bNode);
  const earnChip = findNode(bNode, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-chip-earn") >= 0);
  check("指数栏出现收益胶囊", !!earnChip);
  if (earnChip) {
    check("胶囊默认无浮层", textOf(bNode).join(" ").indexOf("累计收益") < 0);
    earnChip.props.onMouseEnter({});
    renderTree(bNode);
    bNode = floatReg.render({});
    renderTree(bNode);
    const popText = textOf(bNode).join(" ");
    console.log("   hover 浮层文本:", popText.slice(0, 220));
    check("浮层含 市值/累计收益/今日收益", /市值/.test(popText) && /累计收益/.test(popText) && /今日收益/.test(popText), popText.slice(0, 220));
    check("浮层列出持仓股（贵州茅台）", /贵州茅台/.test(popText), popText.slice(0, 220));
    check("汇总今日收益带当日涨幅%", /今日收益\s*[+\-][\d.]+[亿万]?\s*（[+\-]\d+\.\d+%）/.test(popText), popText.slice(0, 220));
    // 每只持仓行：今日盈亏金额 + 当日涨幅%（不再展示累计，累计在悬浮提示里）
    check("持仓行展示今日盈亏 + 现价 + 当日涨幅", /贵州茅台\s+[+\-][\d.,]+[亿万]?\s+[\d.]+\s+[+\-]\d+\.\d+%/.test(popText), popText.slice(0, 220));
    const cumCount = (popText.match(/累计/g) || []).length;
    check("持仓行不再展示累计（「累计」仅汇总行 1 次）", cumCount === 1, "累计出现 " + cumCount + " 次：" + popText.slice(0, 220));
    const rowNode = findNode(bNode, (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-pop-row");
    check("持仓行悬浮提示含今日/累计/成本明细", !!rowNode && /今日|累计|成本/.test(String(rowNode.props["data-sltip"])), rowNode && String(rowNode.props["data-sltip"]));
    // 移开后浮层消失（定时器 160ms）
    earnChip.props.onMouseLeave({});
    renderTree(bNode);
    await wait(260);
    bNode = floatReg.render({});
    renderTree(bNode);
    check("移开后浮层收起", textOf(bNode).join(" ").indexOf("累计收益") < 0, textOf(bNode).join(" ").slice(0, 120));
  }

  // ---------- 8a. 按时段展开/收起（9:00–15:06 展开）+ 点●手动切换 ----------
  // 时间由 __sl_now__ 钉死，逐个边界点验证。北京时间 = UTC+8。
  {
    /**
     * 本段所有时钟的基准日 = **真实行情日期**，不写死。
     *
     * barForceDay 的 key 来自 quoteDate(行情)，写死基准日会让"造出来的时钟"
     * 与"产品读到的行情日期"在周末/节假日错位（写死周四、行情却是周五）。
     */
    const realQuoteDay = () => {
      const q = ((global.__sl_test_state__ || {}).quotes) || {};
      for (const k of Object.keys(q)) {
        const t = String((q[k] || {}).time || "");
        if (/^(sh|sz|bj)/.test(k) && /^\d{14}$/.test(t)) return t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8);
      }
      const p = (n) => String(n).padStart(2, "0");
      const d = new Date();
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    };
    /**
     * 行情日期的**下一个交易日**（跳过周末）。
     *
     * 次日绝不能写死：barForceDay 的 key 是真实行情日期，写死的"次日"迟早撞上
     * 真实日期——撞上那天起「过期」永不成立。本用例就栽过一次（写死 2026-10-16，
     * 等真实行情日期也变成 10-16，测试立刻失效且看起来像产品 bug）。
     */
    const nextTradingDay = (dayStr) => {
      const d = new Date(dayStr + "T00:00:00Z");
      for (;;) {
        d.setUTCDate(d.getUTCDate() + 1);
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) break;
      }
      return d.toISOString().slice(0, 10);
    };
    const baseDay = realQuoteDay();
    const nextDay = nextTradingDay(baseDay);
    const nextDayCompact = nextDay.replace(/-/g, "");
    check("能取到真实行情日期并推出下一交易日（次日不能写死）", /^\d{4}-\d{2}-\d{2}$/.test(baseDay) && nextDay !== baseDay, { baseDay, nextDay });

    const at = (hhmm, day) => {
      const [hh, mm] = hhmm.split(":").map(Number);
      return Date.parse(`${day || baseDay}T00:00:00Z`) + (hh * 60 + mm - 480) * 60000; // 北京 hh:mm → UTC
    };
    /** 点一下状态点，返回点击后是否展开 */
    const clickDot = () => {
      let bn = floatReg.render({});
      renderTree(bn);
      const dot = findNode(bn, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-bar-dot") >= 0);
      if (!dot || typeof dot.props.onClick !== "function") return null;
      dot.props.onClick({});
      renderTree(bn);
      return barHasIndex();
    };

    // 展开区间：9:00–15:06（含两端）
    for (const t of ["09:00", "09:30", "11:30", "12:00", "13:00", "15:00", "15:06"]) {
      setNow(at(t));
      check(`${t} 展开`, barHasIndex(), barTexts().slice(0, 120));
      check(`${t} 收益胶囊在`, barHas("sl-chip-earn"), barTexts().slice(0, 120));
    }
    // 午休不收起（否则 A 股每天消失两个半小时）
    setNow(at("12:00"));
    check("午休 12:00 仍然展开（按整日跨度而非逐时段）", barHasIndex(), barTexts().slice(0, 120));

    // 收起区间：只留 状态点 + 设置
    for (const t of ["08:59", "15:07", "20:00"]) {
      setNow(at(t));
      check(`非交易时段 ${t} 收起指数`, !barHasIndex(), barTexts().slice(0, 120));
      check(`非交易时段 ${t} 收起收益`, !barHas("sl-chip-earn"), barTexts().slice(0, 120));
      check(`非交易时段 ${t} 仍留状态点`, barHas("sl-bar-dot"), barTexts().slice(0, 120));
      check(`非交易时段 ${t} 仍留设置按钮`, barTexts().indexOf("⚙") >= 0, barTexts().slice(0, 120));
    }

    // 边界：早一分钟 / 晚一分钟就变样
    setNow(at("08:59"));
    const beforeOpen = barHasIndex();
    setNow(at("09:00"));
    const atOpen = barHasIndex();
    check("9:00 起展开（8:59 收起 / 9:00 展开）", beforeOpen === false && atOpen === true, { beforeOpen, atOpen });

    setNow(at("15:06"));
    const atClose = barHasIndex();
    setNow(at("15:07"));
    const afterClose = barHasIndex();
    check("15:06 仍展开（15:07 收起）", atClose === true && afterClose === false, { atClose, afterClose });

    // 点●手动切换：展开→收起，收起→展开，纯来回
    // 注意：点了之后 barForce 就非 null，后面所有断言都处于"手动态"，
    // 所以**自动**行为必须在第一次点击**之前**全部验完。
    setNow(at("10:00"));
    check("起点是展开的", barHasIndex(), barTexts().slice(0, 120));
    check("点●后收起", clickDot() === false, barTexts().slice(0, 120));
    check("收起时收益胶囊一起消失", !barHas("sl-chip-earn"), barTexts().slice(0, 120));
    check("再点●展开", clickDot() === true, barTexts().slice(0, 120));
    check("第三次点●再收起", clickDot() === false, barTexts().slice(0, 120));
    check("第四次点●再展开", clickDot() === true, barTexts().slice(0, 120));

    // 手动覆盖跨交易日失效：昨天的选择不该粘住今天。
    // 关键是让"手动"和"自动"在跨日后**结论相反**——手动收起、次日盘中自动本该展开。
    // 否则手动展开 + 次日盘中自动展开，两边都是展开，过期与否观测不到（第一版就栽在这）。
    check("手动展开生效（非交易时段）", (setNow(at("20:00")), barHasIndex() === true), barTexts().slice(0, 120));
    setNow(at("10:00")); // 同一天，手动态仍在
    check("同一天内手动态保持（无视时段）", barHasIndex() === true, barTexts().slice(0, 120));
    clickDot(); // 手动收起
    check("手动收起生效（此时明明是盘中）", barHasIndex() === false, barTexts().slice(0, 120));
    // realQuoteDay / nextTradingDay / baseDay / nextDay 已在 8a 段顶部定义（勿重复声明）
    const nextDayQuotes = async (url, opts) => {
      const u = String(url);
      const r = await REAL_FETCH(u.startsWith("http") ? u : ORIGIN + u, opts);
      if (/\/quotes/.test(u)) {
        const j = await r.clone().json();
        for (const row of (j.rows || [])) row.time = nextDayCompact + "100000";
        return jsonResponse(j, r.status);
      }
      return r;
    };
    global.window.fetch = nextDayQuotes;
    global.fetch = nextDayQuotes;
    setNow(at("10:00", nextDay)); // 次日 10:00 北京，盘中
    let rf0 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳");
    if (!rf0) { ovNode = ov.render({}); renderTree(ovNode); rf0 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳"); }
    if (rf0) rf0.props.onClick({});
    await until(() => {
      const q = ((global.__sl_test_state__ || {}).quotes || {});
      const k = Object.keys(q)[0];
      return !!k && String(q[k].time || "").startsWith(nextDayCompact);
    }, 6000);
    check("跨交易日后手动态失效，恢复按时段自动（次日盘中=展开）", barHasIndex() === true, { baseDay, nextDay });
    setNow(at("20:00", nextDay)); // 次日非交易时段，手动态已清 → 应回到自动收起
    check("跨交易日后非交易时段自动收起（手动态确实清干净了）", barHasIndex() === false, barTexts().slice(0, 120));

    // **必须把行情日期拨回真实日期**再往下走。
    // 下一段 8b 要清仓，而 purgeStaleClosedPositions 判的是「行情日期 > 最后一笔成交日」。
    // 留着次日的假行情，持仓会在卖完的同一刻就被当成过期清理掉，
    // 于是"清仓后收益还在不在"根本无从验证（第一版就这么把 8b 全弄红了）。
    global.window.fetch = patchedFetch;
    global.fetch = patchedFetch;
    let rf1 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳");
    if (!rf1) { ovNode = ov.render({}); renderTree(ovNode); rf1 = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳"); }
    if (rf1) rf1.props.onClick({});
    const quoteDay = () => {
      const q = ((global.__sl_test_state__ || {}).quotes) || {};
      const k = Object.keys(q)[0];
      return k ? String(q[k].time || "") : "";
    };
    // 期望值用 baseDay（真实行情日期），不用本地今天：
    // 周末/盘前两者会错开，写死本地日期会让这条前置断言在周末必挂。
    const baseCompact = baseDay.replace(/-/g, "");
    await until(() => quoteDay().startsWith(baseCompact), 8000);
    check("行情日期已拨回真实交易日（后续清仓用例的前置条件）", quoteDay().startsWith(baseCompact), { baseDay, quoteDay: quoteDay() });
    // 时钟也拨回同一天的盘中：与 baseDay 同源，否则 barForceDay 与行情日期错位、
    // 8a 留下的手动态会莫名"复活"。
    setNow(at("14:45", baseDay));
  }
  // 持仓后标题应变脸（不再是默认观望态）
  const ovAfter = ovReg.render({});
  renderTree(ovAfter);
  const tAfter = titleOf(ovAfter);
  const MOODS = ["📈 观望中", "🍗 加鸡腿", "🚀 起飞了", "🍜 关灯吃面", "🧘 天台吹风"];
  check("持仓后标题属于变脸集合", !!tAfter && MOODS.includes(tAfter.text), tAfter && tAfter.text);

  // 有持仓后再进 K 线详情 → 应出现成本线与成本标签
  {
    ovNode = ov.render({}); renderTree(ovNode);
    clickTab("自选");
    ovNode = ov.render({}); renderTree(ovNode);
    const mrow = findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "").indexOf("sl-sortable-row") >= 0 && typeof n.props.onClick === "function" && /贵州茅台/.test(textOf(n).join(" ")));
    if (mrow) click(mrow);
    await wait(700);
    ovNode = ov.render({}); renderTree(ovNode);
    const dbtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "日K");
    click(dbtn);
    // 等 K 线真的画出来，而不是无脑睡 1800ms：
    // 反复重画直到出现 K 线容器（candles），否则就等到超时。
    const gotK = await until(() => {
      ovNode = ov.render({}); renderTree(ovNode);
      return !!findNode(ovNode, (n) => n.type === "svg");
    }, 6000);
    ovNode = ov.render({}); renderTree(ovNode);
    const costTxt = textOf(ovNode).join(" ");
    check("有持仓时详情显示成本徽标", /成本 [\d.]+/.test(costTxt), costTxt.slice(0, 200));
    let foundCostLine = null;
    (function walk(n) {
      if (!n || typeof n !== "object" || foundCostLine) return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      // 组件节点的渲染产物在 __rendered（mini-React）
      if (typeof n.type === "function") { walk(n.__rendered); return; }
      if (n.type === "line" && String((n.props || {}).stroke || "").indexOf("var(--sl-") >= 0 && (n.props || {}).strokeDasharray) foundCostLine = n.props;
      (n.children || []).forEach(walk);
    })(ovNode);
    check("有持仓时画出成本虚线", !!foundCostLine, foundCostLine ? String(foundCostLine.stroke) : "状态: " + textOf(ovNode).join(" ").slice(0, 220));
    const badgeTip = findNode(ovNode, (n) => n.type === "span" && String((n.props && n.props.className) || "") === "sl-cost-badge");
    check("成本徽标含持仓明细", !!badgeTip && /成本/.test(String(badgeTip.props["data-sltip"] || "")), badgeTip && String(badgeTip.props["data-sltip"]));
  }

  // 当日盈亏走势曲线
  {
    clickTab("持仓");
    // 等曲线真的出现（含分时拉取），而不是固定睡 1500ms
    await until(() => {
      ovNode = ov.render({}); renderTree(ovNode);
      return !!findNode(ovNode, (n) => n.type === "svg");
    }, 6000);
    ovNode = ov.render({}); renderTree(ovNode);
    const curveBox = findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-pnlcurve");
    check("持仓页显示今日盈亏走势", !!curveBox, "");
    const txt = textOf(curveBox || {}).join(" ");
    check("走势区含标题与零轴基准", /今日盈亏走势/.test(textOf(ovNode).join(" ")), txt.slice(0, 120));
    // 曲线本体：应有 0 基线 + 折线 + 末值标签
    const svgs = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n.type === "function") { walk(n.__rendered); return; }
      if (n.type === "svg") svgs.push(n);
      (n.children || []).forEach(walk);
    })(curveBox || {});
    const svg = svgs[0];
    check("走势渲染出曲线图", !!svg, "");
    if (svg) {
      let hasZero = false, hasPoly = false, hasArea = false;
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.type === "line" && (n.props || {}).strokeDasharray && String((n.props || {}).stroke || "").indexOf("sl-muted") >= 0) hasZero = true;
        if (n.type === "polyline") hasPoly = true;
        if (n.type === "path" && String((n.props || {}).d || "").charAt(0) === "M") hasArea = true;
        (n.children || []).forEach(walk);
      })(svg);
      check("曲线含零轴/折线/填充", hasZero && hasPoly && hasArea, JSON.stringify({ hasZero, hasPoly, hasArea }));
      check("曲线带时间刻度", /09:|10:|11:|13:|14:|15:/.test(textOf(svg).join(" ")), textOf(svg).join(" ").slice(0, 120));
    }

    // ---------- 曲线必须跟随行情刷新 ----------
    // 回归：effect 依赖里原本只有 posKey/curveOn，盘中行情刷新多少次曲线都不动。
    // 现在依赖 curveRefreshTick(updatedAt)，跨分钟即重拉 /minute 并重绘。
    //
    // 阈值逻辑由 test/shared-drift.mjs 对拍 curveRefreshTick 守住（同时跑
    // lib/shared.js 与 client.js 的真实源码），这里只验证**接线**：展开状态下
    // 确实会去拉分时，否则曲线压根没有数据来源。
    //
    // 做法：先收起再展开——收起会把 curve 置空并让依赖变化，必然重新拉一次分时，
    // 这样计数才是确定的（直接 mount 时若上一轮已缓存，effect 不会重跑）。
    {
      const toggleNow = () => {
        const b = findNode(ovNode, (n) => n.type === "button" && /^(收起|展开)$/.test(String(n.children && n.children[0])));
        if (b) b.props.onClick({});
        ovNode = ov.render({});
        renderTree(ovNode);
        return b ? String(b.children && b.children[0]) : null;
      };
      toggleNow(); // 先收起
      await wait(400);

      let minuteCalls = 0;
      const spy = async (url, opts) => {
        if (/\/minute/.test(String(url))) minuteCalls++;
        return REAL_FETCH(String(url).startsWith("http") ? url : ORIGIN + url, opts);
      };
      global.window.fetch = spy;
      global.fetch = spy;
      const was = toggleNow(); // 再展开 → 触发一次拉分时
      await wait(600);
      check("重新展开会拉取分时（曲线有数据来源）", minuteCalls > 0, { was, minuteCalls });

      // 同一分钟内反复重画不应重复打上游（tick 未推进 → 依赖不变 → effect 不重跑）
      const afterExpand = minuteCalls;
      for (let i = 0; i < 3; i++) { ovNode = ov.render({}); renderTree(ovNode); await wait(120); }
      check("同一分钟内不重复拉分时（避免打爆上游）", minuteCalls === afterExpand, { afterExpand, now: minuteCalls });

      // 下面要改刷新间隔，先记下原值供末尾复位
      let pollMsBefore = Number((global.__sl_test_state__ || {}).config?.pollMs);
      if (!Number.isFinite(pollMsBefore) || pollMsBefore < 1000) pollMsBefore = 5000;
      const restorePoll = async (ms) => {
        clickTab("设置");
        const btn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === String(ms / 1000) + "s");
        if (btn) {
          btn.props.onClick({});
          ovNode = ov.render({});
          renderTree(ovNode);
          await wait(700);
        }
        clickTab("持仓");
      };

      // 曲线真正"跟随行情"的判据：点 ⟳ 触发一次真实 refreshQuotes()，
      // 若 Host 返回的 updatedAt 跨过了当前 tick 窗口，依赖变化 → 重新拉分时。
      // 修复前依赖只有 posKey，无论刷新多少次都不会重拉。
      //
      // 不能用「收起→展开」代替：那条路径 curveOn 本就在依赖里，修复前后表现一致，测不出差别。
      {
        // **必须把刷新间隔调到 3s**，否则本用例测不出用户报的 bug。
        // 若沿用默认 5s（或任何 ≥60s 的值），"跨越一个 tick" 与 "跨越一分钟"
        // 这两件事会同时发生，窗口写成 60s 照样能通过——测试就废了。
        // 设成 3s 后，跨一个 tick 仍在同一分钟内：窗口若写死 60s 就不会重拉，断言变红。
        const curPoll = Number((global.__sl_test_state__ || {}).config?.pollMs);
        const hadPoll = curPoll === 3000;
        if (!hadPoll) {
          clickTab("设置");
          const threeS = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "3s");
          if (threeS) {
            threeS.props.onClick({});
            ovNode = ov.render({});
            renderTree(ovNode);
            await wait(150); // 等配置落库（本机 Host，防抖 0）
          }
          clickTab("持仓"); // ⟳ 在标题栏，必须回到持仓页
        }
        const st = global.__sl_test_state__;
        const poll = Number(st && st.config && st.config.pollMs);
        check("刷新间隔已设为 3s（短窗口才能区分 3s 与 60s）", poll === 3000, { poll });

        // 锚在某一分钟的**中间**（第 30 秒），前后各留出足够余量，
        // 保证 pastAt 与 futureAt 落在同一分钟内、却跨过了 3s 的 tick 边界。
        // → 3s 窗口认为变了，60s 窗口认为没变。这正是要区分的两者。
        const anchor = Math.floor(Date.now() / 60000) * 60000 + 30000;
        const pastAt = anchor - 10 * poll; // 往回 30s，仍在同一分钟内
        const futureAt = anchor;
        check("构造的 tick 边界：3s 窗口认为变了、60s 窗口认为没变",
          Math.floor(pastAt / poll) !== Math.floor(futureAt / poll) &&
          Math.floor(pastAt / 60000) === Math.floor(futureAt / 60000),
          { poll, pastAt, futureAt });

        let phase = "past";
        const spy = async (url, opts) => {
          const u = String(url);
          if (/\/minute/.test(u)) minuteCalls++;
          const r = await REAL_FETCH(u.startsWith("http") ? u : ORIGIN + u, opts);
          // 让 /quotes 返回指定 tick 的时间戳，模拟时间推进
          if (/\/quotes/.test(u)) {
            const jj = await r.clone().json();
            jj.updatedAt = phase === "past" ? pastAt : futureAt;
            return jsonResponse(jj, r.status);
          }
          return r;
        };
        global.window.fetch = spy;
        global.fetch = spy;
        minuteCalls = 0;
        const findRefresh = () => findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳");
        check("找到 ⟳ 手动刷新按钮", !!findRefresh(), "（需先切回持仓页，⟳ 在标题栏）");
        // ⟳ 每次重画都要重新找：clickTab 会让组件重挂载，旧节点上的闭包已失效
        const doRefresh = async () => {
          const b = findRefresh();
          if (b) b.props.onClick({});
          await wait(400);
          ovNode = ov.render({});
          renderTree(ovNode);
          await wait(700);
        };

        // 第 0 拍：先把 store 落到 pastAt 这个 tick 上（此时是否重拉都无所谓，不做断言）
        phase = "past";
        await doRefresh();

        // 第 1 拍：跨过 3s tick 边界 —— 必须重拉分时
        phase = "future";
        minuteCalls = 0;
        await doRefresh();
        check("跨过 3s tick 后曲线重新拉分时（跟随设置的刷新间隔）", minuteCalls > 0, { poll, minuteCalls });
      }

      global.window.fetch = patchedFetch;
      global.fetch = patchedFetch;

      // 复位刷新间隔：上面为了区分 3s/60s 把 pollMs 改成了 3000。
      // 不复位的话，这个用例就成了「顺序依赖」——同一条测试连跑两次，
      // 第二次的起点已经是 3s，断言含义都变了。测完必须还原现场。
      await restorePoll(pollMsBefore);
    }
    // 注意：上面的用例会来回切换曲线，**必须复位到展开态**，
    // 否则后续「点按后收起」用例的前提（进来时是展开）不成立。
    {
      const lblNow = () => {
        const b = findNode(ovNode, (n) => n.type === "button" && /^(收起|展开)$/.test(String(n.children && n.children[0])));
        return b ? String(b.children && b.children[0]) : null;
      };
      if (lblNow() === "展开") { // 当前是收起 → 展开回去
        const b = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "展开");
        b.props.onClick({});
        ovNode = ov.render({});
        renderTree(ovNode);
        await wait(150); // 等配置落库（本机 Host，防抖 0）
      }
    }
    // 收起/展开：状态写入配置，切换标签页后仍保持（这正是改成配置态的原因）
    const toggleBtn = () => findNode(ovNode, (n) => n.type === "button" && /^(收起|展开)$/.test(String(n.children && n.children[0])));
    let tg = toggleBtn();
    if (tg) {
      tg.props.onClick({});
      await wait(150); // 等配置落库（本机 Host，防抖 0）
      ovNode = ov.render({}); renderTree(ovNode);
      check("点按后收起走势曲线", String(toggleBtn() && toggleBtn().children[0]) === "展开", String(toggleBtn() && toggleBtn().children[0]));

      // 切到别的标签页再切回来 —— 本地 state 会被重置，配置态不会
      clickTab("自选");
      ovNode = ov.render({}); renderTree(ovNode);
      clickTab("持仓");
      await wait(300);
      ovNode = ov.render({}); renderTree(ovNode);
      check("切换标签页后仍保持收起", String(toggleBtn() && toggleBtn().children[0]) === "展开", String(toggleBtn() && toggleBtn().children[0]));
      check("收起时不渲染曲线图", !findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-pnlcurve" && !!findNode(n, (m) => m.type === "svg")));

      tg = toggleBtn();
      if (tg) {
        tg.props.onClick({});
        // 重新展开要拉分时：等曲线真的画出来，别睡满 1400ms
        await until(() => {
          ovNode = ov.render({}); renderTree(ovNode);
          return !!findNode(ovNode, (n) => n.type === "svg");
        }, 6000);
        ovNode = ov.render({}); renderTree(ovNode);
        check("可重新展开走势曲线", String(toggleBtn() && toggleBtn().children[0]) === "收起", String(toggleBtn() && toggleBtn().children[0]));
      }
    }
  }
}

// ---------- 8b. 清仓：收益不能因为 qty 归零而消失 ----------
// 回归：computeEarnings / earningsDetail 以前用 `if (!qty) continue` 把清仓股
// 整只跳过，于是今日已实现盈亏从汇总里凭空消失，累计盈亏也在清仓瞬间归零。
//
// **必须放在最后**：清仓是破坏性的（qty→0），后面任何依赖"有持仓"的用例都会失效。
// 之前放在买/卖用例后面，直接把后面 3 条 hover 浮层断言弄红了。
{
  clickTab("持仓");
  await until(() => {
    ovNode = ov.render({}); renderTree(ovNode);
    return !!findNode(ovNode, (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-pnlcurve");
  }, 6000);
  ovNode = ov.render({}); renderTree(ovNode);

  // 8a 结尾的行情日期回拨会让手动覆盖"复活"（它按日 key 存的）。
  // 本段要读收益胶囊，先确保指数栏是展开的——8b 考的是收益口径，不是展开时机。
  if (!barHasIndex()) {
    let bn0 = floatReg.render({}); renderTree(bn0);
    const d0 = findNode(bn0, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-bar-dot") >= 0);
    if (d0) d0.props.onClick({});
    renderTree(bn0);
    check("已手动展开指数栏（便于读取收益胶囊）", barHasIndex(), barTexts().slice(0, 120));
  }

  // 悬浮明细走 earningsDetail —— 正是被修的那条路径，前后各读一次做对比
  const openChip = () => {
    let bn = floatReg.render({});
    renderTree(bn);
    const chip = findNode(bn, (n) => n.type === "span" && String((n.props && n.props.className) || "").indexOf("sl-chip-earn") >= 0);
    if (!chip) return { node: bn, chip: null };
    chip.props.onMouseEnter({});
    renderTree(bn);
    bn = floatReg.render({});
    renderTree(bn);
    return { node: bn, chip };
  };
  const pre = openChip();
  const before = readBarEarn(pre.node);
  check("清仓前浮层可读出今日收益（非零，有可验证的基数）", Number.isFinite(before.today) && before.today !== 0, before);
  if (pre.chip) { pre.chip.props.onMouseLeave({}); renderTree(pre.node); await wait(260); }

  const fi = (ph) => findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === ph && typeof n.props.onChange === "function");
  const sellTab = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "卖出");
  click(sellTab);
  ovNode = ov.render({}); renderTree(ovNode);
  // 必须卖**恰好**等于当前持股数：addTxn 有「卖出超过持仓」的拦截，
  // 写 99999 会被拒，qty 根本不会归零（第一版就栽在这，看起来像修复失效）。
  const holdQty = ((global.__sl_test_state__ || {}).config?.positions || [])[0]?.qty || 0;
  check("清仓前持股数 > 0", holdQty > 0, holdQty);
  fi("价格").props.onChange({ target: { value: "1350" } });
  fi("股数").props.onChange({ target: { value: String(holdQty) } });
  ovNode = ov.render({}); renderTree(ovNode);
  click(findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("记一笔") >= 0));
  await wait(400);
  ovNode = ov.render({}); renderTree(ovNode);

  const st = global.__sl_test_state__ || {};
  const pos = (st.config && st.config.positions || [])[0];
  check("清仓后持仓保留但股数为 0（而不是被删掉）", !!pos && pos.qty === 0, pos && pos.qty);

  const post = openChip();
  const after = readBarEarn(post.node);
  check("清仓后收益胶囊仍在（汇总 has 仍为真）", !!post.chip);
  check("清仓后今日收益仍非零（已实现部分继续计入）", Number.isFinite(after.today) && after.today !== 0, after);
  check("清仓前后累计盈亏连续（不凭空归零）", Number.isFinite(after.pnl) && Math.abs(after.pnl - before.pnl) < Math.abs(before.pnl) * 0.5 + 800,
    { before: before.pnl, after: after.pnl });
  check("悬浮明细里清仓股仍出现并标「已清仓」", /贵州茅台（已清仓）/.test(after.txt), after.txt.slice(0, 240));

  // ---------- 下一个交易日：自动移除已清仓的持仓 ----------
  // 当日清仓要保留（上面已验证）；一旦行情日期跨到下一交易日，它就该消失。
  // 这里把 /quotes 的行情日期改成「清仓日的次日」来模拟。
  if (post.chip) { post.chip.props.onMouseLeave({}); renderTree(post.node); await wait(260); }
  {
    const lastDate = (((global.__sl_test_state__ || {}).config?.positions || [])[0]?.txns || [])
      .reduce((a, t) => (String(t.date) > a ? String(t.date) : a), "");
    check("能取到清仓日（用于推算次日）", !!lastDate, lastDate);
    const nextDay = lastDate ? new Date(Date.parse(lastDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10) : "";
    const nextTime = nextDay ? nextDay.replace(/-/g, "") + "150000" : ""; // 行情日期藏在 14 位 time 里
    const spy = async (url, opts) => {
      const u = String(url);
      const r = await REAL_FETCH(u.startsWith("http") ? u : ORIGIN + u, opts);
      if (/\/quotes/.test(u)) {
        const j = await r.clone().json();
        for (const row of (j.rows || [])) row.time = nextTime; // 行情日期推进一天
        return jsonResponse(j, r.status);
      }
      return r;
    };
    global.window.fetch = spy;
    global.fetch = spy;

    const rf = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "⟳");
    check("找到 ⟳ 以触发行情刷新", !!rf);
    if (rf) rf.props.onClick({});
    await until(() => !(((global.__sl_test_state__ || {}).config?.positions) || []).length, 6000);
    ovNode = ov.render({}); renderTree(ovNode);

    const left = ((global.__sl_test_state__ || {}).config?.positions) || [];
    check("行情日期跨到下一交易日后，已清仓持仓被自动移除", left.length === 0, JSON.stringify(left));
    check("移除后持仓页回到「还没有持仓」空态", /还没有持仓/.test(textOf(ovNode).join(" ")), textOf(ovNode).join(" ").slice(0, 160));
    check("移除后收益胶囊消失（无持仓即无汇总）", !readBarEarnText(), "");
    global.window.fetch = patchedFetch;
    global.fetch = patchedFetch;
  }
}

// ---------- 9. 左键拖动排序（自选列表） ----------
{
  clickTab("自选");
  ovNode = ov.render({}); renderTree(ovNode);
  const orderBefore = textOf(ovNode).join(" ").match(/贵州茅台|宁德时代|比亚迪/g) || [];
  check("拖动前有≥2只自选", orderBefore.length >= 2, orderBefore.join(","));
  const grips = [];
  (function collect(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(collect); return; }
    if (n.type === "span" && String((n.props && n.props.className) || "") === "sl-grip") grips.push(n);
    if (n.__rendered) collect(n.__rendered);
    if (n.children) n.children.forEach(collect);
  })(ovNode);
  check("自选行存在拖动手柄", grips.length >= 2, "grips=" + grips.length);
  if (grips.length >= 2 && orderBefore.length >= 2) {
    // 抓第 0 行手柄，向下拖过第 1 行中点 → 插入到 index 2（落点）→ 提交后 0→1
    grips[0].props.onPointerDown({ button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
    renderTree(ovNode); // 触发 useEffect 注册 window 监听
    global.__winDispatch("pointermove", { clientX: 10, clientY: 65 }); // row2 top=60 mid=74 → overAt=2
    renderTree(ovNode);
    global.__winDispatch("pointerup", {});
    await wait(200);
    ovNode = ov.render({}); renderTree(ovNode);
    const orderAfter = textOf(ovNode).join(" ").match(/贵州茅台|宁德时代|比亚迪/g) || [];
    console.log("   拖动排序:", orderBefore.join(","), "→", orderAfter.join(","));
    check("拖动后顺序改变", orderAfter.join(",") !== orderBefore.join(","), orderBefore.join(",") + " vs " + orderAfter.join(","));
    check("原第1项移到第2位", orderAfter.length >= 2 && orderAfter[1] === orderBefore[0], orderAfter.join(","));
    errs = renderTree(ovNode);
    check("拖动排序后无渲染错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
  }
}

// ---------- 提示浮层（[data-sltip]）：点击别处立即消失 ----------
{
  const tipReg = findReg("shell.overlay", "dsh-stock-leek.tip-layer");
  const tipText = () => { const n = tipReg.render({}); renderTree(n); return textOf(n).join(" "); };
  const tipEl = (text) => ({
    getAttribute: (k) => (k === "data-sltip" ? text : null),
    getBoundingClientRect: () => ({ left: 100, top: 200, bottom: 220, width: 80, height: 20 }),
  });
  const ev = (el) => ({ target: { closest: (sel) => (sel === "[data-sltip]" ? el : null) } });
  check("提示层已注册", !!tipReg);
  global.__winDispatch("mouseover", ev(tipEl("提示内容A")));
  check("悬浮显示提示", /提示内容A/.test(tipText()), tipText());
  global.__winDispatch("mousedown", ev(null));
  check("点击别处后提示立即消失", tipText() === "", tipText());
  // 悬浮行 → 点击该行（进入详情/K线）→ 提示必须跟着消失
  const rowEl = tipEl("高 722.87 · 低 717.83\n今开 717.85 · 昨收 720.08\n成交 872.8万手");
  global.__winDispatch("mouseover", ev(rowEl));
  check("行情行悬浮出现提示", /今开 717\.85/.test(tipText()), tipText());
  global.__winDispatch("mousedown", ev(rowEl));
  check("点击该行进入详情时提示消失", tipText() === "", tipText());
  // 点击提示元素自身同样收起（点行 = 导航，提示不能滞留）
  const elB = tipEl("提示内容B");
  global.__winDispatch("mouseover", ev(elB));
  check("再次悬浮出现提示", /提示内容B/.test(tipText()), tipText());
  global.__winDispatch("mousedown", ev(elB));
  check("点击提示元素本身也收起", tipText() === "", tipText());
  global.__winDispatch("mouseover", ev(tipEl("提示内容C")));
  global.__winDispatch("click", ev(null));
  check("click 也能收起提示", tipText() === "", tipText());
  global.__winDispatch("mouseover", ev(tipEl("提示内容D")));
  global.__winDispatch("wheel", ev(null));
  check("滚轮收起提示", tipText() === "", tipText());
  global.__winDispatch("mouseover", ev(tipEl("提示内容E")));
  global.__winDispatch("scroll", ev(null));
  check("滚动收起提示", tipText() === "", tipText());
  global.__winDispatch("mouseover", ev(tipEl("提示内容F")));
  global.__winDispatch("mouseout", ev(tipEl("提示内容F")));
  check("移出元素收起提示", tipText() === "", tipText());
}

// ---------- 预警 UI：tab / 铃铛角标 / 右键设为预警 / 规则 CRUD / 老 Host 吃字段 ----------
{
  // 本段直连 Host 的辅助（用 REAL_FETCH 绕开 mock，读写真实路由）
  const hostJson = async (path) => {
    const r = await REAL_FETCH(ORIGIN + path, { cache: "no-store" });
    return r.json();
  };
  const hostPost = async (path, body) => {
    const r = await REAL_FETCH(ORIGIN + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  };
  // 复位到已知状态：清掉可能残留的规则与已读时间
  const cfgNow = () => globalThis.__sl_test_state__.config;
  /** 走真实交互进入预警二级页：点「设置」tab → 点「🔔 预警」按钮 */
  const openAlertPanelForTest = () => {
    const t = clickTab("设置");
    void t;
    const entry = findNode(ovNode, (n) => n.type === "button" && /🔔 预警/.test(String((n.children && n.children[0]) || "")));
    if (!entry) return "";
    click(entry);
    ovNode = ov.render({}); renderTree(ovNode);
    return textOf(ovNode).join(" ");
  };
  await hostPost("/dsh-stock-leek/config", { config: Object.assign({}, cfgNow(), { alerts: [], remind: true }) });
  globalThis.__sl_test_state__ = null;
  try { globalThis.localStorage.removeItem("sl.alert.seen.v1"); } catch { /* ignore */ }
  ovNode = ov.render({});
  renderTree(ovNode);

  // 1) 预警**不占 tab**：从设置页按钮进入二级页
  // 注意：只检查"四个 tab 都在"挡不住"多了一个预警 tab"，必须同时检查数量恰好为 4
  const tabsNode = findNode(ovNode, (n) => String((n.props && n.props.className) || "") === "sl-tabs");
  const tabBtnCount = (function count(node) {
    if (!node || typeof node !== "object") return 0;
    if (Array.isArray(node)) return node.reduce((a, c) => a + count(c), 0);
    if (node.type === "button") return 1;
    return (node.__rendered ? count(node.__rendered) : 0) + (node.children ? count(node.children) : 0);
  })(tabsNode);
  check("标题栏恰好四个 tab（预警不占位）", tabBtnCount === 4, tabBtnCount);
  const tabLabels = ["大盘", "自选", "持仓", "设置"];
  const tabBtns = tabLabels.map((t) => findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === t));
  check("四个 tab 名称正确", tabBtns.every(Boolean), tabLabels.map((t, i) => t + ":" + !!tabBtns[i]));
  check("标题栏没有「预警」tab", !findNode(ovNode, (n) => n.type === "button" && /^预警/.test(String((n.children && n.children[0]) || ""))));

  ovText = clickTab("设置");
  const alertEntry = findNode(ovNode, (n) => n.type === "button" && /🔔 预警/.test(String((n.children && n.children[0]) || "")));
  check("设置页有预警入口按钮", !!alertEntry, ovText.slice(0, 200));
  ovText = openAlertPanelForTest();
  check("点击后进入预警二级页", /预警总开关/.test(ovText), ovText.slice(0, 120));
  check("二级页有返回按钮", !!findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "← 返回"));
  check("空规则时有引导文案", /还没有预警规则/.test(ovText), ovText.slice(0, 160));

  // 点 tab 必须退出二级页回到设置（否则「点了设置却还停在预警」；这是实现里踩过的真问题）
  ovText = clickTab("设置");
  check("点「设置」tab 退出二级页回到设置页", /恢复默认|测试数据源/.test(ovText) && !/预警总开关/.test(ovText), ovText.slice(0, 160));
  // 返回按钮同样退出
  ovText = openAlertPanelForTest();
  check("可再次进入二级页", /预警总开关/.test(ovText));
  click(findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "← 返回"));
  ovNode = ov.render({}); renderTree(ovNode);
  ovText = textOf(ovNode).join(" ");
  check("点「← 返回」退出二级页", /恢复默认|测试数据源/.test(ovText) && !/预警总开关/.test(ovText), ovText.slice(0, 160));
  ovText = openAlertPanelForTest();

  // 2) 表单新增规则：走真实输入 onchange（harness 模式）
  const rcForm = (cfgNow().alerts || []).length; // 添加前的基数（段首已清空，此处为 0）
  const codeInput = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "代码/选择");
  const valInput = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值");
  check("预警页有代码/阈值输入框", !!codeInput && !!valInput);
  codeInput.props.onChange({ target: { value: "sh600519" } });
  ovNode = ov.render({}); renderTree(ovNode);
  const valInput2 = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值");
  valInput2.props.onChange({ target: { value: "1500" } });
  ovNode = ov.render({}); renderTree(ovNode);
  const addBtn = findNode(ovNode, (n) => n.type === "button" && /添加/.test(String((n.children && n.children[0]) || "")));
  check("预警页有添加按钮", !!addBtn);
  click(addBtn);
  ovNode = ov.render({}); renderTree(ovNode);
  ovText = textOf(ovNode).join(" ");
  check("新增规则后出现在列表", /现价上穿/.test(ovText) && /1500/.test(ovText), ovText.slice(0, 200));
  const ruleCount = () => (cfgNow().alerts || []).length;
  check("规则已写入配置（Host 可见）", ruleCount() === rcForm + 1, { before: rcForm, after: ruleCount() });

  // 3) 非法阈值被挡在 UI（不写配置）
  const valInput3 = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值");
  valInput3.props.onChange({ target: { value: "0" } });
  ovNode = ov.render({}); renderTree(ovNode);
  const codeInput3 = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "代码/选择");
  codeInput3.props.onChange({ target: { value: "sh600519" } });
  ovNode = ov.render({}); renderTree(ovNode);
  click(findNode(ovNode, (n) => n.type === "button" && /添加/.test(String((n.children && n.children[0]) || ""))));
  ovNode = ov.render({}); renderTree(ovNode);
  check("阈值 0 被拒（规则数不变）", ruleCount() === rcForm + 1, ruleCount());

  // 4) 「停用」功能已整体移除：规则存在即评估，删除就是停用
  //    （曾经有 ●/○ 单条开关 + 组头整组开关，现在一个都不该有）
  {
    check("规则行没有启停按钮（●/○ 已移除）",
      !findNode(ovNode, (n) => n.type === "button" && /^[●○]$/.test(String((n.children && n.children[0]) || ""))),
      textOf(ovNode).join(" ").slice(0, 160));
    check("组头没有整组启停按钮",
      !findNode(ovNode, (n) => n.type === "button" && String((n.props && n.props.className) || "").indexOf("sl-alert-gtoggle") >= 0));
    check("规则对象里不再有 enabled 字段",
      (cfgNow().alerts || []).every((r) => !("enabled" in r)), cfgNow().alerts);
  }

  // 4b) 规则按代码分组抽屉：同 code 多条收在一组，跨 code 分组，手风琴单开
  {
    const groupsIn = () => {
      const gs = [];
      (function walk(n) {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.type === "div" && String((n.props && n.props.className) || "") === "sl-alert-group") gs.push(n);
        if (typeof n.type === "function") { walk(n.__rendered); return; }
        if (n.children) n.children.forEach(walk);
      })(ovNode);
      return gs;
    };
    const gText = (g) => {
      const acc = [];
      (function walk(n) {
        // 字符串判断必须在 "非对象就返回" 之前：字符串不是对象，
        // 顺序写反会让所有文本被静默丢掉（gText 恒为空串，断言全红且看不出原因）。
        if (typeof n === "string" || typeof n === "number") { acc.push(String(n)); return; }
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (typeof n.type === "function") { walk(n.__rendered); return; }
        if (n.children) n.children.forEach(walk);
      })(g);
      return acc.join(" ");
    };
    const gHead = (g) => findNode(g, (n) => n.type === "div" && String((n.props && n.props.className) || "") === "sl-alert-ghead");

    // 再加一条**同 code 不同 type** 的规则：应并入同一组，而不是新增一组
    const ci = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "代码/选择");
    ci.props.onChange({ target: { value: "sh600519" } });
    ovNode = ov.render({}); renderTree(ovNode);
    findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值").props.onChange({ target: { value: "3" } });
    ovNode = ov.render({}); renderTree(ovNode);
    const sel = findNode(ovNode, (n) => n.type === "select");
    sel.props.onChange({ target: { value: "pct_up" } });
    ovNode = ov.render({}); renderTree(ovNode);
    click(findNode(ovNode, (n) => n.type === "button" && /添加/.test(String((n.children && n.children[0]) || ""))));
    ovNode = ov.render({}); renderTree(ovNode);
    check("同 code 加了第二条规则（配置层仍是扁平数组）", ruleCount() === rcForm + 2, ruleCount());
    check("同 code 的两条规则**只占一个组**", groupsIn().length === 1, groupsIn().length);
    const g0 = groupsIn()[0];
    check("组头显示股票名与代码", /贵州茅台/.test(gText(g0)) && /600519/.test(gText(g0)), gText(g0).slice(0, 120));
    check("组头显示规则条数（不是启用计数）", /2\s*条/.test(gText(g0)) && !/启用/.test(gText(g0)), gText(g0).slice(0, 120));
    check("添加后自动展开该组（新规则不会藏进收起态）", /现价上穿/.test(gText(g0)) && /涨幅/.test(gText(g0)), gText(g0).slice(0, 160));

    // 换一只 code：应新增第二个组，且手风琴把前一组收起
    const ci2 = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "代码/选择");
    ci2.props.onChange({ target: { value: "sz300750" } });
    ovNode = ov.render({}); renderTree(ovNode);
    findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值").props.onChange({ target: { value: "200" } });
    ovNode = ov.render({}); renderTree(ovNode);
    findNode(ovNode, (n) => n.type === "select").props.onChange({ target: { value: "price_above" } });
    ovNode = ov.render({}); renderTree(ovNode);
    click(findNode(ovNode, (n) => n.type === "button" && /添加/.test(String((n.children && n.children[0]) || ""))));
    ovNode = ov.render({}); renderTree(ovNode);
    check("跨 code 分成两组", groupsIn().length === 2, groupsIn().length);
    const [ga, gb] = groupsIn();
    check("新组自动展开、旧组收起（手风琴单开）",
      /现价上穿|涨幅/.test(gText(gb)) && !/现价上穿|涨幅/.test(gText(ga)),
      { a: gText(ga).slice(0, 80), b: gText(gb).slice(0, 80) });
    check("收起态的组头仍可见（名称+条数在，规则不渲染）",
      !/现价上穿|涨幅/.test(gText(ga)) && /\d+\s*条/.test(gText(ga)),
      gText(ga).slice(0, 120));

    // 点组头手动展开旧组 → 新组应收起
    click(gHead(ga));
    ovNode = ov.render({}); renderTree(ovNode);
    const g2 = groupsIn();
    check("点组头展开该组（规则重新渲染）", /现价上穿/.test(gText(g2[0])), gText(g2[0]).slice(0, 140));
    check("展开一组会把另一组收起", !/宁德时代.*200/.test(gText(g2[1])) && !/现价上穿/.test(gText(g2[1])), gText(g2[1]).slice(0, 120));
    // 再点一次收起
    click(gHead(groupsIn()[0]));
    ovNode = ov.render({}); renderTree(ovNode);
    check("再点组头收起该组", !/现价上穿/.test(gText(groupsIn()[0])), gText(groupsIn()[0]).slice(0, 120));

    // 已触发角标在**收起态**也要可见。
    //
    // 走**真实链路**而不是伪造 fetch：让 Host 评估真的把这条规则标成 fired
    // （__alertTickForTest 写进账本），再进预警页让 refreshAlerts 正常拉取。
    // 试过直接用 fetch 替身伪造 /alerts 响应：替身确实被命中、也返回了 fired，
    // 但窗口内总有更早发出、用真实 fetch 的同路径请求后到，把 states 覆盖回 {}，
    // 状态永远落不了地（直到超时）。伪造响应不如让真链路跑通。
    {
      const firedId = (cfgNow().alerts || [])[0].id;
      const todayBJ2 = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date()).replace(/-/g, "");
      const firedCfg = Object.assign({}, cfgNow(), {
        remind: true,
        alerts: [{ id: firedId, code: "sh600519", type: "price_above", value: 1 }],
      });
      await hostPost("/dsh-stock-leek/config", { config: firedCfg });
      __alertTickForTest(firedCfg, [{ code: "sh600519", name: "贵州茅台", price: 1700, percent: 2, time: todayBJ2 + "100000" }], {});
      const ledger2 = await hostJson("/dsh-stock-leek/alerts");
      check("Host 账本里确实记下了 fired（前置条件成立）",
        !!(ledger2.states && ledger2.states[firedId] && ledger2.states[firedId].phase === "fired"),
        JSON.stringify(ledger2.states));

      openAlertPanelForTest(); // 返回的是**文本**，别赋给 ovNode（会把节点变量覆盖成字符串）
      await until(() => {
        const st = (global.__sl_test_state__ || {}).alertStates || {};
        return !!(st[firedId] && st[firedId].phase === "fired");
      }, 4000);
      ovNode = ov.render({}); renderTree(ovNode);
      const gFired = groupsIn()[0];
      check("收起态的组头显示「已触发 N」（不展开也知道哪只响过）",
        /已触发\s*1/.test(gText(gFired)) && !/现价上穿|涨幅/.test(gText(gFired)),
        gText(gFired).slice(0, 140) + " || states=" + JSON.stringify((global.__sl_test_state__ || {}).alertStates || {}));
      global.window.fetch = patchedFetch;
      global.fetch = patchedFetch;
    }

    // 清回一条规则，避免影响后续用例。
    // 必须走**客户端自己的删除按钮**（updateConfig 会同步 store）——
    // 直接 hostPost 只改 Host 上的文件，客户端的 config 不会重新读，断言会继续看到旧数据。
    {
      const collectDel = () => {
        const out = [];
        (function walk(n) {
          if (!n || typeof n !== "object") return;
          if (Array.isArray(n)) { n.forEach(walk); return; }
          if (n.type === "button" && String((n.props && n.props.className) || "") === "sl-x" && /删除该规则/.test(String((n.props && n.props["data-sltip"]) || ""))) out.push(n);
          if (typeof n.type === "function") { walk(n.__rendered); return; }
          if (n.children) n.children.forEach(walk);
        })(ovNode);
        return out;
      };
      openAlertPanelForTest(); // 注意：它返回的是**文本**，别赋给 ovNode（节点变量会被覆盖成字符串，后面 walk 全空）
      ovNode = ov.render({}); renderTree(ovNode);
      // 组头是 **toggle**：已经展开时点它会收起，删按钮就没了。
      // 所以先看有没有删按钮，没有才点组头展开（幂等，不依赖进入时的展开态）。
      let delInGroup = collectDel();
      if (delInGroup.length === 0) {
        click(gHead(groupsIn()[0]));
        ovNode = ov.render({}); renderTree(ovNode);
        delInGroup = collectDel();
      }
      check("分区展开后可删除组内规则", delInGroup.length >= 1, delInGroup.length);
      while (delInGroup.length > 0) {
        click(delInGroup[delInGroup.length - 1]); // 每次删最后一条
        ovNode = ov.render({}); renderTree(ovNode);
        await wait(200);
        ovNode = ov.render({}); renderTree(ovNode);
        if (groupsIn().length <= 1) break;
        // 下一组可能还收着
        let next = collectDel();
        if (next.length === 0) {
          click(gHead(groupsIn()[groupsIn().length - 1]));
          ovNode = ov.render({}); renderTree(ovNode);
          next = collectDel();
        }
        delInGroup = next;
      }
      check("删到只剩一组（组数随规则数收敛）", groupsIn().length === 1, groupsIn().length);
    }

    // 4c) 停用功能已移除：无论收起还是展开，都不该有任何启停控件
    //     （曾经有过：单条 ●/○ + 组头整组开关。用户要求「删除就是停用」）
    {
      const anyToggle = () => findNode(ovNode, (n) => n.type === "button"
        && (/^[●○]$/.test(String((n.children && n.children[0]) || ""))
          || String((n.props && n.props.className) || "").indexOf("sl-alert-gtoggle") >= 0));
      // 组头是 toggle，先**显式归位**再断言，别依赖上一段留下的展开态
      const setOpen = (want) => {
        if (((global.__sl_test_state__ || {}).alertOpen !== null) === want) return;
        click(gHead(groupsIn()[0]));
        ovNode = ov.render({}); renderTree(ovNode);
      };
      setOpen(false);
      check("收起态没有任何启停控件", !anyToggle(), gText(groupsIn()[0]).slice(0, 120));
      setOpen(true);
      check("展开态也没有任何启停控件", !anyToggle(), gText(groupsIn()[0]).slice(0, 160));
      check("展开后规则行只剩「规则文本 + 删除」",
        !!findNode(ovNode, (n) => n.type === "button" && String((n.props && n.props["data-sltip"]) || "") === "删除该规则"),
        gText(groupsIn()[0]).slice(0, 160));
      setOpen(false); // 归位，免得影响后续用例
    }
  }

  // 5) 左下角**不放提醒图标**（用户明确要求）：展开与收起态都不得出现铃铛
  {
    const floatReg2 = findReg("shell.overlay", "dsh-stock-leek.floating-bar");
    const prevNow = globalThis.__sl_now__;
    const hasBell = (node) => !!findNode(node, (n) => /sl-bell/.test(String((n.props && n.props.className) || "")));

    // 盘中（展开态）
    globalThis.__sl_now__ = Date.parse("2026-10-15T00:00:00Z") + (10 * 60 - 480) * 60000; // 北京 10:00
    const bnOpen = floatReg2.render({});
    renderTree(bnOpen);
    check("盘中展开态：左下角没有铃铛", !hasBell(bnOpen), textOf(bnOpen).join(" ").slice(0, 120));

    // 收盘后（收起态）
    globalThis.__sl_now__ = Date.parse("2026-10-15T00:00:00Z") + (20 * 60 - 480) * 60000; // 北京 20:00
    const bn = floatReg2.render({});
    renderTree(bn);
    const barTxt = textOf(bn).join(" ");
    check("收起态：左下角没有铃铛", !hasBell(bn), barTxt.slice(0, 120));
    check("收起态确实没有指数胶囊（前提成立）", barTxt.indexOf("上证") < 0, barTxt.slice(0, 120));
    check("收起态仍留设置按钮", barTxt.indexOf("⚙") >= 0, barTxt.slice(0, 120));
    globalThis.__sl_now__ = prevNow;

    // 账本仍照常写入：提醒图标没了，但「Host 独立评估 + 账本」这条链不受影响。
    // 行情日期用**真实当日**（市场本地日）：applyAlertTick 有交易日判据，
    // 写死过去某天会被判成"该市场今天没开"而跳过，断言就空转了。
    const todayBJ = (() => {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date()).replace(/-/g, "");
      return p;
    })();
    const c1 = cfgNow();
    await hostPost("/dsh-stock-leek/config", {
      config: Object.assign({}, c1, { remind: true, alerts: [{ id: "bell1", code: "sh600519", type: "price_above", value: 1 }] }),
    });
    __alertTickForTest({ remind: true, positions: [], alerts: [{ id: "bell1", code: "sh600519", type: "price_above", value: 1 }] },
      [{ code: "sh600519", name: "贵州茅台", price: 1700, percent: 2, time: todayBJ + "100000" }], {});
    const ledger = await hostJson("/dsh-stock-leek/alerts");
    // 用户要求：去掉触发历史（events 不再落盘），但评估仍要工作 → states 必须有记录。
    // states 是「每交易日只提示一次」的唯一依据，丢了会重复播报。
    check("评估仍在工作：账本记录了规则状态（states）", !!ledger.states && !!ledger.states.bell1, ledger.states);
    check("触发历史已去掉：账本不再有 events 流水", ledger.events === undefined, { events: ledger.events });
  }

  // 6) 右键「设为预警」→ 弹层预填现价
  ovNode = ov.render({});
  renderTree(ovNode);
  ovText = clickTab("自选");
  const watchRow = findNode(ovNode, (n) => typeof n.props.onCtx === "function");
  check("自选行有右键菜单钩子", !!watchRow);
  if (watchRow) {
    watchRow.props.onCtx({ clientX: 120, clientY: 140, preventDefault() {}, stopPropagation() {} });
    ovNode = ov.render({}); renderTree(ovNode);
    const item = findNode(ovNode, (n) => n.type === "button" && /设为预警/.test(textOf(n).join("")));
    check("右键菜单含「设为预警」", !!item, textOf(ovNode).join(" ").slice(0, 200));
    if (item) {
      click(item);
      ovNode = ov.render({}); renderTree(ovNode);
      const dlgText = textOf(ovNode).join(" ");
      check("弹出预警对话框（含股票名）", /设为预警/.test(dlgText), dlgText.slice(0, 160));
      const dlgVal = findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值" && Number(n.props.value) > 0);
      check("对话框预填现价（>0）", !!dlgVal, dlgVal && dlgVal.props.value);
      const okBtn = findNode(ovNode, (n) => n.type === "button" && /添加规则/.test(String((n.children && n.children[0]) || "")));
      check("对话框有添加按钮", !!okBtn);
      const rc0 = ruleCount(); // 用例内所有规则数断言都基于相对值，避免顺序耦合
      click(okBtn);
      ovNode = ov.render({}); renderTree(ovNode);
      check("对话框添加后规则 +1", ruleCount() === rc0 + 1, { before: rc0, after: ruleCount() });

      // 成本类：阈值输入应消失（阈值就是成本价），且文案不得重复成「突破成本 成本价」
      const watchRow2 = findNode(ovNode, (n) => typeof n.props.onCtx === "function");
      if (watchRow2) {
        watchRow2.props.onCtx({ clientX: 120, clientY: 140, preventDefault() {}, stopPropagation() {} });
        ovNode = ov.render({}); renderTree(ovNode);
        const item2 = findNode(ovNode, (n) => n.type === "button" && /设为预警/.test(textOf(n).join("")));
        click(item2);
        ovNode = ov.render({}); renderTree(ovNode);
        const sel = findNode(ovNode, (n) => n.type === "select");
        check("对话框有条件下拉", !!sel);
        if (sel) {
          const opts = (sel.children || []).map((o) => String(o.children && o.children[0]));
          check("下拉含 8 种条件", opts.length === 8, opts);
          sel.props.onChange({ target: { value: "cost_below" } });
          ovNode = ov.render({}); renderTree(ovNode);
          const costText = textOf(ovNode).join(" ");
          check("成本类隐藏阈值输入（阈值即成本价）", !findNode(ovNode, (n) => n.type === "input" && n.props.placeholder === "阈值"), costText.slice(-180));
          check("成本类有说明文案", /成本价/.test(costText), costText.slice(-180));
          const cbtn = findNode(ovNode, (n) => n.type === "button" && /添加规则/.test(String((n.children && n.children[0]) || "")));
          click(cbtn);
          ovNode = ov.render({}); renderTree(ovNode);
          const afterText = textOf(ovNode).join(" ");
          check("成本类规则文案不重复（无「成本 成本价」）", !/成本\s*成本价/.test(afterText), afterText.slice(0, 240));
          check("成本类规则已添加", ruleCount() === rc0 + 2, ruleCount());
        }
      }
    }
  }

  // 7) 触发历史已按要求去掉：预警页**不再有**「触发历史」区块，
  //    Host 的 /alerts 也不再返回 events（只返回 states）
  ovNode = ov.render({}); renderTree(ovNode);
  ovText = openAlertPanelForTest();
  check("预警页不再显示「触发历史」标题", !/触发历史/.test(ovText), ovText.slice(0, 200));
  check("预警页不再有历史空态文案", !/暂无触发记录/.test(ovText), ovText.slice(0, 200));
  check("预警页不再渲染历史行容器", !findNode(ovNode, (n) => /sl-alert-hist|sl-alert-ev/.test(String((n.props && n.props.className) || ""))));
  const hist = await hostJson("/dsh-stock-leek/alerts");
  check("/alerts 端点不再返回 events", hist.events === undefined, { keys: Object.keys(hist) });
  check("/alerts 仍返回 states（评估依据）", !!hist.states && typeof hist.states === "object", hist.states);

  // 8) 删除规则
  ovNode = ov.render({}); renderTree(ovNode);
  const delBtn = findNode(ovNode, (n) => n.type === "button" && String((n.props && n.props.className) || "") === "sl-x");
  check("规则行有删除按钮", !!delBtn);
  if (delBtn) {
    const before = ruleCount();
    click(delBtn);
    ovNode = ov.render({}); renderTree(ovNode);
    // 用相对值而非写死基数：用例增删规则时不会连带失败
    check("删除后规则数 -1", ruleCount() === before - 1, { before, after: ruleCount() });
  }

  // 9) 老 Host 吃掉 alerts 字段 → 本地回填保护（与 ma 同一个坑）
  //
  // 注意：initStore 有 `inited` 守卫（一页只跑一次），所以**不能**靠反复 render 来重放
  // 初始加载的合并分支——那样断言是空转的。这里走 persistConfig 的回包合并：
  // 每次 POST /config 成功都会执行同一套「老 Host 吃字段 → 保留本地值」逻辑。
  {
    const localCfg = Object.assign({}, cfgNow(), { alerts: [{ id: "keep1", code: "sh600519", type: "pct_up", value: 3 }] });
    const prevFetch = global.fetch;
    // 让 POST /config 的回包**丢掉 alerts**（模拟不认识该字段的老 Host）
    const stubPost = (dropAlerts) => async (url, opts) => {
      if (String(url).indexOf("/dsh-stock-leek/config") >= 0 && opts && opts.method === "POST") {
        const sent = JSON.parse(opts.body || "{}").config || {};
        const back = Object.assign({}, sent);
        if (dropAlerts) delete back.alerts;
        return { ok: true, json: async () => ({ ok: true, config: back, rev: 1, path: "(test)" }) };
      }
      return prevFetch(url, opts);
    };
    // 触发一次保存：改 pollMs（无害字段）以走 persistConfig 的合并分支
    global.fetch = stubPost(true);
    global.window.fetch = global.fetch;
    const ov2 = findReg("shell.overlay", "dsh-stock-leek");
    const n2 = ov2.render({});
    renderTree(n2);
    // 直接调 store 的 updateConfig 路径：渲染设置页并点一个 seg 按钮代价高，
    // 这里用已暴露的真实入口——改配置后 persistConfig 会在防抖后 POST。
    await hostPost("/dsh-stock-leek/config", { config: localCfg }); // 先把规则落到 Host
    // 用 UI 真实交互触发保存（设置页刷新间隔按钮）
    ovNode = ov.render({}); renderTree(ovNode);
    ovText = clickTab("设置");
    const segBtn = findNode(ovNode, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "10s");
    check("设置页有刷新间隔按钮（用于触发一次保存）", !!segBtn);
    if (segBtn) {
      click(segBtn);
      ovNode = ov.render({}); renderTree(ovNode);
      await wait(600); // 等过保存防抖
      check("老 Host 吃字段时本地规则仍在（回填保护）", (cfgNow().alerts || []).length >= 1, cfgNow().alerts);
    }
    // 反向对照：回包**带**空 alerts → 以回包为准（不误保留），证明上面测的是回填而非"本地一直都在"
    global.fetch = stubPost(false);
    global.window.fetch = global.fetch;
    if (segBtn) {
      const segBtn2 = findNode(ov.render({}), (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "30s");
      if (segBtn2) {
        click(segBtn2);
        await wait(600);
        check("新 Host 回空数组时以回包为准（不误保留）", (cfgNow().alerts || []).length === 0, cfgNow().alerts);
      }
    }
    global.fetch = prevFetch;
    global.window.fetch = prevFetch;
  }

  // 复位，避免污染后续用例
  await hostPost("/dsh-stock-leek/config", { config: Object.assign({}, cfgNow(), { alerts: [] }) });
  ovNode = ov.render({}); renderTree(ovNode);
}

// ---------- 预警通知层：隐藏不断流 / 三级降级 / 权限申请时机 / 多标签去重 ----------
{
  /**
   * 预警弹窗现在注册为**独立 slot**（dsh-stock-leek.alert-popup），不再挂在
   * Overlay 内部——Overlay 有 `if (!s.open) return null`，挂里面会导致
   * 「悬浮窗关着时收不到预警」（用户实测反馈）。
   * 所以所有弹窗断言都必须从这个 slot 渲染，而不是 ov.render() 的树。
   * 定义在本块顶层：3a/3c/3x 各段共用。
   */
  const popReg = findReg("shell.overlay", "dsh-stock-leek.alert-popup");
  // 前置断言：弹窗 slot 必须真的注册了。
  // 没有它，popReg 为 undefined 时 popNode() 内部抛错会被上层吞掉，
  // 后续「查找节点」类断言全部返回 null → 失败信息误导，甚至掩盖"弹窗没注册"。
  check("预警弹窗注册为独立 slot（不依赖悬浮窗开关）", !!popReg, (slots["shell.overlay"] || []).map((r) => r.id));
  const popNode = () => { const n = popReg.render({}); renderTree(n); return n; };
  const popupOf = (node) => findNode(node, (n) => String((n.props && n.props.className) || "").indexOf("sl-alert-pop") >= 0);
  const stubNotification = (permission) => {
    const calls = [];
    function Fake(title, opts) { calls.push({ title, opts }); }
    Fake.permission = permission;
    Fake.requestPermission = async () => { calls.push({ asked: true }); return permission; };
    global.Notification = Fake;
    global.window.Notification = Fake;
    return calls;
  };
  const setHidden = (v) => { global.document.hidden = v; };

  // 1) 权限只在用户手势时申请：加载/进入预警页都不该触发 requestPermission
  const calls = stubNotification("default");
  ovNode = ov.render({}); renderTree(ovNode);
  clickTab("设置");
  const entry2 = findNode(ovNode, (n) => n.type === "button" && /🔔 预警/.test(String((n.children && n.children[0]) || "")));
  check("设置页预警入口存在（通知用例前提）", !!entry2);
  click(entry2);
  ovNode = ov.render({}); renderTree(ovNode);
  ovText = textOf(ovNode).join(" ");
  check("渲染预警页不申请通知权限（需用户手势）", !calls.some((c) => c.asked), calls);

  // 2) 按钮点击才申请，并把结果写进 state
  const askBtn = findNode(ovNode, (n) => n.type === "button" && /开启桌面通知|通知已开启/.test(String((n.children && n.children[0]) || "")));
  check("预警页有桌面通知按钮", !!askBtn, textOf(ovNode).join(" ").slice(0, 200));
  if (askBtn) {
    click(askBtn);
    await wait(60);
    check("点击后确实申请了权限", calls.some((c) => c.asked), calls);
  }

  // 3) 应用内弹窗：**可见与隐藏都必须弹**（用户明确要求；webview 里
  //    隐藏时标题看不见、系统通知未必可用，只靠那两条等于收不到）
  {
    const c2 = stubNotification("granted");
    setHidden(false);

    // 3a) 可见时触发
    await globalThis.__sl_notify_test__({ ruleId: "p1", at: Date.now(), code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700, percent: 2 });
    let pn = popNode();
    const popVisible = popupOf(pn);
    check("【可见】触发时弹出应用内预警弹窗", !!popVisible, textOf(pn).join(" ").slice(-160));
    check("弹窗含股票名与条件", !!popVisible && /贵州茅台/.test(textOf(popVisible).join(" ")) && /现价上穿/.test(textOf(popVisible).join(" ")), textOf(popVisible || {}).join(" ").slice(0, 120));

    // 3a-2) **悬浮窗关闭时也必须弹**（用户实测报的 bug）。
    //       原实现把 AlertPopup 挂在 Overlay 内部，而 Overlay 有
    //       `if (!s.open) return null` → 悬浮窗关着时弹窗一起被吞掉。
    //       判据：先关掉悬浮窗（open=false），再触发一次，弹窗仍要出现，
    //       且此时 Overlay 自身渲染为空。
    {
      globalThis.__sl_test_state__.open = false;
      const ovWhenClosed = ov.render({});
      renderTree(ovWhenClosed);
      check("前置：悬浮窗关闭时 Overlay 渲染为空", !textOf(ovWhenClosed).join(" ").trim(), textOf(ovWhenClosed).join(" ").slice(0, 80));
      globalThis.__sl_test_state__.alertPopups = [];
      await globalThis.__sl_notify_test__({ ruleId: "p1b", at: Date.now() + 3, code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700, percent: 2 });
      const pnClosed = popNode();
      check("【悬浮窗关闭】仍弹出预警弹窗", !!popupOf(pnClosed), textOf(pnClosed).join(" ").slice(-160));
      globalThis.__sl_test_state__.open = true;
    }

    // 用户要求去掉预警 toast（弹窗已更醒目，顶部再飘一条属重复打扰）
    check("不再补预警 toast（已按要求去掉）", !/🔔/.test(String((globalThis.__sl_test_state__.toast || {}).text || "")), globalThis.__sl_test_state__.toast);
    check("可见时同样发系统通知（不互斥）", c2.length >= 1, c2.length);

    // 3b) 隐藏时触发（同一条弹窗通道，不能被降级链吞掉）
    setHidden(true);
    await globalThis.__sl_notify_test__({ ruleId: "p2", at: Date.now() + 5, code: "sz300750", name: "宁德时代", type: "price_below", value: 300, price: 278.5, percent: -0.58 });
    setHidden(false);
    pn = popNode();
    const popHidden = popupOf(pn);
    check("【隐藏】触发时同样弹出应用内弹窗", !!popHidden, textOf(pn).join(" ").slice(-200));
    const popText = textOf(pn).join(" ");
    check("隐藏时的事件也在弹窗里（宁德时代）", /宁德时代/.test(popText), popText.slice(-200));

    // 3c) 弹窗可手动关闭，同时也在倒计时（10s 后自动消失，见 3x 段）
    const popNow = popupOf(popNode());
    check("弹窗有关闭按钮", !!findNode(popNow, (n) => n.type === "button" && String((n.children && n.children[0]) || "") === "✕"));
    const beforeState = (globalThis.__sl_test_state__.alertPopups || []).length;
    check("弹窗进入 state 队列（待确认）", beforeState >= 2, beforeState);

    // 3c-2) 定位：弹窗**居中**（用户指定回到 29d4fcf 那版的观感：
    //       对话区顶部居中；探测不到对话区时视口居中）。
    //       注意取外层定位容器（fixed/z10005）——popupOf 命中的是内层卡片，无定位样式。
    const popBox = findNode(popNode(), (n) => n.props && n.props.style && n.props.style.position === "fixed" && n.props.style.zIndex === 10005);
    const st2 = popBox && popBox.props && popBox.props.style;
    check("找到弹窗定位容器", !!st2, st2);
    check("弹窗不贴右上角（未用 right 定位）", !!st2 && st2.right === undefined, st2);
    check("弹窗位于上方区域（top ≤ 120）", !!st2 && typeof st2.top === "number" && st2.top <= 120, st2 && st2.top);
    check("弹窗宽度受限（≤560，不与对话区等宽）", !!st2 && typeof st2.width === "number" && st2.width <= 560, st2 && st2.width);
    // 居中判据：回退路径用 translateX(-50%)；探测到对话区时算出的 left 应贴近
    // 视口中线附近（不贴边）。判据要能区分「居中 vs 贴左」——只查 left 是数字挡不住。
    check("弹窗水平居中（translateX(-50%) 或偏离视口中线 < 40%）",
      !!st2 && (st2.transform !== undefined || Math.abs((st2.left + st2.width / 2) - global.window.innerWidth / 2) < global.window.innerWidth * 0.4),
      { transform: st2 && st2.transform, left: st2 && st2.left, w: st2 && st2.width, vw: global.window.innerWidth });
    // 卡片撑满容器宽度（居中布局下卡片等宽更整齐）
    const cardStyle = popupOf(popNode()) && popupOf(popNode()).props && popupOf(popNode()).props.style;
    check("卡片宽度自适应占满（样式由 CSS 的 width:100% 控制）", !cardStyle || cardStyle.width === undefined, cardStyle);

    // 3c-3) 两种定位路径都要**居中**（29d4fcf 语义）：
    //   - 探测到对话区 → 对话区内居中
    //   - 探测不到      → 视口居中（translateX(-50%)）
    // 注意：convRect 是 useState 缓存，跨用例会保留上次测量结果，
    // 因此不假设当前走哪条路径，而是**按实际形态**校验「居中」而非「贴左」。
    {
      const popFallback = findNode(popNode(), (n) => n.props && n.props.style && n.props.style.position === "fixed" && n.props.style.zIndex === 10005);
      const fs2 = popFallback && popFallback.props.style;
      const isViewportCentered = !!fs2 && fs2.transform === "translateX(-50%)" && fs2.left === "50%";
      check("弹窗水平居中（视口居中 或 对话区内居中，均非贴左）",
        !!fs2 && (isViewportCentered
          || (typeof fs2.left === "number" && fs2.left > 24 && fs2.width >= 200 && fs2.width <= 560)),
        { transform: fs2 && fs2.transform, left: fs2 && fs2.left, w: fs2 && fs2.width });
      check("弹窗未贴右上角（未用 right 定位）", !!fs2 && fs2.right === undefined, fs2);
    }

    // 3c-4) 同一时间**最多 3 条**；再多时叠加到最早那条（显示 +N）
    {
      const push = globalThis.__sl_notify_test__;
      globalThis.__sl_test_state__.alertPopups = [];
      const ids = [];
      for (let i = 1; i <= 5; i++) {
        ids.push("cap" + i);
        await push({ ruleId: "cap" + i, at: Date.now() + i, code: "sh600519", name: "贵州茅台", type: "price_above", value: i, price: 1700 });
      }
      const st3 = globalThis.__sl_test_state__.alertPopups || [];
      check("最多保留 3 条卡片", st3.length === 3, st3.length);
      const overflowSum = st3.reduce((n, x) => n + (Number(x.overflow) || 0), 0);
      check("溢出的 2 条叠加到最早那条（+N=2）", overflowSum === 2, st3.map((x) => x.overflow));
      check("叠加记在最早那条上", Number(st3[0].overflow) === 2, st3[0]);
      // 界面上能看到 +N 徽标
      const more = findNode(popNode(), (n) => String((n.props && n.props.className) || "").indexOf("sl-alert-pop-more") >= 0);
      check("卡片显示 +N 徽标", !!more && /\+\d/.test(String(more.children && more.children[0])), more && more.children);
      // 「全部关闭」计数应含叠加（3 卡片 + 2 叠加 = 5）
      const closeAll2 = findNode(popNode(), (n) => n.type === "button" && /全部关闭/.test(String((n.children && n.children[0]) || "")));
      check("「全部关闭（5）」含被叠加的条数", !!closeAll2 && /（5）/.test(String(closeAll2.children && closeAll2.children[0])), closeAll2 && closeAll2.children);
    }

    // 3d) 「全部关闭」能清空弹窗
    //     先推两条（保证按钮存在：仅 1 条时不渲染该按钮），再点它
    globalThis.__sl_test_state__.alertPopups = [];
    await globalThis.__sl_notify_test__({ ruleId: "cl1", at: Date.now() + 50, code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700 });
    await globalThis.__sl_notify_test__({ ruleId: "cl2", at: Date.now() + 51, code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700 });
    const pnD = popNode();
    const closeAll = findNode(pnD, (n) => n.type === "button" && /全部关闭/.test(String((n.children && n.children[0]) || "")));
    check("多条弹窗时有「全部关闭」", !!closeAll, textOf(pnD).join(" ").slice(-160));
    if (closeAll) {
      click(closeAll);
      check("全部关闭后弹窗清空", (globalThis.__sl_test_state__.alertPopups || []).length === 0, globalThis.__sl_test_state__.alertPopups);
      check("关闭后界面无弹窗节点", !popupOf(popNode()));
    }
  }

  // 3x) 10 秒自动消失 + 隐藏时暂停计时
  {
    const st = () => globalThis.__sl_test_state__;
    const popIds = () => (st().alertPopups || []).map((p) => p.id);

    // 清场
    st().alertPopups = [];

    // 3x-1) 可见时弹出：立即有 shownAt（计时已开始）
    setHidden(false);
    await globalThis.__sl_notify_test__({ ruleId: "d1", at: Date.now(), code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700 });
    const p1 = (st().alertPopups || [])[0];
    check("可见弹出时计时起点已就绪（shownAt>0）", !!p1 && Number(p1.shownAt) > 0, p1);

    // 3x-2) 隐藏时弹出：shownAt=0（不计时），恢复可见后补上起点。
    // 这是「隐藏也要能收到」的关键——否则弹窗会在看不见的时候过期。
    st().alertPopups = [];
    setHidden(true);
    await globalThis.__sl_notify_test__({ ruleId: "d2", at: Date.now() + 9, code: "sz300750", name: "宁德时代", type: "price_below", value: 300, price: 278.5 });
    const p2 = (st().alertPopups || [])[0];
    check("隐藏弹出时不计时（shownAt=0，冻结）", !!p2 && Number(p2.shownAt) === 0, p2);
    await wait(1200);
    check("隐藏期间弹窗不会自动消失（等到用户回来）", popIds().length === 1, popIds());
    // 恢复可见 → 起点补上
    setHidden(false);
    global.__docDispatch("visibilitychange");
    await wait(30);
    const p2b = (st().alertPopups || [])[0];
    check("恢复可见后补上计时起点（开始 10s 倒计时）", !!p2b && Number(p2b.shownAt) > 0, p2b);

    // 3x-3) 自动消失：把 shownAt 回拨到 10s 前，触发计时 effect 后应被清掉
    st().alertPopups = (st().alertPopups || []).map((p) => Object.assign({}, p, { shownAt: Date.now() - 11000 }));
    st().visibleTick = (st().visibleTick || 0) + 1;
    popNode();
    await wait(60);
    check("超过 10 秒的弹窗被自动清掉", (st().alertPopups || []).length === 0, st().alertPopups);

    // 3x-4) 未超时的不会被误清（对照，防"倒计时一跑就全清"）
    st().alertPopups = [];
    setHidden(false);
    await globalThis.__sl_notify_test__({ ruleId: "d3", at: Date.now() + 20, code: "sh600519", name: "贵州茅台", type: "price_above", value: 1, price: 1700 });
    st().visibleTick = (st().visibleTick || 0) + 1;
    popNode();
    await wait(80);
    check("刚弹出的 10 秒内保留（对照）", (st().alertPopups || []).length === 1, st().alertPopups);
    // 进度条：可见的倒计时视觉
    const bar = findNode(popNode(), (n) => String((n.props && n.props.className) || "").indexOf("sl-alert-pop-bar") >= 0);
    check("弹窗带倒计时进度条", !!bar, textOf(ovNode).join(" ").slice(-120));

    // 3x-5) **窄窗口下仍在视口内**（用户实测：全屏可见、缩小窗口就消失）。
    //        必须让探测分支真的跑起来（__forceSeat）——否则走的是硬编码回退值，
    //        钳制与否都一样，断言会空转（踩过：去掉钳制仍全绿）。
    const popStyleOf = (node) => {
      const n = findNode(node, (x) => x.props && x.props.style && x.props.style.position === "fixed" && x.props.style.zIndex === 10005);
      return n && n.props.style;
    };
    const savedW = global.window.innerWidth;
    const savedH = global.window.innerHeight;
    // 先确认探测分支生效：宽窗口下应在**对话区内居中**。
    // 按公式 left = conv.left + (conv.width − boxW)/2 反推：实测 w=560 时 left=340
    // → conv.left + (conv.width−560)/2 = 340。断言用「左右留白大致相等」这个
    // 居中本质，而不是写死 mock 数字（父链层数变化会移动几何）。
    global.__forceSeat = true;
    global.window.innerWidth = 1400;
    global.window.innerHeight = 900;
    global.__winDispatch("resize", {});
    await wait(60); // useConversationRect 需一轮测量
    popNode();
    const wide = popStyleOf(popNode());
    console.log("   宽窗口弹窗几何:", JSON.stringify({ left: wide && wide.left, top: wide && wide.top, w: wide && wide.width }));
    // 与「视口居中」对比：视口居中会是 (1400−560)/2 = 420，对话区居中因面板左偏而更小
    const viewportLeft = wide ? (1400 - wide.width) / 2 : null;
    check("探测到对话区：在该区内居中（左侧留有面板左边距，非视口居中）",
      !!wide && typeof wide.left === "number" && wide.left < viewportLeft,
      { left: wide && wide.left, viewportLeft });

    // 缩到很窄：对话区被挤压时坐标会越界——必须被钳回视口（居中语义不变）
    global.window.innerWidth = 400;
    global.window.innerHeight = 300;
    global.__winDispatch("resize", {});
    await wait(60);
    popNode();
    const narrow = popStyleOf(popNode());
    console.log("   窄窗口弹窗几何:", JSON.stringify({ left: narrow && narrow.left, top: narrow && narrow.top, w: narrow && narrow.width }));
    check("窄窗口(400×300)：弹窗仍有定位样式", !!narrow, narrow);
    check("窄窗口：left ≥ 0 且在视口内", !!narrow && narrow.left >= 0 && narrow.left < 400, narrow && narrow.left);
    check("窄窗口：top ≥ 0 且在视口内", !!narrow && narrow.top >= 0 && narrow.top < 300, narrow && narrow.top);
    check("窄窗口：宽度不超视口", !!narrow && narrow.width > 0 && narrow.width <= 400 - 16, narrow && narrow.width);
    check("窄窗口：右边不越界（left+width ≤ 视口宽）", !!narrow && narrow.left + narrow.width <= 400, { left: narrow && narrow.left, w: narrow && narrow.width });
    // **居中语义在窄窗口下也要成立**：left 应约等于 (视口宽 − 弹窗宽)/2。
    // 这条能区分「居中」与「贴左」（贴左时 left≈24，居中时≈56）。
    {
      const expectCenter = (400 - narrow.width) / 2;
      check("窄窗口仍居中（非贴左）", Math.abs(narrow.left - expectCenter) <= 4,
        { left: narrow.left, expectCenter, diff: Math.abs(narrow.left - expectCenter) });
    }
    // 放大回原尺寸 → 恢复正常几何
    global.window.innerWidth = savedW;
    global.window.innerHeight = savedH;
    global.__forceSeat = false;
    global.__winDispatch("resize", {});
    await wait(60);
    popNode();
    check("恢复窗口尺寸后弹窗几何正常", !!popStyleOf(popNode()), popStyleOf(popNode()));

    // 3x-6) **回退路径也要居中**（探测不到 composer seat 时）。
    //        踩过的真 bug：改回居中时只改了主路径，回退值仍是 left:24（贴左），
    //        宿主探测不到 seat 就跑到屏幕左边 → 用户实测「中间的没有看到」。
    {
      global.__forceSeat = false;
      global.__winDispatch("resize", {});
      await wait(60);
      popNode();
      const fb = popStyleOf(popNode());
      const diag = globalThis.__sl_conv_rect__ || {};
      const expectFb = (global.window.innerWidth - fb.width) / 2;
      console.log("   回退路径几何:", JSON.stringify({ left: fb.left, w: fb.width, expectFb, fallback: diag.fallback }));
      check("回退路径标记为 fallback", diag.fallback === true, diag);
      check("回退路径居中（left ≈ (视口宽−弹窗宽)/2，非贴左 24）",
        Math.abs(fb.left - expectFb) <= 6, { left: fb.left, expectFb });
    }
    st().alertPopups = [];
  }

  // 4) 三级降级之二：**隐藏 + 已授权** → 系统通知
  {
    const c3 = stubNotification("granted");
    setHidden(true);
    await globalThis.__sl_notify_test__({ ruleId: "n2", at: Date.now() + 1, code: "sh600519", name: "贵州茅台", type: "pct_up", value: 3, price: 1700 });
    await wait(30);
    check("隐藏+已授权 → 弹系统通知", c3.length >= 1, c3.length);
    check("通知标题含预警与股票名", c3.length > 0 && /预警/.test(c3[0].title) && /贵州茅台/.test(c3[0].title), c3[0]);
  }

  // 5) 三级降级之三：**隐藏 + 未授权** → document.title 加 ⚠ 前缀
  {
    stubNotification("default");
    setHidden(true);
    global.document.title = "DSH";
    await globalThis.__sl_notify_test__({ ruleId: "n3", at: Date.now() + 2, code: "sh600519", name: "贵州茅台", type: "pct_up", value: 3, price: 1700 });
    await wait(30);
    check("隐藏+未授权 → 标题闪烁兜底", /^⚠ /.test(String(global.document.title)), global.document.title);
    global.document.title = "DSH";
  }

  // 6) Notification 不可用（webview）→ 不抛异常，仍降级到标题
  {
    delete global.Notification;
    delete global.window.Notification;
    setHidden(true);
    global.document.title = "DSH";
    let threw = false;
    try {
      await globalThis.__sl_notify_test__({ ruleId: "n4", at: Date.now() + 3, code: "sh600519", name: "贵州茅台", type: "pct_up", value: 3, price: 1700 });
      await wait(30);
    } catch { threw = true; }
    check("Notification 不可用时不抛异常（降级兜底）", !threw);
    check("不可用时仍走标题闪烁", /^⚠ /.test(String(global.document.title)), global.document.title);
    global.document.title = "DSH";
  }

  // 7) 隐藏时**不断**预警流：visibilitychange 只关行情流，预警流保持
  {
    const before = global.__esOpen("/alert-stream");
    setHidden(true);
    global.__docDispatch("visibilitychange");
    await wait(20);
    check("隐藏时预警流保持连接（有意破例）", before && global.__esOpen("/alert-stream"), { before, now: global.__esOpen("/alert-stream") });
    check("隐藏时行情流确实断开了（对照，防破例扩散）", !global.__esOpen("/stream?") && !global.__esOpen("/stream"), ES_INSTANCES.filter((e) => e.url.indexOf("/stream") >= 0 && !e.url.indexOf("alert")).map((e) => ({ url: e.url.slice(-30), closed: e.closed })));
    setHidden(false);
    global.__docDispatch("visibilitychange");
    await wait(30);
    check("恢复可见后预警流仍在", global.__esOpen("/alert-stream"));
  }

  // 8) 多标签页去重：navigator.locks 抢不到时不弹
  {
    stubNotification("granted");
    setHidden(true);
    // Node 24 的 global.navigator 是只读 getter，直接赋值会抛 TypeError → 用 defineProperty
    const navDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      get: () => ({ locks: { request: (name, opts, cb) => Promise.resolve(cb(null)) } }), // 模拟"锁被别的标签页持有"
    });
    let constructed = 0;
    function Counting() { constructed++; }
    Counting.permission = "granted";
    global.Notification = Counting;
    global.window.Notification = Counting;
    await globalThis.__sl_notify_test__({ ruleId: "n5", at: Date.now() + 4, code: "sh600519", name: "贵州茅台", type: "pct_up", value: 3, price: 1700 });
    await wait(40);
    check("抢不到锁时不重复弹通知（多标签去重）", constructed === 0, constructed);
    if (navDesc) Object.defineProperty(globalThis, "navigator", navDesc);
    else delete globalThis.navigator;
  }

  // 复位
  setHidden(false);
  global.document.title = "DSH";
  stubNotification("default");
  ovNode = ov.render({}); renderTree(ovNode);
}

// ---------- 列表封顶：交易记录与预警规则都按 10 行出滚动条 ----------
// 放在最后：要往配置里塞十几行假数据，塞完不再影响任何后续用例。
//
// 喂数据的手法：persistConfig 会把 POST /config 的**回包**并入本地状态，
// 所以把回包改写成"客户端发来的配置 + 额外行"，再触发一次真实保存即可——
// 比点 11 次 UI 快得多，而且走的仍是产品自己的合并分支。
{
  // 本段在文件末尾、独立块作用域里：cfgNow 等 helper 定义在前面的块内，这里拿不到，
  // 直接用同一个来源（测试钩子暴露的 store 快照）。
  const cfgNow = () => (globalThis.__sl_test_state__ || {}).config || {};
  // 用 indexOf 而不是全等：封顶后会追加 " sl-sortable-cap"，
  // 全等匹配在"有滚动条"时反而找不到容器（正是要断言的那种情况）。
  const rowsOf = (cls) => {
    const out = [];
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (String((n.props && n.props.className) || "").indexOf(cls) >= 0) out.push(n);
      if (typeof n.type === "function") { walk(n.__rendered); return; }
      if (n.children) n.children.forEach(walk);
    })(ovNode);
    return out;
  };
  const seedAndSave = async (mutate, expect) => {
    const prevFetch = global.fetch;
    const stub = async (url, opts) => {
      if (String(url).indexOf("/dsh-stock-leek/config") >= 0 && opts && opts.method === "POST") {
        const sent = JSON.parse(opts.body || "{}").config || {};
        return { ok: true, json: async () => ({ ok: true, config: mutate(Object.assign({}, sent)), rev: 1, path: "(test)" }) };
      }
      return prevFetch(url, opts);
    };
    global.fetch = stub;
    global.window.fetch = stub;
    ovNode = ov.render({}); renderTree(ovNode);
    ovText = clickTab("设置");
    // 点刷新间隔按钮触发一次真实保存（与"老 Host 吃字段"用例同一手法）
    const btn = findNode(ovNode, (n) => n.type === "button" && /^(3|5|10)s$/.test(String((n.children && n.children[0]) || "")));
    if (btn) click(btn);
    ovNode = ov.render({}); renderTree(ovNode);
    // 轮询等**回包合并真的落地**，不要固定 sleep：
    // 固定等待会让断言读到上一轮的配置（实测"看起来慢一拍"就是这么来的）。
    if (expect) await until(expect, 4000);
    global.fetch = prevFetch;
    global.window.fetch = prevFetch;
    ovNode = ov.render({}); renderTree(ovNode);
  };
  // 本段在文件末尾的独立块作用域里，前面块内的 helper（openAlertPanelForTest 等）拿不到，
  // 这里就地重写两个"进入二级页"的交互。
  const enterAlertPanel = () => {
    clickTab("设置");
    const entry = findNode(ovNode, (n) => n.type === "button" && /🔔 预警/.test(String((n.children && n.children[0]) || "")));
    if (!entry) return false;
    click(entry);
    ovNode = ov.render({}); renderTree(ovNode);
    return true;
  };
  const enterTxnPanel = () => {
    clickTab("持仓");
    ovNode = ov.render({}); renderTree(ovNode);
    const row = posRow(ovNode);
    if (!row) return false;
    contextMenu(row);
    ovNode = ov.render({}); renderTree(ovNode);
    const mi = findMenuItem(ovNode, "交易记录");
    if (!mi) { dismissMenu(); return false; }
    click(mi);
    dismissMenu();
    ovNode = ov.render({}); renderTree(ovNode);
    return true;
  };

  // 1) 交易记录：造一只带 12 笔成交的持仓 → 应加滚动类且上限 28×10+1=281px
  {
    // 此时持仓已被前面的清仓用例清空，所以自己造一只
    await seedAndSave((c) => {
      c.positions = [{
        code: "sh600519", name: "贵州茅台", cost: 1000, qty: 100,
        txns: Array.from({ length: 12 }, (_, i) => ({
          id: "seed" + i, date: "2026-01-" + String((i % 9) + 1).padStart(2, "0"), time: "10:00",
          price: 100 + i, qty: i % 2 ? -10 : 10,
        })),
      }];
      return c;
    }, () => ((((globalThis.__sl_test_state__ || {}).config || {}).positions || [])[0] || {}).txns
      && (((globalThis.__sl_test_state__ || {}).config || {}).positions || [])[0].txns.length === 12);
    check("已造出带 12 笔成交的持仓（前置条件）",
      (((cfgNow().positions || [])[0] || {}).txns || []).length === 12,
      ((cfgNow().positions || [])[0] || {}).txns && ((cfgNow().positions || [])[0] || {}).txns.length);
    const ok = enterTxnPanel();
    check("能打开交易记录二级页（前置条件）", ok && /交易记录：/.test(textOf(ovNode).join(" ")), textOf(ovNode).join(" ").slice(0, 140));
    const list = rowsOf("sl-txnrec-list")[0];
    check("交易记录页找到列表容器", !!list);
    if (list) {
      const cls = String((list.props && list.props.className) || "");
      const capPx = parseInt(String((list.props.style && list.props.style.maxHeight) || ""), 10);
      check("交易记录超 10 笔时加滚动类", cls.indexOf("sl-sortable-cap") >= 0, cls);
      check("交易记录上限按实测行高算（28×10+1=281）", capPx === 281, capPx);
      // 上限落在列表上、不在 .sl-body 上（表头与汇总条保持可见）
      const body = findNode(ovNode, (n) => String((n.props && n.props.className) || "") === "sl-body");
      check("交易记录上限不在 .sl-body 上", !(body && body.props.style && body.props.style.maxHeight), body && body.props.style);
    }
  }

  // 2) 预警：塞 12 只不同股票 → 同样封顶（按**组**计数，不是按规则条数）
  {
    await seedAndSave((c) => {
      const codes = ["sh600519", "sz300750", "sz002594", "sh601318", "sh600036", "sz000858",
        "sh601899", "sz002415", "sh600030", "sh601166", "sz000333", "sh600276"];
      c.alerts = codes.map((cd, i) => ({ id: "cap" + i, code: cd, name: "股票" + i, type: "price_above", value: 100 + i }));
      return c;
    }, () => (((globalThis.__sl_test_state__ || {}).config || {}).alerts || []).length === 12);
    check("预警规则已塞成 12 组（前置条件）", ((cfgNow().alerts || []).length) === 12, (cfgNow().alerts || []).length);
    const ok = enterAlertPanel();
    check("预警页已打开（前置条件）", ok && /预警总开关/.test(textOf(ovNode).join(" ")), textOf(ovNode).join(" ").slice(0, 140));
    const list = rowsOf("sl-alert-list")[0];
    check("预警页找到分组列表容器", !!list);
    if (list) {
      const cls = String((list.props && list.props.className) || "");
      const capPx = parseInt(String((list.props.style && list.props.style.maxHeight) || ""), 10);
      check("预警超 10 组时加滚动类", cls.indexOf("sl-sortable-cap") >= 0, cls);
      check("预警上限按实测行高算（28×10+1=281）", capPx === 281, capPx);
    }
  }

  // 3) 边界：正好 10 组时**不该**封顶（否则会出现"能滚但没内容"的空滚动条）
  {
    await seedAndSave((c) => { c.alerts = (c.alerts || []).slice(0, 10); return c; },
      () => (((globalThis.__sl_test_state__ || {}).config || {}).alerts || []).length === 10);
    check("预警规则已减到 10 组（前置条件）", ((cfgNow().alerts || []).length) === 10, (cfgNow().alerts || []).length);
    enterAlertPanel();
    const list = rowsOf("sl-alert-list")[0];
    if (list) {
      const cls = String((list.props && list.props.className) || "");
      check("正好 10 组时不加滚动类", cls.indexOf("sl-sortable-cap") < 0, cls);
      check("正好 10 组时无 maxHeight", !(list.props.style && list.props.style.maxHeight), list.props.style);
    } else {
      check("正好 10 组时能找到列表容器", false);
    }
  }

  // 收尾：清掉塞进去的假数据，别留在配置里
  await seedAndSave((c) => { c.alerts = []; c.positions = []; return c; },
    () => {
      const cf = (globalThis.__sl_test_state__ || {}).config || {};
      return (cf.alerts || []).length === 0 && (cf.positions || []).length === 0;
    });
  check("收尾已清空预警规则与持仓", ((cfgNow().alerts || []).length) === 0 && ((cfgNow().positions || []).length) === 0,
    { alerts: (cfgNow().alerts || []).length, positions: (cfgNow().positions || []).length });
}

server.close();
// 评估循环定时器不 unref（见 index.js）→ 显式停掉，避免测试后继续打上游
__stopAlertLoopForTest();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
