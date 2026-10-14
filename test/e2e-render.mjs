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
import { useTestConfigPath } from "./config-guard.mjs";

useTestConfigPath("e2e");

const { apply: hostApply } = await import("../index.js");

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
    let cleanup;
    try { cleanup = fn(); } catch { /* ignore */ }
    curNode.__h[i] = { deps, cleanup: typeof cleanup === "function" ? cleanup : null };
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
global.document = {
  createElement: mkEl,
  head: { appendChild() {} },
  addEventListener() {}, removeEventListener() {},
  hidden: false,
  querySelector: (sel) => {
    if (process.env.LF_TEST_SEAT === "1") {
      return { getBoundingClientRect: () => ({ left: 240, top: 620, right: 1160, bottom: 760, width: 920, height: 140 }) };
    }
    return null; // 默认：找不到 composer seat → 回退视口左下角
  },
};
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
// LF_DROP_MA=1：模拟旧版 host（不认识 ma 字段，保存后回填的配置里没有它）
const patchedFetch = async (url, opts) => {
  const u = String(url);
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
  return findNode(root, (n) => n.type === "button"
    && String((n.props && n.props.className) || "").indexOf("sl-menu-item") >= 0
    && String(n.children && n.children[0]).indexOf(labelSub) >= 0);
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
await wait(1500); // 等 /config 与 /quotes 返回
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

// 回归：窗口从最大化缩小时，手动位置必须钳回视口内（否则悬浮窗留在视口外"消失"）
{
  // 1. 先拖一次，产生手动位置（前面的拖动测试最后被双击清掉了，这里重新造）
  const g = findNode(barNode, (n) => n.type === "button" && String((n.props && n.props.className) || "").indexOf("sl-gear") >= 0);
  check("找到拖动手柄 ⚙", !!g);
  if (g) {
    g.props.onPointerDown({ button: 0, clientX: 100, clientY: 800, preventDefault() {}, stopPropagation() {} });
    global.__winDispatch("pointermove", { clientX: 400, clientY: 300 }); // 拖到 x≈300, y≈300
    global.__winDispatch("pointerup", {});
  }
  let cur = JSON.parse(global.localStorage.getItem("sl.bar.pos.v1") || "null");
  check("已产生手动位置", !!cur, cur);
  const beforeX = cur ? cur.x : 0;
  const beforeY = cur ? cur.y : 0;

  // 2. 缩小窗口：1400×900 → 400×300，然后派发 resize
  global.window.innerWidth = 400;
  global.window.innerHeight = 300;
  global.__winDispatch("resize", {});
  const after = floatReg.render({});
  renderTree(after);
  const clampedStyle = rootStyleOf(after);
  const clamped = JSON.parse(global.localStorage.getItem("sl.bar.pos.v1") || "null");
  console.log("   缩小前:", beforeX, beforeY, "→ 缩小后:", JSON.stringify(clamped));
  check("缩小窗口后 x 被钳小（left ≤ innerWidth-100）", !!clamped && clamped.x <= global.window.innerWidth - 100, { beforeX, after: clamped });
  check("缩小窗口后 y 被钳小（top ≤ innerHeight-100）", !!clamped && clamped.y <= global.window.innerHeight - 100, { beforeY, after: clamped });
  check("钳制结果已落盘（下次加载不再跑偏）", global.localStorage.getItem("sl.bar.pos.v1") === JSON.stringify(clamped), global.localStorage.getItem("sl.bar.pos.v1"));
  check("渲染位置 = 钳制后位置（bar 立刻回到可见区）", clampedStyle.left === clamped.x && clampedStyle.top === clamped.y, JSON.stringify(clampedStyle).slice(0, 120));
  // 3. 恢复视口尺寸，避免影响后续用例
  global.window.innerWidth = 1400;
  global.window.innerHeight = 900;
  global.__winDispatch("resize", {});
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
await wait(1200);
ovNode = ov.render({});
renderTree(ovNode);
ovText = textOf(ovNode).join(" ");
check("详情含分时/K线切换", /分时/.test(ovText) && /日K/.test(ovText), ovText.slice(0, 240));
check("详情含指标", /今开|昨收|最高/.test(ovText), ovText.slice(0, 240));
check("详情已屏蔽「🤖 分析」入口", ovText.indexOf("分析") < 0 && !findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]).indexOf("分析") >= 0), ovText.slice(0, 240));
// 切到日K
const dayBtn = findNode(ovNode, (n) => n.type === "button" && String(n.children && n.children[0]) === "日K");
click(dayBtn);
ovNode = ov.render({});
errs = renderTree(ovNode);
check("日K 渲染无错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
await wait(1000);
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
  await wait(900); // 超过 persistConfig 的 500ms 防抖，模拟保存成功后的回填
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
await wait(1200);   // 等防抖 + fetch 完成
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
    }
  }
}

// ---------- 7. 持仓变动（右键 → 变动面板 → 记买卖；今日收益据此） ----------
clickTab("持仓");
ovNode = ov.render({}); renderTree(ovNode);
const prow = posRow(ovNode);
contextMenu(prow);
ovNode = ov.render({}); renderTree(ovNode);
const txnMi = findMenuItem(ovNode, "买卖变动") || findMenuItem(ovNode, "变动记录");
check("右键菜单含「⇅ 买卖变动」入口", !!txnMi, textOf(ovNode).join(" ").slice(0, 160));
if (txnMi) {
  click(txnMi); // setOpenCode → 展开 TxnPanel
  dismissMenu();
  ovNode = ov.render({}); renderTree(ovNode);
  await wait(200);
  ovNode = ov.render({}); renderTree(ovNode);
  const panel = textOf(ovNode).join(" ");
  check("变动面板展开（买入/卖出/记一笔）", /买入/.test(panel) && /卖出/.test(panel) && /记一笔/.test(panel), panel.slice(0, 240));
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
  check("买入后出现变动记录（买 @1300）", /买/.test(afterBuy) && /@1300\.00/.test(afterBuy), afterBuy.slice(0, 240));
  check("买入后股数 100→200（成本 1150.00 后跟现价再跟持股 200）", /1150\.00\s+[\d.]+\s+200\b/.test(afterBuy), afterBuy.slice(0, 200));
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
  check("卖出后出现两笔变动（含 卖 @1350）", /卖/.test(afterSell) && /@1350\.00/.test(afterSell), afterSell.slice(0, 300));
  check("卖出后股数 200→150（成本 1150.00 后跟现价再跟持股 150）", /1150\.00\s+[\d.]+\s+150\b/.test(afterSell), afterSell.slice(0, 200));
  errs = renderTree(ovNode);
  check("多笔变动后无渲染错误", errs.length === 0, errs[0] && (errs[0].error.stack || errs[0].error));
  // 右键菜单项现显示笔数
  contextMenu(posRow(ovNode));
  ovNode = ov.render({}); renderTree(ovNode);
  check("变动菜单显示 2 笔", !!findMenuItem(ovNode, "2 笔"), textOf(ovNode).join(" ").slice(0, 160));
  dismissMenu();
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
  // 持仓后标题应变脸（不再是默认观望态）
  const ovAfter = ovReg.render({});
  renderTree(ovAfter);
  const tAfter = titleOf(ovAfter);
  const MOODS = ["📈 观望中", "🍗 加鸡腿", " 起飞了", "🍜 关灯吃面", "🧘 天台吹风"];
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
    await wait(1800); // 等 K 线异步加载完成
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
    await wait(1500); // 等各持仓分时拉取完成
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
    // 收起/展开：状态写入配置，切换标签页后仍保持（这正是改成配置态的原因）
    const toggleBtn = () => findNode(ovNode, (n) => n.type === "button" && /^(收起|展开)$/.test(String(n.children && n.children[0])));
    let tg = toggleBtn();
    if (tg) {
      tg.props.onClick({});
      await wait(700); // 等配置落库（防抖 500ms）
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
        await wait(1400); // 重新展开需要拉分时
        ovNode = ov.render({}); renderTree(ovNode);
        check("可重新展开走势曲线", String(toggleBtn() && toggleBtn().children[0]) === "收起", String(toggleBtn() && toggleBtn().children[0]));
      }
    }
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

server.close();
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
