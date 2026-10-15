/**
 * dsh-stock-leek — 浏览器端（client.js）
 *
 * DSH 客户端插件（__ModuleLoader__ 形态）：
 *   1. conversation.composer.dock → 对话输入框下方「左下角指数栏」（上证/深证…，可配置）
 *   2. shell.overlay              → 可拖动悬浮窗：大盘 / 自选 / 持仓 / 设置 + 个股详情（分时/K线）
 *
 * 数据来自 Host 端 /dsh-stock-leek/* 路由（腾讯财经行情）。
 * 配置持久化在 Host 的 ~/.dsh/dsh-stock-leek/config.json（localStorage 作首屏缓存）。
 * 图表为自绘 SVG（分时折线 + K线蜡烛 + MA + 盈亏曲线），不依赖 CDN。
 * 配色 A 股惯例：红涨绿跌。
 */
window.__ModuleLoader__.load({
  id: "dsh-stock-leek",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = react;
    const h = react.createElement;

    // 错误边界：任一视图抛错时降级为小卡片，避免整棵 shell.overlay（悬浮窗+指数栏）被连带卸载。
    class ErrorBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { err: null };
      }
      static getDerivedStateFromError(err) {
        return { err };
      }
      componentDidCatch(err, info) {
        try { console.error("[dsh-stock-leek] view crashed:", err && err.stack ? err.stack : err, info && info.componentStack); } catch { /* ignore */ }
      }
      render() {
        if (this.state.err) {
          return h(
            "div",
            { className: "sl-root sl-theme-" + (this.props.theme || "dark") + (this.props.theme === "light" ? " sl-light" : ""), style: { padding: 10 } },
            h("div", { className: "sl-empty" }, "⚠ 视图出错：" + String((this.state.err && this.state.err.message) || this.state.err)),
            h("div", { style: { textAlign: "center", padding: "4px 0" } },
              h("button", { className: "sl-btn", onClick: () => this.setState({ err: null }) }, "重试")),
          );
        }
        return this.props.children;
      }
    }

    // ================================================================ CSS
    const CSS = `
/* ---------------- 指数栏（composer.dock / floating 拖拽） ---------------- */
.sl-bar-wrap{gap:4px;border-radius:999px}
.sl-bar-wrap.sl-bar-dragging{outline:1px dashed var(--sl-accent-border);outline-offset:2px}
.sl-gear{cursor:grab;touch-action:none}
.sl-gear.sl-gear-dragging{cursor:grabbing;color:var(--sl-accent);border-color:var(--sl-accent-border);background:var(--sl-accent-soft)}
.sl-chip-earn{gap:5px}
.sl-chip-earn .sl-chip-name{color:var(--sl-accent)}
/* 收益 hover 浮层 */
.sl-pop{width:264px;max-width:calc(100vw - 24px);background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:10px;box-shadow:var(--sl-shadow);backdrop-filter:blur(10px);padding:8px 10px;pointer-events:auto;color:var(--sl-text)}
.sl-pop-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:2px 0;font-size:11px;color:var(--sl-dim)}
.sl-pop-head b{font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--sl-text)}
.sl-pop-head b.sl-up{color:var(--sl-up)}
.sl-pop-head b.sl-down{color:var(--sl-down)}
.sl-pop-sep{height:1px;background:var(--sl-border-soft);margin:6px 0 4px}
.sl-pop-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:2px 0;font-size:11px}
.sl-pop-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sl-text)}
.sl-pop-pnl{flex:none;font-weight:600;font-variant-numeric:tabular-nums}
.sl-pop-foot{margin-top:6px;text-align:center;font-size:9px;color:var(--sl-muted)}
/* 通用悬浮提示：仿收益浮层样式，全局委托 [data-sltip] 触发，渲染在 overlay 顶层（不受面板裁切） */
.sl-tip{position:fixed;z-index:10003;max-width:min(320px,calc(100vw - 16px));background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:10px;box-shadow:var(--sl-shadow);backdrop-filter:blur(10px);padding:7px 10px;pointer-events:none;color:var(--sl-text);font-size:11px;line-height:1.55;white-space:pre-line;transform:translateX(-50%)}
.sl-root{--sl-up:#f5455c;--sl-down:#1eb980;--sl-flat:#8b93a7;--sl-warn:#e6a23c;
 --sl-bg:rgba(15,19,28,.97);--sl-bg2:rgba(255,255,255,.05);--sl-border:rgba(255,255,255,.14);--sl-border-soft:rgba(255,255,255,.07);
 --sl-text:#e5e7eb;--sl-dim:#9ca3af;--sl-muted:#6b7280;--sl-accent:#4cc2ff;--sl-accent-soft:rgba(76,194,255,.14);--sl-accent-border:rgba(76,194,255,.45);
 --sl-shadow:0 10px 40px rgba(0,0,0,.5);--sl-hover:rgba(255,255,255,.06);
 font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,'Cascadia Mono','Microsoft YaHei',monospace;color:var(--sl-text)}
.sl-root.sl-light{--sl-bg:rgba(252,253,255,.98);--sl-bg2:rgba(15,23,42,.04);--sl-border:rgba(15,23,42,.16);--sl-border-soft:rgba(15,23,42,.08);
 --sl-text:#1f2937;--sl-dim:#4b5563;--sl-muted:#8b93a7;--sl-accent:#0b78b3;--sl-accent-soft:rgba(11,120,179,.1);--sl-accent-border:rgba(11,120,179,.45);
 --sl-shadow:0 10px 36px rgba(15,23,42,.18);--sl-hover:rgba(15,23,42,.05)}
.sl-up{color:var(--sl-up)}.sl-down{color:var(--sl-down)}.sl-flat{color:var(--sl-flat)}
/* ---------------- 指数栏（composer.dock，对话左下角） ---------------- */
.sl-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0;user-select:none;-webkit-user-select:none;pointer-events:auto}
.sl-bar.sl-align-center{justify-content:center;width:100%}
.sl-bar.sl-align-right{justify-content:flex-end;width:100%}
.sl-chip{display:inline-flex;align-items:baseline;gap:6px;padding:2px 9px;border-radius:999px;background:var(--sl-bg2);border:1px solid var(--sl-border-soft);cursor:pointer;white-space:nowrap;line-height:1.7;transition:border-color .15s ease,background-color .15s ease}
.sl-chip:hover{border-color:var(--sl-accent-border);background:var(--sl-accent-soft)}
.sl-chip-name{color:var(--sl-dim);font-weight:600}
.sl-chip-price{font-weight:700}
.sl-chip-pct{font-weight:700;font-size:11px}
.sl-chip.sl-flash-up{animation:slFlashUp 1.1s ease-out}
.sl-chip.sl-flash-down{animation:slFlashDown 1.1s ease-out}
@keyframes slFlashUp{0%,55%{background:rgba(245,69,92,.28)}100%{background:var(--sl-bg2)}}
@keyframes slFlashDown{0%,55%{background:rgba(30,185,128,.28)}100%{background:var(--sl-bg2)}}
.sl-bar-btn{background:transparent;border:1px solid transparent;color:var(--sl-muted);cursor:pointer;font:inherit;font-size:12px;padding:2px 6px;border-radius:6px;line-height:1.5}
.sl-bar-btn:hover{color:var(--sl-text);border-color:var(--sl-border-soft);background:var(--sl-hover)}
.sl-bar-dot{width:6px;height:6px;border-radius:50%;display:inline-block;background:var(--sl-muted)}
.sl-bar-dot.sl-open{background:var(--sl-up);box-shadow:0 0 6px var(--sl-up)}
/* ---------------- 悬浮窗 ---------------- */
.sl-panel{position:fixed;z-index:9990;width:430px;max-height:76vh;display:flex;flex-direction:column;border-radius:12px;overflow:visible;background:var(--sl-bg);border:1px solid var(--sl-border);box-shadow:var(--sl-shadow);backdrop-filter:blur(10px)}
.sl-head{display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--sl-border-soft);cursor:grab;user-select:none;-webkit-user-select:none;flex:none}
.sl-head:active{cursor:grabbing}
.sl-title{font-weight:700;color:var(--sl-accent);white-space:nowrap}
.sl-tabs{display:flex;gap:3px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.sl-tabs::-webkit-scrollbar{display:none}
.sl-tab{flex:none;padding:2px 10px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--sl-muted);cursor:pointer;font:inherit;white-space:nowrap}
.sl-tab:hover{color:var(--sl-text)}
.sl-tab-on{background:var(--sl-accent-soft);color:var(--sl-accent);border-color:var(--sl-accent-border)}
.sl-fresh{flex:none;color:var(--sl-muted);font-size:10px;white-space:nowrap;font-variant-numeric:tabular-nums;cursor:default}
.sl-fresh-stale{color:var(--sl-warn)}
.sl-icon{background:transparent;border:none;color:var(--sl-muted);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px;font-family:inherit;line-height:1.3}
.sl-icon:hover{color:var(--sl-text);background:var(--sl-hover)}
.sl-body{overflow-y:auto;padding:4px 6px 8px;flex:1 1 auto;min-height:120px}
.sl-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer;position:relative}
.sl-row::before{content:"";position:absolute;inset:0;background:var(--row-flash,transparent);border-radius:inherit;pointer-events:none;opacity:0}
.sl-row.sl-row-flash::before{animation:slRowFlash 1.1s ease-out forwards}
@keyframes slRowFlash{0%,55%{opacity:1}100%{opacity:0}}
.sl-row:hover{background:var(--sl-hover)}
.sl-row-name{display:flex;flex-direction:column;flex:1 1 auto;min-width:70px}
.sl-row-nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sl-row-code{color:var(--sl-muted);font-size:10px}
.sl-mkt{display:inline-block;font-size:9px;border:1px solid var(--sl-border-soft);border-radius:4px;padding:0 3px;color:var(--sl-dim);margin-right:4px;vertical-align:1px}
.sl-price{width:72px;text-align:right;font-weight:700;flex:none}
.sl-pct{width:58px;text-align:right;flex:none;font-weight:600}
.sl-amt{width:76px;text-align:right;flex:none;color:var(--sl-dim);font-size:11px}
.sl-speed{width:52px;text-align:right;flex:none;font-weight:600;font-size:11px}
.sl-turn{width:46px;text-align:right;flex:none;color:var(--sl-dim);font-size:11px}
/* 自选列多：压缩数值列宽，保证名称列不被挤没。
   表头必须用 .sl-watchlist .sl-hrow .sl-h-* (0,3,0) 才能压过下方 .sl-hrow .sl-h-* 基础规则，
   否则表头与行列宽不一致会整体错位。 */
.sl-watchlist .sl-price{width:60px}
.sl-watchlist .sl-pct{width:52px}
.sl-watchlist .sl-amt{width:62px}
.sl-watchlist .sl-hrow .sl-h-price{width:60px}
.sl-watchlist .sl-hrow .sl-h-pct{width:52px}
.sl-watchlist .sl-hrow .sl-h-amt{width:62px}
.sl-h-speed{width:52px;text-align:right;flex:none}
.sl-x{background:transparent;border:none;color:var(--sl-muted);cursor:pointer;font-size:11px;padding:0 3px;border-radius:4px;flex:none}
.sl-x:hover{color:#ff5555;background:var(--sl-hover)}
.sl-empty{padding:16px 10px;text-align:center;color:var(--sl-muted)}
.sl-foot{display:flex;justify-content:space-between;gap:8px;padding:5px 10px;border-top:1px solid var(--sl-border-soft);color:var(--sl-muted);font-size:10px;flex:none}
.sl-sec{display:flex;align-items:center;justify-content:space-between;padding:6px 6px 2px;color:var(--sl-dim);font-weight:700}
.sl-addbar{display:flex;gap:6px;padding:6px;border-top:1px solid var(--sl-border-soft);flex:none;position:relative}
.sl-input{flex:1;min-width:0;background:var(--sl-bg2);border:1px solid var(--sl-accent-border);color:var(--sl-text);border-radius:6px;padding:4px 8px;font:inherit;outline:none}
.sl-input:focus{border-color:var(--sl-accent)}
.sl-btn{background:var(--sl-accent-soft);border:1px solid var(--sl-accent-border);color:var(--sl-accent);border-radius:6px;padding:3px 10px;cursor:pointer;font:inherit;white-space:nowrap}
.sl-btn:hover{filter:brightness(1.15)}
.sl-btn-ghost{background:transparent;border:1px dashed var(--sl-border);color:var(--sl-dim)}
.sl-sugs{position:fixed;z-index:10001;max-height:min(240px,52vh);overflow-y:auto;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:8px;box-shadow:var(--sl-shadow);pointer-events:auto}
.sl-sug{display:flex;gap:8px;align-items:center;width:100%;background:transparent;border:none;color:var(--sl-text);padding:4px 10px;cursor:pointer;font:inherit;text-align:left}
.sl-sug:hover{background:var(--sl-hover)}
.sl-sug-code{color:var(--sl-muted);font-size:10px;width:64px;flex:none}
.sl-sug-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl-sug-tag{font-size:9px;border:1px solid var(--sl-border-soft);border-radius:4px;padding:0 4px;color:var(--sl-dim)}
/* 拖动排序 */
.sl-sortable{position:relative}
/* 行数超过阈值时列表内部滚动：表头与搜索框因此始终可见，不必滚到最底才找得到。
   阈值不是 CSS 常量而是实测行高（各列表行高不同），见 useListCap。 */
.sl-sortable-cap{overflow-y:auto;overscroll-behavior:contain}
.sl-sortable-cap::-webkit-scrollbar{width:8px}
.sl-sortable-cap::-webkit-scrollbar-thumb{background:var(--sl-border);border-radius:4px;border:2px solid transparent;background-clip:content-box}
.sl-sortable-cap::-webkit-scrollbar-thumb:hover{background:var(--sl-muted);background-clip:content-box}
.sl-sortable-cap::-webkit-scrollbar-track{background:transparent}
.sl-grip{flex:none;width:14px;text-align:center;color:var(--sl-muted);cursor:grab;user-select:none;-webkit-user-select:none;font-size:12px;line-height:1.4;opacity:0;touch-action:none;transition:opacity .12s ease,color .12s ease}
.sl-row:hover .sl-grip,.sl-pos:hover .sl-grip,.sl-grip:hover{opacity:.75}
.sl-grip:hover{opacity:1;color:var(--sl-accent)}
.sl-grip:active{cursor:grabbing;opacity:1;color:var(--sl-accent)}
.sl-sortable-row{touch-action:none}
.sl-row-dragging{opacity:.35;background:var(--sl-accent-soft)!important}
.sl-sortable.sl-sorting{cursor:grabbing;user-select:none;-webkit-user-select:none}
.sl-sortable.sl-sorting .sl-grip{opacity:1}
.sl-dropline{height:0;border-top:2px solid var(--sl-accent);margin:0 6px;border-radius:2px;box-shadow:0 0 6px var(--sl-accent-border);pointer-events:none}
/* 列表通用润色：行过渡 + 细分隔 + 数字对齐 */
.sl-row,.sl-pos{transition:background-color .12s ease}
.sl-sortable > .sl-row + .sl-row,.sl-sortable > .sl-pos + .sl-pos{box-shadow:inset 0 1px 0 var(--sl-border-soft)}
.sl-sortable > .sl-row,.sl-sortable > .sl-pos{font-variant-numeric:tabular-nums}
.sl-check{width:20px;height:20px;line-height:18px;text-align:center;flex:none;border:1px solid var(--sl-border-soft);border-radius:6px;background:transparent;color:var(--sl-muted);cursor:pointer;font:inherit;font-size:11px;font-weight:700;padding:0;transition:color .12s ease,border-color .12s ease,background-color .12s ease}
.sl-check:hover{color:var(--sl-accent);border-color:var(--sl-accent-border)}
.sl-check-on{color:var(--sl-accent);border-color:var(--sl-accent-border);background:var(--sl-accent-soft)}
.sl-body::-webkit-scrollbar,.sl-sugs::-webkit-scrollbar,.sl-txn-list::-webkit-scrollbar{width:8px;height:8px}
.sl-body::-webkit-scrollbar-thumb,.sl-sugs::-webkit-scrollbar-thumb,.sl-txn-list::-webkit-scrollbar-thumb{background:var(--sl-border);border-radius:4px;border:2px solid transparent;background-clip:content-box}
.sl-body::-webkit-scrollbar-thumb:hover,.sl-sugs::-webkit-scrollbar-thumb:hover{background:var(--sl-muted);background-clip:content-box}
.sl-body::-webkit-scrollbar-track{background:transparent}
/* 持仓 */
.sl-pos{display:grid;grid-template-columns:14px 1fr 60px 44px 64px 64px 64px;gap:4px;align-items:center;padding:4px 6px;border-radius:8px}
.sl-pos:hover{background:var(--sl-hover)}
.sl-pos-has-txn{background:var(--sl-bg2)}
.sl-pos-num{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 双行单元格：上主值(sl-l1) / 下次值(sl-l2)（成本/现价、市值/涨幅、盈亏、今日） */
.sl-pos2{display:flex;flex-direction:column;align-items:flex-end;line-height:1.28;font-variant-numeric:tabular-nums;overflow:hidden;min-width:0}
.sl-pos2 > span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.sl-pos2 .sl-l1{font-weight:700;font-size:11px;color:var(--sl-text)}
.sl-pos2 .sl-l2{font-size:10px;color:var(--sl-muted)}
.sl-pos2 .sl-l1.sl-up,.sl-pos2 .sl-l2.sl-up{color:var(--sl-up)}
.sl-pos2 .sl-l1.sl-down,.sl-pos2 .sl-l2.sl-down{color:var(--sl-down)}
.sl-pos2 .sl-l1.sl-flat,.sl-pos2 .sl-l2.sl-flat{color:var(--sl-flat)}
.sl-mini{width:100%;background:var(--sl-bg2);border:1px solid var(--sl-border-soft);color:var(--sl-text);border-radius:5px;padding:1px 3px;font:inherit;font-size:11px;text-align:right;outline:none}
.sl-mini:focus{border-color:var(--sl-accent)}
.sl-headrow{display:grid;grid-template-columns:14px 1fr 60px 44px 64px 64px 64px;gap:4px;padding:2px 6px;color:var(--sl-muted);font-size:10px}
.sl-headrow span:not(:nth-child(2)){text-align:right}
.sl-headrow span:nth-child(2){text-align:left}
.sl-txn-btn{background:transparent;border:1px solid var(--sl-border-soft);color:var(--sl-muted);border-radius:5px;cursor:pointer;font:inherit;font-size:10px;line-height:1;padding:2px 0;text-align:center;width:100%}
.sl-txn-btn:hover{color:var(--sl-accent);border-color:var(--sl-accent-border)}
.sl-txn-on{color:var(--sl-accent);border-color:var(--sl-accent-border);background:var(--sl-accent-soft)}
.sl-txn-open{outline:1px solid var(--sl-accent-border)}
.sl-txn-panel{margin:0 6px 6px;padding:6px 8px;border:1px solid var(--sl-border-soft);border-top:none;border-radius:0 0 8px 8px;background:var(--sl-bg2);display:flex;flex-direction:column;gap:6px}
.sl-txn-empty{color:var(--sl-muted);font-size:10px;line-height:1.6}
.sl-txn-list{display:flex;flex-direction:column;gap:2px;max-height:150px;overflow-y:auto}
.sl-txn-row{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--sl-dim);padding:1px 2px;border-radius:4px}
.sl-txn-row:hover{background:var(--sl-hover)}
.sl-txn-side{width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;font-weight:700;flex:none;border:1px solid currentColor}
.sl-txn-date{width:74px;flex:none;color:var(--sl-muted)}
.sl-txn-num{width:64px;text-align:right;flex:none;font-variant-numeric:tabular-nums}
.sl-txn-amt{flex:1;text-align:right;color:var(--sl-dim);font-variant-numeric:tabular-nums}
.sl-txn-today{color:var(--sl-accent);border:1px solid var(--sl-accent-border);border-radius:4px;padding:0 3px;font-size:9px;flex:none}
.sl-txn-form{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.sl-txn-seg button{padding:2px 8px;font-size:10px}
.sl-txn-price{width:62px;flex:none}
.sl-txn-qty{width:58px;flex:none}
.sl-txn-date-input{width:118px;flex:none;color-scheme:dark}
.sl-root.sl-light .sl-txn-date-input{color-scheme:light}
.sl-txn-add{font-size:10px;padding:2px 8px;flex:none}
.sl-hrow{display:flex;gap:8px;align-items:center;padding:2px 6px;color:var(--sl-muted);font-size:10px}
.sl-hrow .sl-h-name{flex:1 1 auto;min-width:70px}
.sl-hrow .sl-h-grip{width:14px;flex:none}
.sl-hrow .sl-h-check{width:20px;text-align:center;flex:none}
.sl-hrow .sl-h-price{width:72px;text-align:right;flex:none}
.sl-hrow .sl-h-pct{width:58px;text-align:right;flex:none}
.sl-hrow .sl-h-amt{width:76px;text-align:right;flex:none}
.sl-hrow .sl-h-turn{width:46px;text-align:right;flex:none}
.sl-hrow .sl-h-ops{flex:none;width:14px;text-align:right}
.sl-total{display:flex;justify-content:space-between;padding:6px 8px;margin:4px 2px;border-radius:8px;background:var(--sl-bg2);border:1px solid var(--sl-border-soft);font-weight:700}
/* 设置 */
.sl-set{display:flex;flex-direction:column;gap:8px;padding:8px}
.sl-setrow{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.sl-warn{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;background:rgba(245,109,92,.12);border:1px solid rgba(245,109,92,.4);color:#f5455c;font-size:11px;line-height:1.5;word-break:break-all}
.sl-setlabel{color:var(--sl-dim)}
.sl-seg{display:inline-flex;border:1px solid var(--sl-border);border-radius:7px;overflow:hidden}
.sl-seg button{background:transparent;border:none;color:var(--sl-dim);padding:2px 10px;cursor:pointer;font:inherit}
.sl-seg button.on{background:var(--sl-accent-soft);color:var(--sl-accent)}
.sl-color{width:34px;height:22px;border:1px solid var(--sl-border);border-radius:5px;background:transparent;cursor:pointer;padding:0}
.sl-note{color:var(--sl-muted);font-size:10px;line-height:1.6;word-break:break-all}
/* 详情 */
.sl-dhead{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-bottom:1px solid var(--sl-border-soft);flex:none}
.sl-cost-badge{font-size:10px;padding:1px 5px;border-radius:4px;border:1px solid currentColor;opacity:.9;font-variant-numeric:tabular-nums}
.sl-pnlcurve{padding:4px 10px 2px}
.sl-pnlcurve-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:1px}
.sl-mini-btn{background:var(--sl-bg2);color:var(--sl-dim);border:1px solid var(--sl-border);border-radius:4px;font-size:10px;line-height:15px;padding:0 6px;cursor:pointer}
.sl-mini-btn:hover{color:var(--sl-text);border-color:var(--sl-border-soft)}
.sl-dtop{display:flex;align-items:center;gap:8px}
.sl-dname{font-weight:700;font-size:13px}
.sl-dprice{font-weight:700;font-size:16px;font-variant-numeric:tabular-nums}
.sl-back{background:transparent;border:1px solid var(--sl-border);color:var(--sl-muted);border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit}
.sl-back:hover{color:var(--sl-text);border-color:var(--sl-accent-border)}
.sl-stats{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--sl-dim);font-size:11px}
.sl-stats b{color:var(--sl-text);font-weight:600}
.sl-chartbox{padding:2px 6px}
.sl-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:10000;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:8px;padding:6px 14px;box-shadow:var(--sl-shadow);pointer-events:none;white-space:nowrap;color:var(--sl-text)}
/* 右键菜单 */
.sl-menu{position:fixed;z-index:10001;min-width:168px;max-width:240px;padding:4px;display:flex;flex-direction:column;gap:1px;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:8px;box-shadow:var(--sl-shadow);pointer-events:auto}
.sl-menu-item{background:transparent;border:none;color:var(--sl-text);padding:5px 10px;border-radius:6px;cursor:pointer;font:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sl-menu-item:hover{background:var(--sl-hover)}
.sl-menu-danger{color:#ff5570}
.sl-menu-danger:hover{background:rgba(255,85,112,.12)}
.sl-menu-sep{height:1px;background:var(--sl-border-soft);margin:3px 6px}
.sl-menu-hint{padding:2px 10px 4px;color:var(--sl-muted);font-size:10px;white-space:nowrap}
/* 行内指示/只读文本 */
.sl-ind{width:18px;text-align:center;flex:none;font-weight:700;font-size:11px;pointer-events:none}
.sl-ind-on{color:var(--sl-accent)}
.sl-ind-off{color:var(--sl-muted)}
.sl-pos-txt{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
    const styleTag = document.createElement("style");
    styleTag.textContent = CSS;
    document.head.appendChild(styleTag);

    // ================================================================ 常量与工具
    const BASE = "/dsh-stock-leek";
    const LS_CONFIG = "sl.config.v1";
    const LS_POS = "sl.overlay.pos.v1";
    const LS_THEME = "sl.theme.v1";
    /** K 线可选均线周期（顺序即显示/存储顺序） */
    const MA_ALL = [5, 10, 20, 60];
    const MA_DEF = [5, 10, 20];
    const LS_SIZE = "sl.overlay.size.v1";
    const LS_PLACEMENT = "sl.bar.placement.v1"; // dock | floating（纯 UI 偏好，存本地，不依赖 host）
    const LS_BAR_POS = "sl.bar.pos.v1"; // 悬浮指数栏手动位置 {x,y}（视口左上角坐标）；空=自动锚定

    /**
     * 旧版本用 `lf.` 前缀存这些本地偏好（lf = 早期插件名首字母）。
     * 改名后一次性把旧键的值搬到新键，避免用户的主题/窗口位置被重置。
     * 只在新键不存在且旧键存在时搬，搬完删旧键 —— 幂等，不覆盖用户后续的修改。
     */
    (function migrateLocalStorageKeys() {
      // 注意：浏览器里没有 process，这里必须用 globalThis，否则会抛 ReferenceError。
      // 该开关只给测试用：置 1 可跳过搬迁，用来验证「搬迁逻辑确实在工作」。
      if (globalThis.__SL_NO_LS_MIGRATE__ === true) return;
      const PAIRS = [
        ["lf.config.v1", LS_CONFIG], ["lf.overlay.pos.v1", LS_POS], ["lf.theme.v1", LS_THEME],
        ["lf.overlay.size.v1", LS_SIZE], ["lf.bar.placement.v1", LS_PLACEMENT], ["lf.bar.pos.v1", LS_BAR_POS],
      ];
      try {
        for (const [oldKey, newKey] of PAIRS) {
          const old = localStorage.getItem(oldKey);
          if (old === null) continue;
          if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
          localStorage.removeItem(oldKey);
        }
      } catch {
        /* 隐私模式等禁用了 localStorage：忽略，偏好丢失不影响功能 */
      }
    })();

    function clamp(v, a, b) {
      return Math.min(b, Math.max(a, v));
    }
    // lib/shared.js 的内联副本：client.js 无法 import 共享模块（见 docs/architecture.md）。
    // 任何一侧单独改动都会被 test/shared-drift.mjs 对拍出来。
    function curveRefreshTick(updatedAt, pollMs) {
      const t = Number(updatedAt);
      if (!Number.isFinite(t) || t <= 0) return 0;
      const p = Number(pollMs);
      const win = Number.isFinite(p) && p >= 1000 ? p : 5000;
      return Math.floor(t / win);
    }
    function fmtPrice(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return "--";
      if (n >= 10000) return n.toFixed(1);
      return n >= 100 ? n.toFixed(2) : n.toFixed(3);
    }
    function fmtPct(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
    }
    /** 涨速/换手等纯百分比数值（无正号，保留 2 位 + %）；null/NaN → — */
    function fmtTurn(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "—";
      return n.toFixed(2) + "%";
    }
    function fmtMoney(v, code) {
      // A股接口成交额单位=万元，港/美=元
      let n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "-";
      if (/^(sh|sz|bj)/.test(code || "")) n = n * 1e4;
      if (n >= 1e12) return (n / 1e12).toFixed(2) + "万亿";
      if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
      if (n >= 1e4) return (n / 1e4).toFixed(0) + "万";
      return n.toFixed(0);
    }
    function fmtQty(v, code) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "-";
      const unit = /^(sh|sz|bj)/.test(code || "") ? "手" : "股";
      if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿" + unit;
      if (n >= 1e4) return (n / 1e4).toFixed(1) + "万" + unit;
      return n.toFixed(0) + unit;
    }
    function fmtTime(t) {
      const s = String(t || "");
      const m = s.match(/(\d{2}):(\d{2}):(\d{2})/);
      if (m) return m[1] + ":" + m[2];
      if (/^\d{14}$/.test(s)) return s.slice(8, 10) + ":" + s.slice(10, 12);
      return s;
    }
    function displayCode(code) {
      return String(code || "")
        .replace(/^(sh|sz|bj|gb_)/i, "")
        .replace(/^hk(?=[0-9])/, "")
        .replace(/^us/i, "");
    }
    function marketLabel(code) {
      const c = String(code || "");
      if (/^sh/i.test(c)) return "沪";
      if (/^sz/i.test(c)) return "深";
      if (/^bj/i.test(c)) return "北";
      if (/^hk/i.test(c)) return "港";
      if (/^us|^gb_/i.test(c)) return "美";
      return "";
    }
    /** 指数简称：上证指数→上证、深证成指→深证…（仅用于左下角指数栏显示，tooltip/管理页保留全称） */
    const INDEX_SHORT = {
      上证指数: "上证", 深证成指: "深证", 创业板指: "创业板", 恒生指数: "恒指",
      纳斯达克: "纳指", 标普500: "标普", 道琼斯: "道指",
    };
    function shortIndexName(name, code) {
      const n = String(name || "").trim();
      if (INDEX_SHORT[n]) return INDEX_SHORT[n];
      // 兜底：去掉结尾「指数」（恒生指数→恒生、国企指数→国企），但保留「XX指」类
      if (n.length > 3 && /指数$/.test(n)) return n.replace(/指数$/, "");
      return n || displayCode(code);
    }
    /** 该市场当前是否交易时段（本地近似判断，用于状态点） */
    function isMarketOpen(code, now) {
      now = now || new Date();
      const c = String(code || "").toLowerCase();
      const wd = now.getDay();
      if (wd === 0 || wd === 6) return false;
      const mins = (tz) => {
        try {
          const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
          const [hh, mm] = s.split(":").map(Number);
          return hh * 60 + mm;
        } catch {
          return now.getHours() * 60 + now.getMinutes();
        }
      };
      if (/^(sh|sz|bj)/.test(c)) {
        const t = mins("Asia/Shanghai");
        return (t >= 570 && t <= 690) || (t >= 780 && t <= 900); // 9:30-11:30 13:00-15:00
      }
      if (/^hk/.test(c)) {
        const t = mins("Asia/Hong_Kong");
        return (t >= 570 && t <= 720) || (t >= 780 && t <= 960);
      }
      if (/^us|^gb_/.test(c)) {
        const t = mins("America/New_York");
        return t >= 570 && t <= 960;
      }
      return false;
    }

    async function api(path, params) {
      const qs = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      }
      const q = qs.toString();
      const res = await fetch(BASE + path + (q ? "?" + q : ""), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }
    async function apiPost(path, body) {
      const res = await fetch(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    // ================================================================ store（配置 + 行情 + 轮询，dock 与悬浮窗共享）
    const listeners = new Set();
    let state = {
      config: null, // {indices, barIndices, watchlist, positions, pollMs, riseColor, fallColor, barStyle, barAlign, barVisible}
      quotes: {}, // code -> quote row
      updatedAt: 0,
      error: null,
      open: false, // 悬浮窗
      tab: "market",
      detail: null, // {code, name}
      toast: null,
      configWarning: null, // 配置损坏告警 {text, id}（设置页常驻条，直到关闭或保存成功）
      live: false, // 是否已建立 SSE 实时通道（false = 回落轮询）
      menu: null, // 右键菜单 {x, y, items, header, id}
      editPos: null, // 持仓编辑对话框 {code, name, cost, qty}
      tip: null, // 通用悬浮提示 {x, y, text}（全局委托 [data-sltip]）
      sug: null, // 搜索下拉（提升到 overlay 根层渲染）{rect, rows, busy, empty, onPick}
      theme: "dark",
      barPlacement: "floating", // dock | floating（本地偏好，默认悬浮：新会话页也能显示）
      barPos: null, // 悬浮栏手动位置 {x,y}；null=自动锚定（初始化时从 localStorage 读）
    };
    function setState(patch) {
      state = Object.assign({}, state, patch);
      // 测试钩子：暴露当前 store，供 e2e 读取真实配置（如 pollMs）而非猜测。
      // 用 globalThis 而非 export —— 这里是浏览器工厂，没有模块出口。
      globalThis.__sl_test_state__ = state;
      for (const l of listeners) l();
    }
    function subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    }
    function useStore() {
      return useSyncExternalStore(subscribe, () => state, () => state);
    }
    function toast(text, color) {
      setState({ toast: { text, color: color || null, id: Date.now() } });
      setTimeout(() => {
        if (state.toast && state.toast.text === text) setState({ toast: null });
      }, 2600);
    }
    /**
     * 配置损坏告警：比 toast 更持久（配置类问题不该 2.6 秒就消失），
     * 存进 state.configWarning，由设置页顶部常驻条展示，直到用户保存配置或手动关闭。
     */
    function configWarning(text) {
      setState({ configWarning: { text: String(text || ""), id: Date.now() } });
    }
    function dismissConfigWarning() {
      setState({ configWarning: null });
    }

    /** 指数栏放置方式（本地偏好）：floating 悬浮锚定（新会话页也显示）/ dock 嵌入 composer.dock */
    function setBarPlacement(v) {
      const next = v === "dock" ? "dock" : "floating";
      setState({ barPlacement: next });
      try { localStorage.setItem(LS_PLACEMENT, next); } catch { /* ignore */ }
    }

    /** 打开右键菜单（items=[{label,danger,onClick}|{sep:true}]，header 为小字标题） */
    function openMenu(e, items, header) {
      e.preventDefault();
      e.stopPropagation();
      setState({ menu: { x: e.clientX, y: e.clientY, items, header: header || null, id: Date.now() } });
    }
    function closeMenu() {
      if (state.menu) setState({ menu: null });
    }
    /** 置顶：把 cfg[listKey] 中该 code 的项移到第一位 */
    function pinTop(listKey, code) {
      updateConfig((cfg) => {
        const arr = cfg[listKey];
        if (!Array.isArray(arr)) return null;
        const i = arr.findIndex((x) => x.code === code);
        if (i <= 0) return null; // 已在首位或不存在
        const [item] = arr.splice(i, 1);
        arr.unshift(item);
        return cfg;
      });
    }
    /** 打开持仓编辑对话框（成本/股数） */
    function openEditPos(p) {
      closeMenu();
      setState({ editPos: { code: p.code, name: p.name || displayCode(p.code), cost: String(p.cost || ""), qty: String(p.qty || "") } });
    }

    /** 悬浮栏位置：{x,y}=手动；null=回到自动锚定。persist=false 仅更新内存（拖动中高频），抬起时再落盘 */
    function setBarPos(pos, persist) {
      // 防御：坐标 NaN（如测量失败）会让 JSON 落盘成 null，位置信息无声丢失 → 拒绝写入
      if (pos && (!Number.isFinite(pos.x) || !Number.isFinite(pos.y))) {
        setState({ barPos: null });
        return;
      }
      setState({ barPos: pos });
      if (persist === false) return;
      try {
        if (pos) localStorage.setItem(LS_BAR_POS, JSON.stringify(pos));
        else localStorage.removeItem(LS_BAR_POS);
      } catch { /* ignore */ }
    }

    /**
 * 多标签页配置同步。
 *
 * 问题：每个标签页各持一份内存副本，各自 POST，最后写的赢 —— 先写页面的改动无声丢失。
 * 方案：写入成功后用 BroadcastChannel 广播最新配置，其他标签页立即采用（不再各写各的）。
 * 降级：环境不支持 BroadcastChannel 时靠 Host 的 __rev + conflict 字段兜底告警。
 */
const CFG_CHANNEL = "dsh-stock-leek.config";
    const TAB_ID = Math.random().toString(36).slice(2, 10);
    let cfgChannel = null;
    try {
      if (typeof BroadcastChannel === "function") {
        cfgChannel = new BroadcastChannel(CFG_CHANNEL);
        cfgChannel.onmessage = (ev) => {
          const msg = ev && ev.data;
          // 忽略自己发的
          if (!msg || msg.tabId === TAB_ID || msg.type !== "config") return;
          const incoming = msg.config;
          if (!incoming) return;
          // 只在没有本地未保存改动时采纳（有则保留本地，稍后写入时由 Host 报 conflict）
          if (saveTimer !== null) return;
          if (JSON.stringify(incoming) === JSON.stringify(state.config)) return;
          setState({ config: incoming });
          try { localStorage.setItem(LS_CONFIG, JSON.stringify(incoming)); } catch { /* ignore */ }
          schedulePoll();
        };
      }
    } catch {
      cfgChannel = null;
    }
    function broadcastConfig(cfg) {
      try {
        if (cfgChannel) cfgChannel.postMessage({ type: "config", tabId: TAB_ID, config: cfg });
      } catch {
        /* ignore */
      }
    }

    let saveTimer = null;
    /**
     * 配置落库的防抖延迟（毫秒）。
     *
     * 存在的意义是把连续多次改动（比如拖动排序）合并成一次 POST。
     * 代价是**每次改配置后都有 500ms 内数据不一致的窗口**：测试里必须
     * 「等落库」再断言，于是几十条用例各睡 700ms，整个套件要 25 秒。
     *
     * 因此把延迟抽出来，并允许测试用 globalThis.__SL_SAVE_DEBOUNCE__ 覆盖成 0。
     * 注意不能用 process.env——浏览器里没有 process（见 docs/development.md）。
     */
    function saveDebounceMs() {
      try {
        const v = Number(globalThis.__SL_SAVE_DEBOUNCE__);
        if (Number.isFinite(v) && v >= 0) return v;
      } catch { /* ignore */ }
      return 500;
    }

    function persistConfig(cfg) {
      try {
        localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
      } catch { /* ignore */ }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const r = await apiPost("/config", { config: cfg });
          if (r && r.ok && r.config && state.config === cfg) {
            // host 清洗后的配置回填（保持两端一致），不触发再次保存
            // 兼容旧版 host：不认识的可选字段（如 ma）会被丢弃，回填时保留本地值，避免 UI 弹回默认
            const merged = Object.assign({}, r.config);
            if (!Array.isArray(merged.ma) && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
            state = Object.assign({}, state, { config: merged });
            // 保存成功即视为配置已恢复，撤下损坏告警
            if (state.configWarning) state.configWarning = null;
            for (const l of listeners) l();
            // 广播给其它标签页，避免它们的旧副本再写回来覆盖
            broadcastConfig(merged);
            if (r.conflict) {
              // 落盘期间别的标签页改过配置：如实告知，不假装无事发生
              configWarning("检测到其他标签页也修改了配置，本次保存已覆盖对方改动。若两边都改了，请核对自选/持仓后重新确认。");
            }
          }
        } catch {
          toast("配置保存到 Host 失败（已存本地缓存）", "#ff5555");
        }
      }, saveDebounceMs());
    }

    function updateConfig(mutator) {
      if (!state.config) return;
      const next = mutator(JSON.parse(JSON.stringify(state.config)));
      if (!next) return;
      setState({ config: next });
      syncStreamCodes(); // 自选/持仓变了 → 告知 Host 推送集合
      schedulePoll();
      persistConfig(next);
    }

    function allCodes(cfg) {
      if (!cfg) return [];
      const set = new Set();
      for (const x of cfg.indices) set.add(x.code);
      for (const x of cfg.watchlist) set.add(x.code);
      for (const x of cfg.positions) set.add(x.code);
      return [...set];
    }

    async function refreshQuotes() {
      const cfg = state.config;
      if (!cfg) return;
      const codes = allCodes(cfg);
      if (codes.length === 0) {
        setState({ quotes: {}, error: null, updatedAt: Date.now() });
        return;
      }
      try {
        const r = await api("/quotes", { codes: codes.join(",") });
        applyQuotes(r.rows, r.updatedAt, r.error || null);
      } catch (e) {
        setState({ error: String((e && e.message) || e) });
      }
    }

    /**
     * 行情通道：优先 SSE（多标签页共用 Host 一次拉取），失败自动回落轮询。
     *
     * - SSE 断开会 onerror → 关流并恢复轮询；恢复成功后可再次尝试（保守：本次会话不再重试，避免抖动）
     * - 页面隐藏时断开，恢复可见时重连（与轮询的暂停策略一致）
     */
    let es = null;
    let sseTried = false;
    let sseCodesKey = ""; // 当前订阅集合的签名（变化时需重连）
    function applyQuotes(rows, updatedAt, error) {
      const quotes = Object.assign({}, state.quotes);
      for (const row of rows || []) quotes[row.code] = row;
      setState({ quotes, updatedAt: updatedAt || Date.now(), error: error === undefined ? state.error : error });
      // 行情日期变了才可能跨过"下一个交易日"，这里做一次清理。
      // 每轮都调也没关系：判定是纯计算，没得删时立刻返回，不产生任何写入。
      purgeStaleClosedPositions();
    }
    /**
     * 移除「上一交易日已清仓」的持仓。
     *
     * 当日清仓的**保留**（用户还要看今天赚没赚），跨到下一个交易日才删。
     * 刻意放在行情更新后触发：只有行情日期前进才可能判定过期，
     * 周末/节假日期间行情日期不动，于是不会误删。
     */
    function purgeStaleClosedPositions() {
      const cfg = state.config;
      if (!cfg || !Array.isArray(cfg.positions) || !cfg.positions.length) return 0;
      const quotes = state.quotes || {};
      const stale = [];
      for (const p of cfg.positions) {
        const q = quotes[p.code];
        if (isStaleClosedPosition(p, q ? quoteDate(q) : "")) stale.push(p.code);
      }
      if (!stale.length) return 0;
      updateConfig((c) => {
        c.positions = c.positions.filter((p) => stale.indexOf(p.code) < 0);
        return c;
      });
      toast("已清理 " + stale.length + " 只上一交易日清仓的持仓", "#8be9fd");
      return stale.length;
    }
    function sseSupported() {
      return typeof EventSource === "function";
    }
    /** 关注集合（含详情页那只） */
    function sseCodes() {
      const base = allCodes(state.config);
      const d = state.detail && state.detail.code;
      return d ? base.concat([d]) : base;
    }
    function openStream() {
      if (!sseSupported()) return;
      closeStream();
      const codes = sseCodes();
      sseCodesKey = codes.slice().sort().join(",");
      const qs = codes.length ? "?codes=" + encodeURIComponent(codes.join(",")) : "";
      try {
        es = new EventSource(BASE + "/stream" + qs);
      } catch {
        es = null;
        return;
      }
      es.onopen = () => {
        sseTried = true;
        setState({ live: true }); // 实时通道已建立 → 停掉重复轮询
      };
      es.onmessage = (ev) => {
        let payload;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (payload && Array.isArray(payload.rows)) applyQuotes(payload.rows, payload.updatedAt, null);
      };
      es.onerror = () => {
        // 断流：关掉并回落轮询
        closeStream();
        setState({ live: false });
        startPolling();
      };
    }
    function closeStream() {
      if (!es) return;
      try {
        es.close();
      } catch { /* ignore */ }
      es = null;
      setState({ live: false });
    }
    /**
     * 关注集合变化时重连 EventSource。
     * 注意：EventSource 只能 GET、无法发送请求体（es.send 是 WebSocket 的 API），
     * 因此订阅集合只能通过 URL 传递，集合变化时「关掉再按新 URL 重开」——一次握手代价，可接受。
     */
    function syncStreamCodes() {
      if (!es) return;
      const codes = sseCodes();
      const key = codes.slice().sort().join(",");
      if (key === sseCodesKey) return;
      openStream();
    }

    // 轮询：setTimeout 链（pollMs 可配置变化），页面隐藏暂停、可见立即刷
    let pollTimer = null;
    let pollActive = false;
    function schedulePoll() {
      clearTimeout(pollTimer);
      // SSE 通道正常时不轮询（避免重复请求）
      if (!pollActive || es) return;
      const ms = state.config ? state.config.pollMs : 5000;
      pollTimer = setTimeout(async () => {
        await refreshQuotes();
        schedulePoll();
      }, clamp(ms, 2000, 120000));
    }
    function startPolling() {
      if (pollActive) return;
      pollActive = true;
      // 优先走 SSE 实时通道；不可用/失败时由 onerror 回落轮询
      if (sseSupported() && !sseTried) openStream();
      refreshQuotes();
      schedulePoll();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTimeout(pollTimer);
        closeStream(); // 隐藏时断开 SSE（与服务端连接数对齐）
      } else if (pollActive) {
        refreshQuotes();
        schedulePoll();
        if (sseTried && sseSupported()) openStream(); // 可见时恢复实时通道
      }
    });

    // 初始化：localStorage 秒开 → host 配置覆盖
    let inited = false;
    async function initStore() {
      if (inited) return;
      inited = true;
      try {
        const t = localStorage.getItem(LS_THEME);
        if (t === "light" || t === "dark") setState({ theme: t });
      } catch { /* ignore */ }
      try {
        const p = localStorage.getItem(LS_PLACEMENT);
        if (p === "dock" || p === "floating") setState({ barPlacement: p });
      } catch { /* ignore */ }
      try {
        const bp = localStorage.getItem(LS_BAR_POS);
        if (bp) {
          const o = JSON.parse(bp);
          if (o && typeof o.x === "number" && typeof o.y === "number") setState({ barPos: o });
        }
      } catch { /* ignore */ }
      let cfg = null;
      try {
        const raw = localStorage.getItem(LS_CONFIG);
        if (raw) cfg = JSON.parse(raw);
      } catch { /* ignore */ }
      if (cfg && Array.isArray(cfg.indices)) setState({ config: cfg });
      try {
        const r = await api("/config");
        if (r && r.config) {
          // 兼容旧版 host：其不认识的可选字段（如 ma）会被丢弃，优先保留本地已有值
          const merged = Object.assign({}, r.config);
          if (!Array.isArray(merged.ma) && cfg && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
          setState({ config: merged });
          try { localStorage.setItem(LS_CONFIG, JSON.stringify(merged)); } catch { /* ignore */ }
        }
        if (Array.isArray(r.quotes)) {
          const quotes = Object.assign({}, state.quotes);
          for (const row of r.quotes) quotes[row.code] = row;
          setState({ quotes, updatedAt: r.updatedAt || Date.now() });
        }
        if (r && r.warning) {
          // 配置文件损坏：明确告知，不要静默吞掉用户的持仓数据
          configWarning(r.warning);
        }
      } catch { /* host 不可达：用本地缓存 */ }
      startPolling();
    }

    // 配置操作 helpers
    function cfgFind(list, code) {
      return list.find((x) => x.code === code);
    }
    function addIndex(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.indices, item.code)) {
          toast("该指数已在列表中");
          return null;
        }
        cfg.indices.push({ code: item.code, name: item.name || displayCode(item.code) });
        return cfg;
      });
    }
    function removeIndex(code) {
      updateConfig((cfg) => {
        cfg.indices = cfg.indices.filter((x) => x.code !== code);
        cfg.barIndices = cfg.barIndices.filter((x) => x !== code);
        return cfg;
      });
    }
    function toggleMa(period) {
      // MA 选择全局通用：写回配置，跨股票/周期/会话保持
      updateConfig((c) => {
        const cur = Array.isArray(c.ma) ? c.ma.slice() : [5, 10, 20];
        const i = cur.indexOf(period);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(period);
        c.ma = MA_ALL.filter((p) => cur.indexOf(p) >= 0); // 固定顺序
        return c;
      });
    }
    function toggleBarIndex(code) {
      updateConfig((cfg) => {
        const i = cfg.barIndices.indexOf(code);
        if (i >= 0) cfg.barIndices.splice(i, 1);
        else {
          if (cfg.barIndices.length >= 8) {
            toast("指数栏最多显示 8 个");
            return null;
          }
          cfg.barIndices.push(code);
        }
        return cfg;
      });
    }
    /** 通用重排（拖动排序）：把 cfg[key] 列表第 from 项移动到 to 位置 */
    function reorderList(key, from, to) {
      updateConfig((cfg) => {
        const arr = cfg[key];
        if (!Array.isArray(arr) || from < 0 || from >= arr.length) return null;
        const [item] = arr.splice(from, 1);
        arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
        return cfg;
      });
    }
    /** 拖动排序后短暂抑制 click（跨浏览器：pointer capture 释放后 click 目标不确定） */
    let slDragStamp = 0;
    function justDragged() {
      return Date.now() - slDragStamp < 250;
    }
    /**
     * 左键拖动排序 hook：listRef 指向包含各行的容器（每行带 data-sl-idx）。
     * 返回 { drag, startDrag }；drag={from,overAt} 用于渲染落点指示线，startDrag(index,e) 挂到行手柄。
     */
    function useDragReorder(listRef, commit) {
      const [drag, setDrag] = useState(null);
      const dragRef = useRef(null);
      const commitRef = useRef(commit);
      commitRef.current = commit;
      const dragging = !!drag;
      const startDrag = (index, e) => {
        if (e.button !== undefined && e.button !== 0) return; // 仅左键
        dragRef.current = { from: index, overAt: index, moved: false };
        setDrag({ from: index, overAt: index });
        e.preventDefault();
        // 指针捕获：后续 move/up 重定向到手柄，事件仍冒泡到 window 监听
        try { if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId !== undefined) e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (ev) => {
          const d = dragRef.current;
          const container = listRef.current;
          if (!d || !container) return;
          const rows = Array.prototype.slice.call(container.querySelectorAll("[data-sl-idx]"));
          let overAt = d.from;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { overAt = i; break; }
            overAt = i + 1;
          }
          if (overAt !== d.from) d.moved = true;
          if (overAt !== d.overAt) { d.overAt = overAt; setDrag({ from: d.from, overAt: overAt }); }
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!d) return;
          slDragStamp = Date.now(); // 抑制紧随的 click（避免误开详情）
          let to = d.overAt;
          if (to > d.from) to -= 1; // 移除自身后目标位前移
          if (to !== d.from) commitRef.current(d.from, to);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
      }, [dragging]);
      return { drag, startDrag };
    }
    /** 落点指示线（在行之间） */
    function DropLine() {
      return h("div", { className: "sl-dropline" });
    }

    /** 列表超过该行数时，内部出现滚动条（表头与搜索框留在视野内） */
    const MAX_VISIBLE_ROWS = 10;

    /**
     * 给可排序列表加「最多显示 MAX_VISIBLE_ROWS 行」的上限。
     *
     * 上限按**实测行高**算，而不是写死像素：大盘行是两行式名称（名称+代码），
     * 自选行更矮，写死常量会在其中一种布局下多露半行或提前截断。
     *
     * 行高取前若干行的**最小值**：持仓行展开后会多出交易面板，比收起时高得多，
     * 若恰好用第一行（可能正展开着）当基准，上限会被撑成一大截，等于没限制。
     *
     * 行数不足上限时返回 null，不加 class，让容器自然撑开
     * （否则会出现"能滚但没内容"的空滚动条）。
     *
     * 用 ResizeObserver 跟踪：窗口缩放会改变字号进而改变行高，只测一次会失准。
     */
    function useListCap(listRef, count) {
      const [cap, setCap] = useState(null);
      useEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const measure = () => {
          if (count <= MAX_VISIBLE_ROWS) { setCap(null); return; }
          const rows = el.querySelectorAll("[data-sl-idx]");
          let rowH = 0;
          const n = Math.min(rows.length, 12);
          for (let i = 0; i < n; i++) {
            const h = rows[i].getBoundingClientRect().height;
            // 测试环境与首帧可能量不到高度，量不到就保持现状，等下一轮
            if (h > 0 && (rowH === 0 || h < rowH)) rowH = h;
          }
          if (!rowH) return;
          setCap(Math.round(rowH * MAX_VISIBLE_ROWS) + 1);
        };
        measure();
        let ro = null;
        try {
          if (typeof ResizeObserver === "function") {
            ro = new ResizeObserver(measure);
            ro.observe(el);
          }
        } catch { /* 老浏览器无 ResizeObserver，量一次也够用 */ }
        return () => { if (ro) ro.disconnect(); };
      }, [listRef, count]);
      return cap;
    }

    function addWatch(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.watchlist, item.code)) {
          toast("已在自选列表中");
          return null;
        }
        cfg.watchlist.push({ code: item.code, name: item.name || displayCode(item.code), addedAt: Date.now() });
        refreshQuotes();
        return cfg;
      });
    }
    function removeWatch(code) {
      updateConfig((cfg) => {
        cfg.watchlist = cfg.watchlist.filter((x) => x.code !== code);
        return cfg;
      });
    }
    function addPosition(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.positions, item.code)) {
          toast("该持仓股已存在");
          return null;
        }
        cfg.positions.push({ code: item.code, name: item.name || displayCode(item.code), cost: 0, qty: 0 });
        refreshQuotes();
        return cfg;
      });
    }
    function updatePosition(code, patch) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p) return null;
        Object.assign(p, patch);
        return cfg;
      });
    }
    function removePosition(code) {
      updateConfig((cfg) => {
        cfg.positions = cfg.positions.filter((x) => x.code !== code);
        return cfg;
      });
    }
    /** 行情交易日 YYYY-MM-DD（A股 time=20261013161452 / 港美=2026-10-13 16:08:32）；浏览器今日兜底 */
    function quoteDate(q) {
      const t = String((q && q.time) || "");
      let m = t.match(/^(\d{4})(\d{2})(\d{2})/);
      if (m) return m[1] + "-" + m[2] + "-" + m[3];
      m = t.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    /** 行情交易时刻 HH:MM */
    function quoteClock(q) {
      const t = String((q && q.time) || "");
      const m = t.match(/(\d{2}):(\d{2})/);
      if (m) return m[1] + ":" + m[2];
      const m2 = t.match(/^\d{8}(\d{2})(\d{2})/);
      if (m2) return m2[1] + ":" + m2[2];
      return "";
    }
    /**
     * 添加一笔变动：side=buy/sell（或 qty 直接为负=卖出）。
     * 买入：股数 +、成本按加权平均摊薄；卖出：股数 −（成本不变，下限 0）。
     * 今日收益据此计算（见 todayPnl），支持当日多次买卖。
     */
    function addTxn(code, txn) {
      const price = Number(txn.price);
      const rawQty = Number(txn.qty);
      let qty;
      if (txn.side === "buy") qty = Math.abs(rawQty);
      else if (txn.side === "sell") qty = -Math.abs(rawQty);
      else qty = rawQty; // 未指定方向：负数即卖出
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty === 0) {
        toast("变动无效：价格需 > 0，股数需非 0", "#ff5555");
        return false;
      }
      let ok = false;
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p) return null;
        const cur = p.qty || 0;
        const curCost = p.cost || 0;
        if (qty < 0 && cur + qty < 0) {
          toast("卖出股数超过当前持仓（" + cur + "）", "#ff5555");
          return null;
        }
        p.txns = p.txns || [];
        p.txns.push({
          id: (txn.date || "") + ":" + Date.now() + ":" + Math.round(Math.random() * 1e6),
          date: txn.date || "",
          time: txn.time || "",
          price: Math.round(price * 10000) / 10000,
          qty,
        });
        p.txns.sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
        const newQty = cur + qty;
        p.qty = newQty;
        if (qty > 0 && newQty > 0) {
          // 买入：加权平均成本
          p.cost = Math.round(((curCost * cur + price * qty) / newQty) * 10000) / 10000;
        }
        ok = true;
        return cfg;
      });
      return ok;
    }
    function removeTxn(code, id) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p || !p.txns) return null;
        const t = p.txns.find((x) => x.id === id);
        if (!t) return null;
        p.txns = p.txns.filter((x) => x.id !== id);
        if (p.txns.length === 0) delete p.txns;
        const cur = p.qty || 0;
        const prevQty = cur - t.qty; // 撤销该变动
        if (t.qty > 0 && prevQty > 0) {
          // 撤销买入：还原加权平均成本
          p.cost = Math.round(((p.cost * cur - t.price * t.qty) / prevQty) * 10000) / 10000;
        }
        p.qty = Math.max(0, prevQty);
        return cfg;
      });
    }
    /**
     * 今日收益（现金流法，支持当日多次买卖）：
     *   今日盈亏 = 当前持仓×现价 + 今日卖出金额 − 今日买入金额 − 昨日持仓×昨收
     *   其中 昨日持仓 = 当前持仓(qty) − 今日净变动(Σ今日 txns.qty)
     * 无今日变动时退化为 (现价 − 昨收) × qty。qty 视为「当前持仓」，与成本/股数录入一致。
     */
    function todayPnl(p, q) {
      if (!q || !Number.isFinite(q.price)) return 0;
      const now = q.price;
      const yest = Number.isFinite(q.yestclose) ? q.yestclose : null;
      const today = quoteDate(q);
      const txns = (p.txns || []).filter((t) => t.date === today);
      const qty = p.qty || 0;
      if (txns.length === 0) return yest !== null ? (now - yest) * qty : 0;
      let net = 0, buyAmt = 0, sellAmt = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      if (yest === null) return 0; // 无昨收：无法计算今日，返回 0
      const heldFromYesterday = qty - net;
      return qty * now + sellAmt - buyAmt - heldFromYesterday * yest;
    }
    /**
     * 这只持仓是否已过期（下一个交易日该移除）。lib/shared.js 的内联副本。
     * 判据用**行情日期**而非本地日期：行情日期天然跳过周末/节假日与盘前时段，
     * 不会在周末误删周五清仓的票。详见 lib/shared.js 的注释。
     */
    function isStaleClosedPosition(p, refDate) {
      if (!p || (p.qty || 0) !== 0) return false;
      const txns = Array.isArray(p.txns) ? p.txns : [];
      if (!txns.length) return false;
      let last = "";
      for (const t of txns) {
        const d = String((t && t.date) || "");
        if (d > last) last = d;
      }
      if (!last) return false;
      const ref = String(refDate || "");
      if (!ref) return false;
      return ref > last;
    }
    /**
     * 已实现盈亏（相对成本口径），用于**清仓后**的累计盈亏。
     *   已实现 = 今日卖出额 − 今日买入额 − 昨仓 × 成本
     * 清仓时市值与成本都归零，`value − cost` 会让累计盈亏凭空归零——但钱是赚到了的。
     * 用它接住，让累计盈亏在清仓瞬间保持连续：
     *   卖出前 (12−10)×100 = 200；清仓后 1200 − 0 − 100×10 = 200
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function realizedPnl(p, q) {
      if (!q || !Number.isFinite(q.price)) return 0;
      const today = quoteDate(q);
      const txns = (p.txns || []).filter((t) => t.date === today);
      if (txns.length === 0) return 0;
      const qty = p.qty || 0;
      const cost = Number.isFinite(p.cost) ? p.cost : 0;
      let net = 0, buyAmt = 0, sellAmt = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      const heldFromYesterday = qty - net;
      return sellAmt - buyAmt - heldFromYesterday * cost;
    }
    function openOverlay(tab) {
      setState({ open: true, tab: tab || state.tab });
    }
    /** 进入个股详情：若该股不在自选/持仓里，追加订阅，保证详情页有行情 */
    function openDetail(code, name) {
      state = Object.assign({}, state, { detail: { code, name } }); // 先落 state，供 syncStreamCodes 读到
      for (const l of listeners) l();
      syncStreamCodes(); // 订阅集合变了 → 重连流
    }
    function closeOverlay() {
      setState({ open: false, detail: null, menu: null, editPos: null, tip: null });
    }

    // ================================================================ 组件：搜索框（添加股票/指数）
    function SearchBox(props) {
      const [q, setQ] = useState("");
      const [rows, setRows] = useState(null);
      const [busy, setBusy] = useState(false);
      const timerRef = useRef(null);
      const boxRef = useRef(null);
      const inputRef = useRef(null);
      // 下拉数据发布到 store（rows/busy/empty/onPick + 输入框 ref），由 overlay 根层渲染，规避 panel 裁切。
      useEffect(() => {
        if (!q.trim()) {
          if (state.sug && state.sug.boxRef === boxRef) setState({ sug: null });
          return;
        }
        setState({ sug: { boxRef, inputRef, rows: rows || [], busy, empty: !busy && rows !== null && rows.length === 0, onPick: null } });
      }, [q, rows, busy]);
      // 卸载/切走时清理，避免根层残留
      useEffect(() => () => { if (state.sug && state.sug.boxRef === boxRef) setState({ sug: null }); }, []);
      useEffect(() => {
        clearTimeout(timerRef.current);
        const needle = q.trim();
        if (needle.length === 0) {
          setRows(null);
          setBusy(false);
          return undefined;
        }
        setBusy(true);
        timerRef.current = setTimeout(async () => {
          try {
            const r = await api("/search", { q: needle });
            let out = r.rows || [];
            if (props.filter) out = out.filter(props.filter);
            setRows(out);
          } catch {
            setRows([]);
          } finally {
            setBusy(false);
          }
        }, 320);
        return () => clearTimeout(timerRef.current);
      }, [q]); // eslint-disable-line
      // 点击框外（且不在下拉 .sl-sugs 上）收起
      useEffect(() => {
        const onDoc = (e) => {
          const sug = state.sug;
          if (!sug || sug.boxRef !== boxRef) return;
          if (boxRef.current && boxRef.current.contains(e.target)) return;
          if (e.target && e.target.closest && e.target.closest(".sl-sugs")) return;
          setState({ sug: null });
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
      }, []);
      const pick = (row) => {
        props.onPick(row);
        setQ("");
        setRows(null);
        setState({ sug: null });
      };
      // 每次渲染后把最新 pick 同步进 store（effect 内赋值，无渲染期副作用）
      useEffect(() => {
        if (state.sug && state.sug.boxRef === boxRef) state.sug.onPick = pick;
      });
      return h(
        "div",
        { ref: boxRef, style: { flex: 1, position: "relative", display: "flex", gap: 6, minWidth: 0 } },
        h("input", {
          ref: inputRef,
          className: "sl-input",
          value: q,
          placeholder: props.placeholder || "搜索：代码/名称/拼音（600519、茅台、gzmt、hkHSI…）",
          onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Escape") { setQ(""); setRows(null); setState({ sug: null }); }
            if (e.key === "Enter" && rows && rows.length > 0) pick(rows[0]);
          },
        }),
        busy ? h("span", { style: { alignSelf: "center", color: "var(--sl-muted)" } }, "…") : null,
      );
    }

    /** 搜索下拉：渲染在 overlay 根层（panel 的兄弟），position:fixed 不受裁切；滚动/缩放/拖动实时跟随输入框。 */
    function SearchSuggest(props) {
      const { sug, theme } = props;
      const [, setTick] = useState(0);
      useEffect(() => {
        const bump = () => setTick((t) => (t + 1) % 1000000);
        window.addEventListener("scroll", bump, true); // capture：捕获 .sl-body 等内部滚动
        window.addEventListener("resize", bump);
        return () => {
          window.removeEventListener("scroll", bump, true);
          window.removeEventListener("resize", bump);
        };
      }, []);
      if (!sug || !sug.inputRef || !sug.inputRef.current) return null;
      const r = sug.inputRef.current.getBoundingClientRect();
      const rows = sug.rows || [];
      const listH = Math.min(240, (rows.length || 1) * 26 + 12);
      const downFits = r.bottom + listH + 8 < window.innerHeight;
      const upFits = r.top > listH + 8;
      const openUp = !downFits && upFits; // 默认向下；下方放不下且上方够空间才向上
      const style = openUp
        ? { left: r.left, bottom: window.innerHeight - r.top + 4, width: Math.max(r.width, 200) }
        : { left: r.left, top: r.bottom + 4, width: Math.max(r.width, 200) };
      return h(
        "div",
        {
          className: "sl-root sl-theme-" + theme + (theme === "light" ? " sl-light" : "") + " sl-sugs",
          style,
          onMouseDown: (e) => e.stopPropagation(),
        },
        rows.length > 0
          ? rows.slice(0, 20).map((x) =>
              h(
                "button",
                { key: x.code, className: "sl-sug", onClick: () => sug.onPick && sug.onPick(x) },
                h("span", { className: "sl-sug-code" }, (x.market || "") + displayCode(x.code)),
                h("span", { className: "sl-sug-name" }, x.name),
                h("span", { className: "sl-sug-tag" }, x.label || x.type),
              ),
            )
          : h("div", { className: "sl-empty" }, sug.busy ? "搜索中…" : "未找到匹配"),
      );
    }

    // ================================================================ 组件：图表（自绘 SVG）
    function MinuteChart(props) {
      const { points, prevClose, color, width, height } = props;
      const W = width || 404;
      const H = height || 170;
      const padL = 4, padR = 46, padT = 8, padB = 16;
      if (!Array.isArray(points) || points.length < 2) {
        return h("div", { className: "sl-empty" }, "暂无分时数据（休市或该市场不支持）");
      }
      let min = Infinity, max = -Infinity;
      for (const p of points) { if (p.p < min) min = p.p; if (p.p > max) max = p.p; }
      if (prevClose !== null && Number.isFinite(prevClose)) {
        max = Math.max(max, prevClose);
        min = Math.min(min, prevClose);
      }
      const span = max - min || 1;
      const iw = W - padL - padR;
      const ih = H - padT - padB;
      const xOf = (i) => padL + (i / (points.length - 1)) * iw;
      const yOf = (v) => padT + ih - ((v - min) / span) * ih;
      const line = points.map((p, i) => xOf(i).toFixed(1) + "," + yOf(p.p).toFixed(1)).join(" ");
      const area = "M" + padL + "," + (padT + ih) + " L" + line.split(" ").join(" L") + " L" + xOf(points.length - 1).toFixed(1) + "," + (padT + ih) + " Z";
      const base = prevClose !== null && Number.isFinite(prevClose) ? yOf(prevClose) : null;
      // 时间刻度：首、1/4、中、3/4、末
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const i = Math.min(points.length - 1, Math.round(f * (points.length - 1)));
        const t = points[i].t;
        return { x: xOf(i), label: t.slice(0, 2) + ":" + t.slice(2, 4) };
      });
      const lastP = points[points.length - 1].p;
      return h(
        "svg",
        { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, preserveAspectRatio: "none", style: { display: "block" } },
        h("path", { d: area, fill: color, opacity: 0.08 }),
        base !== null ? h("line", { x1: padL, x2: padL + iw, y1: base, y2: base, stroke: "var(--sl-muted)", strokeDasharray: "3 3", strokeWidth: 1 }) : null,
        base !== null ? h("text", { x: W - padR + 3, y: base + 3, fontSize: 9, fill: "var(--sl-muted)" }, fmtPrice(prevClose)) : null,
        h("polyline", { points: line, fill: "none", stroke: color, strokeWidth: 1.4 }),
        h("circle", { cx: xOf(points.length - 1), cy: yOf(lastP), r: 2.2, fill: color }),
        h("line", { x1: padL + iw, x2: W, y1: yOf(lastP), y2: yOf(lastP), stroke: color, strokeDasharray: "2 2", strokeWidth: 0.8, opacity: 0.6 }),
        h("text", { x: W - padR + 3, y: yOf(lastP) + 3, fontSize: 9, fill: color }, fmtPrice(lastP)),
        ticks.map((t, i) => h("text", { key: i, x: clamp(t.x, 10, W - 20), y: H - 3, fontSize: 8.5, fill: "var(--sl-muted)", textAnchor: "middle" }, t.label)),
      );
    }

    /**
 * 持仓当日盈亏曲线：把每只持仓的「今日盈亏」按分钟展开成一条曲线。
 *
 * 口径与持仓页一致（todayPnl 的现金流口径），只是把 `now` 换成该分钟的价格：
 *   pnl(t) = qty×price(t) + 今日卖出额 − 今日买入额 − 昨仓×昨收
 * 基线 0 元即「今日不赚不亏」，能直观看出今天几点开始赚的 / 从哪里开始亏的。
 */
    function PnlCurve(props) {
      const rows = props.rows || []; // [{code,series:[{t,p}],yest,qty,heldYest,buyAmt,sellAmt}]
      const W = props.width || 404;
      const H = props.height || 96;
      const padL = 4, padR = 52, padT = 10, padB = 16;
      // 实时价在渲染时现取，而不是存进 curve state。
      // 这样每次行情推送（按设置的刷新间隔）曲线末端都会跟着动，
      // 不必等 /minute 重拉——曲线是「随行情刷新」的，不是「随分时刷新」的。
      const quotes = (props.quotes) || {};
      if (!rows.length || !rows.some((r) => r.series && r.series.length >= 2)) {
        return h("div", { className: "sl-empty" }, "暂无当日盈亏曲线（休市或该市场不支持分时）");
      }
      // 按时间对齐各持仓的分时点（各市场交易时段可能不同，取并集后逐点求和）
      const timeSet = new Set();
      for (const r of rows) for (const pt of r.series || []) timeSet.add(pt.t);
      const times = [...timeSet].sort();
      if (times.length < 2) return h("div", { className: "sl-empty" }, "暂无当日盈亏曲线（休市或该市场不支持分时）");
      // 每股价格 → 该分钟价格（取不晚于该分钟的最后一个点）
      const at = (r, t) => {
        const s = r.series || [];
        let v = null;
        for (const pt of s) { if (pt.t <= t) v = pt.p; else break; }
        return v;
      };
      const pts = times.map((t) => {
        let sum = 0;
        for (const r of rows) {
          const p = at(r, t);
          if (p !== null && r.yest !== null && Number.isFinite(r.yest)) {
            sum += p * r.qty + r.sellAmt - r.buyAmt - r.heldYest * r.yest;
          }
        }
        return { t, p: sum };
      });
      // 末端接上实时价：分时接口是分钟粒度，最后一个点可能落后好几分钟，
      // 直接取它会让曲线右端比实际持仓盈亏"卡住"，与上方数字对不上。
      // 用当前报价替换末点价格，使曲线末值 ≡ 持仓页的今日盈亏（同一口径）。
      if (pts.length) {
        let lastSum = 0, any = false;
        for (const r of rows) {
          const q = quotes[r.code];
          const live = q && Number.isFinite(q.price) ? q.price : null;
          if (live === null || r.yest === null || !Number.isFinite(r.yest)) continue;
          lastSum += live * r.qty + r.sellAmt - r.buyAmt - r.heldYest * r.yest;
          any = true;
        }
        if (any) pts[pts.length - 1] = { t: pts[pts.length - 1].t, p: lastSum };
      }
      let min = Infinity, max = -Infinity;
      for (const p of pts) { if (p.p < min) min = p.p; if (p.p > max) max = p.p; }
      min = Math.min(min, 0);
      max = Math.max(max, 0);
      const span = max - min || 1;
      const iw = W - padL - padR;
      const ih = H - padT - padB;
      const xOf = (i) => padL + (i / (pts.length - 1)) * iw;
      const yOf = (v) => padT + ih - ((v - min) / span) * ih;
      const zero = yOf(0);
      const line = pts.map((p, i) => xOf(i).toFixed(1) + "," + yOf(p.p).toFixed(1)).join(" ");
      const area = "M" + padL + "," + zero.toFixed(1) + " L" + line.split(" ").join(" L") + " L" + xOf(pts.length - 1).toFixed(1) + "," + zero.toFixed(1) + " Z";
      const last = pts[pts.length - 1];
      const col = last.p >= 0 ? "var(--sl-up)" : "var(--sl-down)";
      const ticks = [0, 0.5, 1].map((f) => {
        const i = Math.min(pts.length - 1, Math.round(f * (pts.length - 1)));
        const t = pts[i].t;
        return { x: xOf(i), label: t.slice(0, 2) + ":" + t.slice(2, 4) };
      });
      return h(
        "svg",
        { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, preserveAspectRatio: "none", style: { display: "block" } },
        h("path", { d: area, fill: col, opacity: 0.1 }),
        h("line", { x1: padL, x2: padL + iw, y1: zero, y2: zero, stroke: "var(--sl-muted)", strokeDasharray: "3 3", strokeWidth: 1 }),
        h("text", { x: W - padR + 3, y: zero + 3, fontSize: 9, fill: "var(--sl-muted)" }, "0"),
        h("polyline", { points: line, fill: "none", stroke: col, strokeWidth: 1.4 }),
        h("circle", { cx: xOf(pts.length - 1), cy: yOf(last.p), r: 2.2, fill: col }),
        h("text", { x: W - padR + 3, y: yOf(last.p) + 3, fontSize: 9, fill: col }, fmtSigned(Math.round(last.p))),
        ticks.map((t, i) => h("text", { key: i, x: clamp(t.x, 10, W - 20), y: H - 3, fontSize: 8.5, fill: "var(--sl-muted)", textAnchor: "middle" }, t.label)),
      );
    }

    function KlineChart(props) {
      const all = props.candles || [];
      const total = all.length;
      const showMa = props.ma || [];
      const W = 404;
      const H = props.height || 190;
      const VH = 34;
      const padL = 4, padR = 46, padT = 6, padB = 14;
      const MINV = Math.min(total, 10);            // 最少可见 K 线数
      const DEF = Math.min(total, 90);            // 默认可见根数（不足则全部）
      const defWin = () => [Math.max(0, total - DEF), total];
      // 可视窗口 [start, end)
      const [win, setWin] = useState(defWin);
      const dragRef = useRef(null); // 拖动平移：{x, s, en}
      const movedRef = useRef(false); // 本次手势是否发生过平移（拖动后不触发点击钉住）
      const [hoverIdx, setHoverIdx] = useState(null); // 鼠标所在 K 线（绝对索引，临时）
      const [pinIdx, setPinIdx] = useState(null);     // 点击钉住的 K 线（绝对索引）
      // 换股票/周期/数据长度变化 → 复位窗口（渲染期调整，避免闪一下旧窗口）
      const sig = (props.symbol || "") + "|" + (props.period || "") + "|" + total;
      const [sigState, setSigState] = useState(() => sig);
      if (sigState !== sig) { setSigState(sig); setWin(defWin()); }
      // 夹取窗口：至少 MINV 根、不超 total、不越界
      const clamp = (s, e) => {
        const len = Math.max(MINV, Math.min(total, e - s));
        const st = Math.max(0, Math.min(total - len, s));
        return [Math.round(st), Math.round(st + len)];
      };
      const zoomAt = (frac, k) => {
        const s = win[0], en = win[1];
        const anchor = s + frac * (en - s);
        const len = Math.max(MINV, Math.min(total, (en - s) * k));
        setWin(clamp(anchor - frac * len, anchor - frac * len + len));
      };
      // 屏幕 x → K 线绝对索引；超出可视窗口返回 null
      const rectOf = (e) => (e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null);
      const idxAt = (clientX, rect) => {
        if (!rect || !rect.width) return null;
        const px = (padL / W) * rect.width, pw = ((W - padL - padR) / W) * rect.width;
        const i = Math.floor(((clientX - rect.left - px) / pw) * (win[1] - win[0]));
        if (i < 0 || i >= win[1] - win[0]) return null;
        return win[0] + i;
      };
      const onWheel = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        // 鼠标横向位置 → 锚点比例（以可视区为准）
        let frac = 0.5;
        const rect = e && e.currentTarget && e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : null;
        if (rect && rect.width) {
          const px = (padL / W) * rect.width, pw = ((W - padL - padR) / W) * rect.width;
          frac = Math.max(0, Math.min(1, (e.clientX - rect.left - px) / pw));
        }
        zoomAt(frac, e && e.deltaY > 0 ? 1.18 : 1 / 1.18); // 下滚=看得更远，上滚=看得更近
      };
      const onDown = (e) => {
        movedRef.current = false;
        dragRef.current = { x: e.clientX, s: win[0], en: win[1] };
        if (e && e.preventDefault) e.preventDefault();
      };
      const onMove = (e) => {
        const rect = rectOf(e);
        const d = dragRef.current;
        if (!d) { // 未拖动 → 悬浮预览该根 K 线
          const i = idxAt(e.clientX, rect);
          if (i !== hoverIdx) setHoverIdx(i);
          return;
        }
        if (!rect || !rect.width) return;
        const pw = rect.width * (W - padL - padR) / W;
        const stepPx = pw / Math.max(1, d.en - d.s);
        const shift = Math.round(-(e.clientX - d.x) / Math.max(0.001, stepPx));
        if (shift) { movedRef.current = true; setWin(clamp(d.s + shift, d.en + shift)); }
      };
      const onUp = () => { dragRef.current = null; };
      const onLeave = () => { dragRef.current = null; if (hoverIdx !== null) setHoverIdx(null); };
      // 点击：钉住该根 K 线；点空白处或同一根 → 取消钉住（拖动平移后不触发）
      const onClick = (e) => {
        if (movedRef.current) { movedRef.current = false; return; }
        const i = idxAt(e.clientX, rectOf(e));
        setPinIdx((prev) => (i === null ? null : prev === i ? null : i));
      };
      // 钉住后可用 ← / → 逐根切换；移出可视窗口时自动平移窗口跟随
      useEffect(() => {
        if (pinIdx === null) return undefined;
        const onKey = (e) => {
          if (!e || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
          const t = e.target;
          if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // 输入框里不抢按键
          if (e.preventDefault) e.preventDefault();
          const d = e.key === "ArrowLeft" ? -1 : 1;
          const ni = pinIdx + d;
          if (ni < 0 || ni >= total) return; // 到数据边界不再移动
          setPinIdx(ni);
          setWin((w) => {
            const len = w[1] - w[0];
            if (ni >= w[0] && ni < w[1]) return w;
            const st = d > 0 ? ni - len + 1 : ni; // 向右移到窗口右缘、向左移到左缘
            return clamp(st, st + len);
          });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [pinIdx, total]);
      const reset = () => setWin(defWin());
      const candles = all.slice(win[0], win[1]);
      if (candles.length === 0) {
        return h("div", { className: "sl-empty" }, props.error ? "K线获取失败：" + props.error : "暂无K线数据");
      }
      const priceH = H - VH - padT - padB;
      let min = Infinity, max = -Infinity, vmax = 0;
      for (const c of candles) {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
        if (c.volume > vmax) vmax = c.volume;
      }
      // 持仓成本线：把成本价纳入价格范围，否则成本远在区间外时看不到线
      const costPrice = Number(props.cost) > 0 ? Number(props.cost) : null;
      if (costPrice !== null) {
        if (costPrice < min) min = costPrice;
        if (costPrice > max) max = costPrice;
      }
      const span = max - min || 1;
      const iw = W - padL - padR;
      const step = iw / candles.length;
      const bw = Math.max(1.5, step * 0.62);
      const xOf = (i) => padL + step * i + step / 2;
      const yOf = (v) => padT + priceH - ((v - min) / span) * priceH;
      const up = props.riseColor || "#f5455c";
      const down = props.fallColor || "#1eb980";
      const els = [];
      candles.forEach((c, i) => {
        const isUp = c.close >= c.open;
        const col = isUp ? up : down;
        const x = xOf(i);
        els.push(h("line", { key: "w" + i, x1: x, x2: x, y1: yOf(c.high), y2: yOf(c.low), stroke: col, strokeWidth: 0.8 }));
        const top = yOf(Math.max(c.open, c.close));
        const bh = Math.max(0.8, Math.abs(yOf(c.open) - yOf(c.close)));
        els.push(h("rect", { key: "b" + i, x: x - bw / 2, y: top, width: bw, height: bh, fill: col, opacity: isUp ? 0.9 : 0.85 }));
        const vh = vmax > 0 ? (c.volume / vmax) * (VH - 4) : 0;
        els.push(h("rect", { key: "v" + i, x: x - bw / 2, y: H - padB - vh, width: bw, height: vh, fill: col, opacity: 0.45 }));
      });
      // 持仓成本线：现价在成本上方=绿，下方=红（虚线 + 右侧价格标签）
      const costEls = [];
      if (costPrice !== null) {
        const below = candles[candles.length - 1].close < costPrice; // 现价跌破成本 → 红
        const cc = below ? "var(--sl-down)" : "var(--sl-up)";
        const y = yOf(costPrice);
        costEls.push(h("line", {
          key: "cost", x1: padL, x2: padL + iw, y1: y, y2: y,
          stroke: cc, strokeWidth: 1, strokeDasharray: "5 3", opacity: 0.85,
        }));
        costEls.push(h("text", {
          key: "costt", x: W - padR + 3, y: y + 3, fontSize: 9, fill: cc,
        }, "成本 " + fmtPrice(costPrice)));
      }
      // MA 线：MA5 用主题色（白天深色、夜间浅色），其余为固定色
      const maPeriods = showMa;
      const maColors = { 5: "var(--sl-text)", 10: "#e6a23c", 20: "#ff5cd2", 60: "#1eb980" };
      const maEls = [];
      for (const p of maPeriods) {
        const pts = [];
        for (let i = p - 1; i < candles.length; i++) {
          let s = 0;
          for (let j = i - p + 1; j <= i; j++) s += candles[j].close;
          pts.push(xOf(i).toFixed(1) + "," + yOf(s / p).toFixed(1));
        }
        if (pts.length > 1) {
          maEls.push(h("polyline", { key: "ma" + p, points: pts.join(" "), fill: "none", stroke: maColors[p] || "#4cc2ff", strokeWidth: 1, opacity: 0.9 }));
        }
      }
      const last = candles[candles.length - 1];
      const first = candles[0];
      const isFull = win[0] <= 0 && win[1] >= total;
      const atDefault = win[0] === Math.max(0, total - DEF) && win[1] === total;
      // 选中的 K 线：优先钉住的，其次悬浮的；超出当前窗口则忽略
      const inWin = (i) => i !== null && i !== undefined && i >= win[0] && i < win[1];
      const selAbs = inWin(pinIdx) ? pinIdx : inWin(hoverIdx) ? hoverIdx : null;
      const sel = selAbs === null ? null : all[selAbs];
      const si = selAbs === null ? -1 : selAbs - win[0];
      const prevClose = selAbs !== null && all[selAbs - 1] ? all[selAbs - 1].close : sel ? sel.open : 0;
      const chg = sel ? sel.close - prevClose : 0;
      const chgPct = sel && prevClose ? (chg / prevClose) * 100 : null;
      const amp = sel && prevClose ? ((sel.high - sel.low) / prevClose) * 100 : null;
      const chgColor = sel ? (sel.close >= sel.open ? "var(--sl-up)" : "var(--sl-down)") : "var(--sl-dim)";
      // MA 数值：跟随选中/悬浮的那一根；未选中时取最后一根
      const maAt = (abs, p) => (abs - p + 1 < 0 ? null : (() => { let s = 0; for (let j = abs - p + 1; j <= abs; j++) s += all[j].close; return s / p; })());
      const maReadIdx = selAbs === null ? total - 1 : selAbs;
      let maX = padL + 2;
      const maLabels = maPeriods.map((p) => {
        const v = maAt(maReadIdx, p);
        const txt = "MA" + p + " " + (v !== null ? fmtPrice(v) : "--");
        const el = h("text", { key: "mal" + p, x: maX, y: padT + 8, fontSize: 9, fill: maColors[p] || "#4cc2ff" }, txt);
        maX += txt.length * 5.2 + 8; // 近似字宽，按内容累加避免跳位
        return el;
      });
      // 上抛选中 K 线（详情页顶部指标区显示单根信息，不选则显示当日行情）
      useEffect(() => {
        if (typeof props.onCandle === "function") props.onCandle(sel ? Object.assign({}, sel, { prevClose, chg, chgPct, amp }) : null);
      }, [selAbs, total]);
      const crossEls = si < 0 ? [] : [
        h("rect", { key: "hl", x: padL + step * si, y: padT, width: Math.max(1, step), height: priceH, fill: "var(--sl-accent)", opacity: 0.08 }),
        h("line", { key: "vx", x1: xOf(si), x2: xOf(si), y1: padT, y2: H - padB - VH, stroke: "var(--sl-accent)", strokeWidth: 0.7, strokeDasharray: "3 2", opacity: 0.8 }),
        h("line", { key: "hy", x1: padL, x2: padL + iw, y1: yOf(sel.close), y2: yOf(sel.close), stroke: "var(--sl-accent)", strokeWidth: 0.6, strokeDasharray: "3 2", opacity: 0.5 }),
        h("text", { key: "py", x: W - padR + 3, y: yOf(sel.close) + 3, fontSize: 9, fill: "var(--sl-accent)" }, fmtPrice(sel.close)),
      ];
      return h(
        "div",
        {
          style: { position: "relative", userSelect: "none" },
          onWheel,
          onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerLeave: onLeave,
          onClick,
          // 双击 = 取消钉住（复位改用底栏「复位」按钮）
          onDoubleClick: (e) => { if (e && e.preventDefault) e.preventDefault(); setPinIdx(null); },
        },
        h(
          "svg",
          { viewBox: "0 0 " + W + " " + H, width: "100%", height: H, preserveAspectRatio: "none", style: { display: "block", cursor: "crosshair" } },
          els,
          costEls,
          maEls,
          crossEls,
          maLabels,
          h("line", { x1: padL, x2: padL + iw, y1: H - padB - VH - 2, y2: H - padB - VH - 2, stroke: "var(--sl-border-soft)", strokeWidth: 0.6 }),
          h("text", { x: W - padR + 3, y: yOf(max) + 8, fontSize: 9, fill: "var(--sl-muted)" }, fmtPrice(max)),
          h("text", { x: W - padR + 3, y: yOf(min) + 3, fontSize: 9, fill: "var(--sl-muted)" }, fmtPrice(min)),
          h("text", { x: padL + 2, y: H - 3, fontSize: 8.5, fill: "var(--sl-muted)" }, first.time),
          h("text", { x: padL + iw, y: H - 3, fontSize: 8.5, fill: "var(--sl-muted)", textAnchor: "end" }, last.time),
        ),
        // 底部范围/操作提示 + 复位
        h("div", { style: { fontSize: 9, color: "var(--sl-muted)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 1, padding: "0 2px" } },
          h("span", null, "滚轮缩放 · 拖动平移 · 点击钉住 · ← → 切换 · 双击取消"),
          h("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 } },
            isFull ? "共 " + total + " 根" : first.time + " ~ " + last.time + " · " + candles.length + "/" + total + " 根",
            atDefault ? null : h("button", {
              style: { background: "var(--sl-bg2)", color: "var(--sl-dim)", border: "1px solid var(--sl-border)", borderRadius: 3, fontSize: 9, lineHeight: "13px", padding: "0 4px", cursor: "pointer" },
              "data-sltip": "恢复默认窗口（最近 " + DEF + " 根）",
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); reset(); },
            }, "复位") ),
        ),
      );
    }

    // ================================================================ 右键菜单 / 持仓编辑对话框
    function ContextMenu(props) {
      const menu = props.menu;
      useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      if (!menu) return null;
      // 视口钳制（估算尺寸，渲染后再由 CSS max 限制兜底）
      const x = Math.min(menu.x, window.innerWidth - 190);
      const y = Math.min(menu.y, window.innerHeight - (menu.items.length * 30 + 40));
      return h(
        react.Fragment,
        null,
        h("div", { style: { position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "auto" }, onMouseDown: closeMenu, onContextMenu: (e) => { e.preventDefault(); closeMenu(); } }),
        h(
          "div",
          { className: "sl-root sl-theme-" + state.theme + (state.theme === "light" ? " sl-light" : "") + " sl-menu", style: { left: Math.max(4, x), top: Math.max(4, y) }, onMouseDown: (e) => e.stopPropagation() },
          menu.header ? h("div", { className: "sl-menu-hint" }, menu.header) : null,
          menu.items.map((it, i) =>
            it.sep
              ? h("div", { key: i, className: "sl-menu-sep" })
              : h("button", {
                  key: i,
                  className: "sl-menu-item" + (it.danger ? " sl-menu-danger" : ""),
                  onClick: () => { closeMenu(); try { it.onClick(); } catch { /* ignore */ } },
                }, it.label),
          ),
        ),
      );
    }

    /** 持仓成本/股数编辑对话框（右键菜单「编辑成本/股数」打开）：跟随悬浮窗定位、拖动时实时贴合 */
    function usePanelRect(active) {
      const [rect, setRect] = useState(null);
      useEffect(() => {
        if (!active) { setRect(null); return undefined; }
        let raf = 0;
        let last = null;
        const measure = () => {
          const el = document.querySelector(".sl-panel");
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0) {
              if (!last || Math.abs(last.left - r.left) > 0.5 || Math.abs(last.top - r.top) > 0.5 || last.width !== r.width || last.height !== r.height) {
                last = { left: r.left, top: r.top, width: r.width, height: r.height };
                setRect(last);
              }
            }
          }
          raf = requestAnimationFrame(measure);
        };
        measure();
        return () => cancelAnimationFrame(raf);
      }, [active]);
      return rect;
    }
    function EditPosDialog() {
      const s = useStore();
      const ep = s.editPos;
      const [cost, setCost] = useState("");
      const [qty, setQty] = useState("");
      const panelRect = usePanelRect(!!ep);
      const boxRef = useRef(null);
      useEffect(() => {
        if (ep) { setCost(ep.cost || ""); setQty(ep.qty || ""); }
      }, [ep && ep.code]);
      useEffect(() => {
        if (!ep) return undefined;
        const onKey = (e) => { if (e.key === "Escape") setState({ editPos: null }); };
        const onDown = (e) => {
          if (boxRef.current && !boxRef.current.contains(e.target)) setState({ editPos: null });
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => {
          window.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onDown);
        };
      }, [ep]);
      if (!ep) return null;
      const save = () => {
        const c = parseFloat(cost);
        const v = parseInt(qty, 10);
        updatePosition(ep.code, {
          cost: Number.isFinite(c) && c > 0 ? c : 0,
          qty: Number.isFinite(v) && v > 0 ? v : 0,
        });
        setState({ editPos: null });
        toast("已保存 " + (ep.name || ep.code) + " 成本/股数");
      };
      // 定位：贴合悬浮窗（panel）中央；测不到 panel 时回退视口居中
      const boxW = 280;
      const cx = panelRect ? panelRect.left + panelRect.width / 2 : window.innerWidth / 2;
      const cy = panelRect ? panelRect.top + panelRect.height / 2 : window.innerHeight / 2;
      const style = { position: "fixed", left: cx, top: cy, transform: "translate(-50%,-50%)", zIndex: 10002, pointerEvents: "auto" };
      return h(
        "div",
        { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""), style },
        h(
          "div",
          { ref: boxRef, style: { width: boxW, background: "var(--sl-bg)", border: "1px solid var(--sl-accent-border)", borderRadius: 10, padding: 12, boxShadow: "var(--sl-shadow)", display: "flex", flexDirection: "column", gap: 8 } },
          h("div", { style: { fontWeight: 700, color: "var(--sl-accent)" } }, "编辑持仓：" + (ep.name || ep.code) + "（" + displayCode(ep.code) + "）"),
          h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
            h("span", { className: "sl-setlabel" }, "成本价"),
            h("input", { className: "sl-input", style: { width: 150 }, type: "number", step: "0.001", min: "0", value: cost, autoFocus: true, placeholder: "如 1274.89", onChange: (e) => setCost(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") save(); } })),
          h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
            h("span", { className: "sl-setlabel" }, "股数"),
            h("input", { className: "sl-input", style: { width: 150 }, type: "number", step: "100", min: "0", value: qty, placeholder: "如 100", onChange: (e) => setQty(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") save(); } })),
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 } },
            h("button", { className: "sl-btn sl-btn-ghost", onClick: () => setState({ editPos: null }) }, "取消"),
            h("button", { className: "sl-btn", onClick: save }, "保存")),
        ),
      );
    }

    // ================================================================ 通用悬浮提示（仿收益浮层）
    /**
     * 全局委托：任意元素带 data-sltip="文本"（\n 换行）即触发统一样式浮层。
     * 监听一次（apply 内注册），mouseover 定位到元素上方居中，mouseout 清除。
     */
    function initTipLayer() {
      const onOver = (e) => {
        const t = e.target;
        const el = t && t.closest ? t.closest("[data-sltip]") : null;
        if (!el) return;
        const text = el.getAttribute("data-sltip");
        if (!text) return;
        const r = el.getBoundingClientRect();
        setState({ tip: { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, text } });
      };
      const onOut = (e) => {
        const t = e.target;
        const el = t && t.closest ? t.closest("[data-sltip]") : null;
        if (!el) return;
        const to = e.relatedTarget;
        if (to && to.closest && to.closest("[data-sltip]") === el) return; // 移到子元素，保持
        setState({ tip: null });
      };
      // 页面任意处的按下/点击/滚轮/滚动都立即收起提示
      // （包括点击提示自己 —— 点行进入详情、点胶囊切页签时，提示必须跟着走）
      const hide = () => { if (state.tip) setState({ tip: null }); };
      window.addEventListener("mouseover", onOver, true);
      window.addEventListener("mouseout", onOut, true);
      window.addEventListener("mousedown", hide, true);
      window.addEventListener("click", hide, true);
      window.addEventListener("wheel", hide, { capture: true, passive: true });
      window.addEventListener("scroll", hide, true);
      return () => {
        window.removeEventListener("mouseover", onOver, true);
        window.removeEventListener("mouseout", onOut, true);
        window.removeEventListener("mousedown", hide, true);
        window.removeEventListener("click", hide, true);
        window.removeEventListener("wheel", hide, true);
        window.removeEventListener("scroll", hide, true);
      };
    }
    /** 提示浮层：渲染在 shell.overlay 顶层，fixed 定位，自动上/下翻转 + 水平钳制。 */
    function TipLayer() {
      const s = useStore();
      const tip = s.tip;
      if (!tip) return null;
      const flipDown = tip.top < 96; // 顶部空间不足则显示在下方
      const style = flipDown
        ? { left: tip.x, top: tip.bottom + 8, transform: "translateX(-50%)" }
        : { left: tip.x, top: tip.top - 8, transform: "translateX(-50%) translateY(-100%)" };
      const half = 170; // max-width 320 的一半，水平钳制避免溢出屏幕
      style.left = Math.max(half + 8, Math.min(window.innerWidth - half - 8, tip.x));
      return h("div", { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : "") + " sl-tip", style }, tip.text);
    }

    // ================================================================ 视图：大盘
    function MarketView() {
      const s = useStore();
      const cfg = s.config;
      const listRef = useRef(null);
      const { drag, startDrag } = useDragReorder(listRef, (from, to) => reorderList("indices", from, to));
      const cap = useListCap(listRef, cfg ? cfg.indices.length : 0);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const dropAt = (i) => drag && drag.overAt === i;
      return h(
        "div",
        null,
        h("div", { className: "sl-hrow" },
          h("span", { className: "sl-h-grip" }),
          h("span", { className: "sl-h-name" }, "指数"),
          h("span", { className: "sl-h-price" }, "点位"),
          h("span", { className: "sl-h-pct" }, "涨跌幅"),
          h("span", { className: "sl-h-amt" }, "成交额"),
          h("span", { className: "sl-h-turn" }, "换手")),
        h("div", { className: "sl-sortable" + (cap ? " sl-sortable-cap" : "") + (drag ? " sl-sorting" : ""), ref: listRef, style: cap ? { maxHeight: cap + "px" } : null },
          cfg.indices.map((idx, i) => {
            const q = s.quotes[idx.code];
            const pct = q ? q.percent : null;
            const col = q ? (pct > 0 ? "sl-up" : pct < 0 ? "sl-down" : "sl-flat") : "sl-flat";
            const inBar = cfg.barIndices.indexOf(idx.code) >= 0;
            const isDragging = drag && drag.from === i;
            return h(
              react.Fragment,
              { key: idx.code },
              dropAt(i) ? h(DropLine) : null,
              h(
                "div",
                {
                  "data-sl-idx": i,
                  className: "sl-row sl-sortable-row" + (isDragging ? " sl-row-dragging" : ""),
                  onClick: () => { if (justDragged()) return; openDetail(idx.code, idx.name); },
                  onContextMenu: (e) => openMenu(e, [
                    { label: "📌 置顶", onClick: () => pinTop("indices", idx.code) },
                    { label: inBar ? "✂ 从指数栏移除" : "📎 添加到左下角指数栏", onClick: () => toggleBarIndex(idx.code) },
                    { sep: true },
                    { label: "🗑 删除指数", danger: true, onClick: () => { removeIndex(idx.code); toast("已删除 " + (idx.name || idx.code)); } },
                  ], (idx.name || displayCode(idx.code))),
                },
                h("span", {
                  className: "sl-grip",
                  "data-sltip": "按住左键拖动排序",
                  onPointerDown: (e) => startDrag(i, e),
                  onClick: (e) => e.stopPropagation(),
                }, "⠿"),
                h("span", { className: "sl-row-name" },
                  h("span", { className: "sl-row-nm" }, h("span", { className: "sl-mkt" }, marketLabel(idx.code)), idx.name || displayCode(idx.code)),
                  h("span", { className: "sl-row-code" }, displayCode(idx.code))),
                h("span", { className: "sl-price " + col }, q ? fmtPrice(q.price) : "--"),
                h("span", { className: "sl-pct " + col }, q ? fmtPct(pct) : "--"),
                h("span", { className: "sl-amt" }, q ? fmtMoney(q.amount, idx.code) : "-"),
                h("span", { className: "sl-turn", "data-sltip": "换手率" }, q && Number.isFinite(q.turnover) ? fmtTurn(q.turnover) : "—"),
              ),
            );
          }),
          dropAt(cfg.indices.length) ? h(DropLine) : null),
        h("div", { className: "sl-addbar" },
          h(SearchBox, {
            placeholder: "搜索添加指数（恒生科技、纳斯达克、北证50…）",
            onPick: (row) => { addIndex(row); toast("已添加 " + row.name); },
          })),
      );
    }

    // ================================================================ 视图：自选
    function WatchView() {
      const s = useStore();
      const cfg = s.config;
      const listRef = useRef(null);
      const { drag, startDrag } = useDragReorder(listRef, (from, to) => reorderList("watchlist", from, to));
      const cap = useListCap(listRef, cfg ? cfg.watchlist.length : 0);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const dropAt = (i) => drag && drag.overAt === i;
      return h(
        "div",
        { className: "sl-watchlist" },
        cfg.watchlist.length === 0 ? h("div", { className: "sl-empty" }, "还没有自选股，在下方搜索添加") : null,
        cfg.watchlist.length > 0
          ? h("div", { className: "sl-hrow" },
              h("span", { className: "sl-h-grip" }),
              h("span", { className: "sl-h-name" }, "股票"),
              h("span", { className: "sl-h-price" }, "现价"),
              h("span", { className: "sl-h-pct" }, "涨幅"),
              h("span", { className: "sl-h-speed" }, "涨速"),
              h("span", { className: "sl-h-amt" }, "成交额"),
              h("span", { className: "sl-h-turn" }, "换手"))
          : null,
        h("div", { className: "sl-sortable" + (cap ? " sl-sortable-cap" : "") + (drag ? " sl-sorting" : ""), ref: listRef, style: cap ? { maxHeight: cap + "px" } : null },
          cfg.watchlist.map((w, i) => {
            const q = s.quotes[w.code];
            const pct = q ? q.percent : null;
            const col = q ? (pct > 0 ? "sl-up" : pct < 0 ? "sl-down" : "sl-flat") : "sl-flat";
            return h(
              react.Fragment,
              { key: w.code },
              dropAt(i) ? h(DropLine) : null,
              h(
                QuoteRow,
                {
                  idx: i,
                  code: w.code,
                  name: (q && q.name) || w.name || displayCode(w.code),
                  quote: q,
                  col,
                  showSpeed: true,
                  dragging: !!(drag && drag.from === i),
                  startDrag,
                  onClick: () => { if (justDragged()) return; openDetail(w.code, w.name); },
                  onDelete: () => { removeWatch(w.code); toast("已删除自选 " + (w.name || w.code)); },
                  onCtx: (e) => openMenu(e, [
                    { label: "📌 置顶", onClick: () => pinTop("watchlist", w.code) },
                    { sep: true },
                    { label: "🗑 删除自选", danger: true, onClick: () => { removeWatch(w.code); toast("已删除自选 " + (w.name || w.code)); } },
                  ], ((q && q.name) || w.name || displayCode(w.code)) + "（" + displayCode(w.code) + "）"),
                },
              ),
            );
          }),
          dropAt(cfg.watchlist.length) ? h(DropLine) : null),
        h("div", { className: "sl-addbar" },
          h(SearchBox, { onPick: (row) => { addWatch(row); toast("已加入自选 " + row.name); } })),
      );
    }

    function QuoteRow(props) {
      const q = props.quote;
      const rowRef = useRef(null);
      const prevPriceRef = useRef(undefined);
      const lastPrice = q ? q.price : null;
      useEffect(() => {
        const prev = prevPriceRef.current;
        prevPriceRef.current = lastPrice;
        if (prev === undefined || prev === null || lastPrice === null || prev === lastPrice) return;
        const el = rowRef.current;
        if (!el) return;
        el.style.setProperty("--row-flash", lastPrice > prev ? "rgba(245,69,92,.25)" : "rgba(30,185,128,.25)");
        el.classList.remove("sl-row-flash");
        void el.offsetWidth; // 重置动画
        el.classList.add("sl-row-flash");
      }, [lastPrice]);
      return h(
        "div",
        {
          ref: rowRef,
          "data-sl-idx": props.idx,
          className: "sl-row sl-sortable-row" + (props.dragging ? " sl-row-dragging" : ""),
          onClick: props.onClick,
          onContextMenu: props.onCtx,
          "data-sltip": q ? "高 " + fmtPrice(q.high) + " · 低 " + fmtPrice(q.low) + "\n今开 " + fmtPrice(q.open) + " · 昨收 " + fmtPrice(q.yestclose) + "\n成交 " + fmtQty(q.volume, q.code) : "",
        },
        h("span", {
          className: "sl-grip",
          "data-sltip": "按住左键拖动排序",
          onPointerDown: (e) => props.startDrag(props.idx, e),
          onClick: (e) => e.stopPropagation(),
        }, "⠿"),
        h("span", { className: "sl-row-name" },
          h("span", { className: "sl-row-nm" }, h("span", { className: "sl-mkt" }, marketLabel(props.code)), props.name),
          h("span", { className: "sl-row-code" }, displayCode(props.code))),
        h("span", { className: "sl-price " + props.col }, q ? fmtPrice(q.price) : "--"),
        h("span", { className: "sl-pct " + props.col }, q ? fmtPct(q.percent) : "--"),
        props.showSpeed
          ? h("span", {
              className: "sl-speed " + (q && Number.isFinite(q.speed) ? (q.speed > 0 ? "sl-up" : q.speed < 0 ? "sl-down" : "sl-flat") : "sl-flat"),
              "data-sltip": "涨速（5分钟）",
            }, q && Number.isFinite(q.speed) ? fmtPct(q.speed) : "—")
          : null,
        h("span", { className: "sl-amt" }, q ? fmtMoney(q.amount, q.code) : "-"),
        h("span", { className: "sl-turn", "data-sltip": "换手率" }, q && Number.isFinite(q.turnover) ? fmtTurn(q.turnover) : "—"),
      );
    }

    // ================================================================ 视图：持仓
    function PositionView() {
      const s = useStore();
      const cfg = s.config;
      const [openCode, setOpenCode] = useState(null); // 展开变动面板的持仓代码
      const [form, setForm] = useState({ side: "buy", price: "", qty: "", date: "" });
      const [curve, setCurve] = useState(null); // 当日盈亏曲线数据
      // 曲线展开状态存在**配置**里，而不是组件本地 state：
      // 切到别的标签页再切回来会重新挂载 PositionView，本地 state 会被重置回默认；
      // 存进配置后跨标签页切换、跨会话重启都能保持用户上次的收起/展开选择。
      const curveOn = cfg ? cfg.pnlCurve !== false : true;
      const listRef = useRef(null);
      const { drag, startDrag } = useDragReorder(listRef, (from, to) => reorderList("positions", from, to));
      // 当日盈亏曲线：拉取各持仓的分时，按 todayPnl 的现金流口径展开
      // 注意：Hooks 必须无条件调用，因此放在 cfg 为空的早返回之前
      const posList = cfg ? cfg.positions : [];
      const posKey = posList.map((p) => p.code + ":" + p.qty + ":" + (p.txns || []).length).join("|");
      const posCap = useListCap(listRef, posList.length);

      // 曲线要跟着行情一起长：右侧端点与末值都随行情变动。
      // 原本依赖里只有 posKey/curveOn，盘中无论行情刷新多少次曲线都纹丝不动。
      //
      // 这里依赖 s.updatedAt（每轮行情推送都会变），但**不直接跟着它跑**：
      // SSE 推送频率高，逐次重拉会把 /minute 打成小 hammers。
      // 故取「一个刷新周期」的 tick 作依赖——窗口用设置里的 pollMs，
      // 用户把刷新间隔调到 3s，曲线就每 3s 跟一次，不会被写死的一分钟拖住。
      // 逻辑抽在 lib/shared.js 的 curveRefreshTick，可被 shared-drift 直接对拍。
      const pollMs = cfg && Number.isFinite(cfg.pollMs) ? cfg.pollMs : 5000;
      const quoteTick = curveRefreshTick(s.updatedAt, pollMs);
      const curveKey = posKey + "@" + quoteTick + "@" + pollMs;
      useEffect(() => {
        if (!curveOn || !posList.length) { setCurve(null); return undefined; }
        let alive = true;
        // 不再 setCurve(null)：重拉时若先清空，曲线会闪一下。
        // 保留旧曲线，等新数据到了再替换。
        Promise.all(
          posList.map((p) =>
            api("/minute", { code: p.code })
              .then((r) => ({ p, r }))
              .catch(() => ({ p, r: null })),
          ),
        ).then((list) => {
          if (!alive) return;
          const rows = [];
          for (const { p, r } of list) {
            if (!r || !Array.isArray(r.points) || r.points.length < 2) continue;
            const q = s.quotes[p.code];
            const today = q ? quoteDate(q) : "";
            const txns = (p.txns || []).filter((t) => t.date === today);
            const yest = Number.isFinite(Number(r.prevClose)) ? Number(r.prevClose) : null;
            if (yest === null) continue;
            let buyAmt = 0, sellAmt = 0, net = 0;
            for (const t of txns) { net += t.qty; if (t.qty > 0) buyAmt += t.price * t.qty; else sellAmt += t.price * -t.qty; }
            // 注意：这里**不存实时价**。curve 只放 /minute 的形状（分钟粒度，很少变）；
            // 实时价由 PnlCurve 在渲染时从 quotes 现取，
            // 这样曲线末端才能跟着刷新间隔每次推送都动，而不是等下次重拉分时才更新。
            rows.push({
              code: p.code,
              series: r.points.map((pt) => ({ t: pt.t, p: pt.p })),
              yest,
              qty: p.qty || 0,
              heldYest: (p.qty || 0) - net,
              buyAmt,
              sellAmt,
            });
          }
          setCurve(rows);
        });
        return () => { alive = false; };
      }, [curveKey, curveOn]);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      let totalCost = 0, totalValue = 0, totalToday = 0, totalRealized = 0;
      const rows = cfg.positions.map((p) => {
        const q = s.quotes[p.code];
        const price = q ? q.price : null;
        const cost = p.cost || 0;
        const qty = p.qty || 0;
        const mv = price !== null && qty ? price * qty : 0;
        // 清仓（qty=0）：市值与浮盈都归零，但累计盈亏要接住已实现部分，
        // 否则「累计」会在清仓瞬间从 +X 跳成 0，与顶部总览口径也对不上。
        const rp = qty ? 0 : realizedPnl(p, q);
        const pnl = cost && qty && price !== null ? (price - cost) * qty : rp;
        const pnlPct = cost && price !== null && qty ? ((price - cost) / cost) * 100 : null;
        const today = price !== null ? todayPnl(p, q) : 0;
        const yestValue = mv - today; // 昨收市值 = 现市值 − 今日盈亏
        const todayPct = qty && yestValue > 0 ? (today / yestValue) * 100 : null;
        const txnCount = (p.txns || []).length;
        const todayTxn = (p.txns || []).filter((t) => q && t.date === quoteDate(q)).length;
        totalCost += cost * qty;
        totalValue += mv;
        totalToday += today;
        totalRealized += rp;
        return { p, q, price, mv, pnl, pnlPct, today, todayPct, txnCount, todayTxn, closed: !qty };
      });
      const totalPnl = totalValue - totalCost + totalRealized;
      const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null;
      const sign = (v) => (v > 0 ? "sl-up" : v < 0 ? "sl-down" : "sl-flat");
      const resetForm = () => setForm({ side: "buy", price: "", qty: "", date: "" });
      const submitTxn = (p) => {
        const q = s.quotes[p.code];
        const date = form.date || quoteDate(q) || "";
        const ok = addTxn(p.code, { side: form.side, price: parseFloat(form.price), qty: parseInt(form.qty, 10), date, time: quoteClock(q) });
        if (ok) {
          toast((form.side === "sell" ? "已记卖出 " : "已记买入 ") + Math.abs(parseInt(form.qty, 10)) + " 股 @" + form.price);
          resetForm();
        }
      };
      const dropAt = (i) => drag && drag.overAt === i;
      return h(
        "div",
        null,
        cfg.positions.length === 0
          ? h("div", { className: "sl-empty" }, "还没有持仓：下方搜索添加后，右键该行编辑成本价与股数")
          : h(
              "div",
              { className: "sl-total" },
              h("span", { "data-sltip": "总市值 " + fmtExact(totalValue) + " 元" }, "市值 ", h("b", null, totalValue.toFixed(0))),
              h("span", { className: sign(totalToday), "data-sltip": "今日收益 " + fmtMoneyExact(totalToday) + " 元\n按当日买卖变动计算" }, "今日 ", h("b", null, (totalToday >= 0 ? "+" : "") + totalToday.toFixed(0))),
              h("span", { className: sign(totalPnl), "data-sltip": "累计盈亏 " + fmtMoneyExact(totalPnl) + " 元" + (totalPnlPct !== null ? "（" + fmtPct(totalPnlPct) + "）" : "") + "\n总成本 " + fmtExact(totalCost) + " 元" }, "累计 ", h("b", null, (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(0)), totalPnlPct !== null ? "（" + fmtPct(totalPnlPct) + "）" : ""),
            ),
        // 当日盈亏走势：能看出今天几点开始赚 / 从哪里开始亏
        cfg.positions.length
          ? h("div", { className: "sl-pnlcurve" },
              h("div", { className: "sl-pnlcurve-head" },
                h("span", {
                  style: { fontSize: 10, color: "var(--sl-muted)" },
                  "data-sltip": "把每只持仓的今日盈亏按分钟展开\n口径与上方「今日」一致（含当日买卖现金流）\n零轴 = 今日不赚不亏",
                }, "今日盈亏走势"),
                h("button", {
                  className: "sl-mini-btn",
                  onClick: () => updateConfig((c) => { c.pnlCurve = !curveOn; return c; }),
                  "data-sltip": curveOn ? "点击收起曲线" : "点击展开曲线（会拉取各持仓分时）",
                }, curveOn ? "收起" : "展开")),
              curveOn ? h(PnlCurve, { rows: curve || [], quotes: s.quotes }) : null)
          : null,
        h("div", { className: "sl-headrow" }, h("span", null, ""), h("span", null, "持仓"), h("span", null, "成本/现价"), h("span", null, "股数"), h("span", null, "市值/涨幅"), h("span", null, "盈亏"), h("span", null, "今日")),
        h("div", { className: "sl-sortable" + (posCap ? " sl-sortable-cap" : "") + (drag ? " sl-sorting" : ""), ref: listRef, style: posCap ? { maxHeight: posCap + "px" } : null },
          rows.map(({ p, q, price, mv, pnl, pnlPct, today, todayPct, txnCount, todayTxn }, i) => {
            const expanded = openCode === p.code;
            return h(
              react.Fragment,
              { key: p.code },
              dropAt(i) ? h(DropLine) : null,
              h(
                "div",
                {
                  "data-sl-idx": i,
                  className: "sl-pos" + (txnCount ? " sl-pos-has-txn" : "") + (drag && drag.from === i ? " sl-row-dragging" : ""),
                  onContextMenu: (e) => openMenu(e, [
                    { label: "📌 置顶", onClick: () => pinTop("positions", p.code) },
                    { label: "✎ 编辑成本 / 股数", onClick: () => openEditPos(p) },
                    { label: txnCount ? "⇅ 变动记录（" + txnCount + " 笔）" : "⇅ 添加买卖变动", onClick: () => { setOpenCode(expanded ? null : p.code); resetForm(); } },
                    { sep: true },
                    { label: "🗑 删除持仓", danger: true, onClick: () => { removePosition(p.code); toast("已删除持仓 " + (p.name || p.code)); } },
                  ], ((q && q.name) || p.name || displayCode(p.code)) + "（" + displayCode(p.code) + "）"),
                },
                h("span", {
                  className: "sl-grip",
                  "data-sltip": "按住左键拖动排序",
                  onPointerDown: (e) => startDrag(i, e),
                  onClick: (e) => e.stopPropagation(),
                }, "⠿"),
                h("div", {
                  style: { minWidth: 0, cursor: "pointer" },
                  onClick: () => { if (justDragged()) return; openDetail(p.code, p.name); },
                  "data-sltip": q ? "点击查看走势\n右键：编辑成本/股数、置顶、删除" : "点击查看走势",
                },
                  h("div", { className: "sl-row-nm", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                    h("span", { className: "sl-mkt" }, marketLabel(p.code)), (q && q.name) || p.name || displayCode(p.code)),
                  h("div", { style: { display: "flex", justifyContent: "flex-start", gap: 6 } },
                    h("span", { className: "sl-row-code" }, displayCode(p.code)))),
                // 成本/现价：上成本 下现价
                h("span", { className: "sl-pos2", "data-sltip": "成本 " + (p.cost ? fmtPrice(p.cost) : "—") + " / 现价 " + (q ? fmtPrice(price) : "—") + "\n右键编辑成本、股数" },
                  h("span", { className: "sl-l1" + (p.cost ? "" : " sl-flat") }, p.cost ? fmtPrice(p.cost) : "—"),
                  h("span", { className: "sl-l2 " + (q ? (q.percent > 0 ? "sl-up" : q.percent < 0 ? "sl-down" : "sl-flat") : "sl-flat") }, q ? fmtPrice(price) : "—")),
                // 股数
                h("span", { className: "sl-pos-num", "data-sltip": "持股 " + (p.qty ? p.qty.toLocaleString("en-US") + " 股" : "—") + "\n右键编辑" }, p.qty ? String(p.qty) : "—"),
                // 市值/涨幅：上实时市值 下当日涨跌%（悬浮显示精确市值）
                h("span", { className: "sl-pos2", "data-sltip": "实时市值 " + (mv ? fmtExact(mv) + " 元" : "—") + "\n当日涨幅 " + (q ? fmtPct(q.percent) : "—") },
                  h("span", { className: "sl-l1" }, mv ? fmtSigned0(mv) : "—"),
                  h("span", { className: "sl-l2 " + (q ? (q.percent > 0 ? "sl-up" : q.percent < 0 ? "sl-down" : "sl-flat") : "sl-flat") }, q ? fmtPct(q.percent) : "—")),
                // 盈亏：上金额 下百分比（悬浮显示精确盈亏金额）
                h("span", { className: "sl-pos2", "data-sltip": pnlPct !== null ? "累计盈亏 " + fmtMoneyExact(pnl) + " 元（" + fmtPct(pnlPct) + "）\n成本 " + fmtPrice(p.cost) + " × " + p.qty + " 股" : "右键编辑成本价与股数后计算" },
                  h("span", { className: "sl-l1 " + (p.cost && p.qty && price !== null ? sign(pnl) : "sl-flat") }, p.cost && p.qty && price !== null ? fmtSigned(pnl) : "—"),
                  h("span", { className: "sl-l2 " + (pnlPct !== null ? sign(pnlPct) : "sl-flat") }, pnlPct !== null ? fmtPct(pnlPct) : "—")),
                // 今日：上金额 下百分比（悬浮显示精确今日盈亏）
                h("span", { className: "sl-pos2", "data-sltip": (price !== null && (p.qty || txnCount) ? "今日盈亏 " + fmtMoneyExact(today) + " 元" + (todayPct !== null ? "（" + fmtPct(todayPct) + "）" : "") : "按当日买卖变动计算") + (todayTxn ? "\n含 " + todayTxn + " 笔当日变动" : "") },
                  h("span", { className: "sl-l1 " + (price !== null && (p.qty || txnCount) ? sign(today) : "sl-flat") }, price !== null && (p.qty || txnCount) ? fmtSigned(today) : "—"),
                  h("span", { className: "sl-l2 " + (todayPct !== null ? sign(todayPct) : "sl-flat") }, todayPct !== null ? fmtPct(todayPct) : "—")),
              ),
              expanded
                ? h(TxnPanel, { p, q, form, setForm, resetForm, submitTxn, removeTxn, quoteDate, todayDate: quoteDate(q) })
                : null,
            );
          }),
          dropAt(cfg.positions.length) ? h(DropLine) : null),
        h("div", { className: "sl-addbar" },
          h(SearchBox, { placeholder: "搜索添加持仓股…", onPick: (row) => { addPosition(row); toast("已添加持仓 " + row.name + "，右键该行可编辑成本/股数"); } })),
      );
    }

    /** 持仓变动面板：列出历史买卖 + 新增买入/卖出表单（卖出记为负股数，可多条） */
    function TxnPanel(props) {
      const { p, q, form, setForm, submitTxn, removeTxn, todayDate } = props;
      const txns = (p.txns || []).slice().reverse(); // 最新在前
      const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
      return h(
        "div",
        { className: "sl-txn-panel" },
        txns.length === 0
          ? h("div", { className: "sl-txn-empty" }, "暂无变动记录。今日收益按当日变动计算。")
          : h(
              "div",
              { className: "sl-txn-list" },
              txns.map((t) =>
                h(
                  "div",
                  { key: t.id, className: "sl-txn-row" },
                  h("span", { className: "sl-txn-side " + (t.qty > 0 ? "sl-up" : "sl-down") }, t.qty > 0 ? "买" : "卖"),
                  h("span", { className: "sl-txn-date" }, t.date || "-"),
                  h("span", { className: "sl-txn-num" }, "@" + fmtPrice(t.price)),
                  h("span", { className: "sl-txn-num" }, Math.abs(t.qty) + "股"),
                  h("span", { className: "sl-txn-amt" }, fmtMoney(Math.abs(t.price * t.qty), "")),
                  t.date === todayDate ? h("span", { className: "sl-txn-today" }, "今") : null,
                  h("button", { className: "sl-x", "data-sltip": "删除该变动", onClick: () => removeTxn(p.code, t.id) }, "✕"),
                ),
              ),
            ),
        h(
          "div",
          { className: "sl-txn-form" },
          h("span", { className: "sl-seg sl-txn-seg" },
            [["buy", "买入"], ["sell", "卖出"]].map(([v, t]) =>
              h("button", { key: v, className: form.side === v ? "on" : "", onClick: () => set("side", v) }, t))),
          h("input", { className: "sl-mini sl-txn-price", type: "number", step: "0.001", min: "0", placeholder: "价格", value: form.price, onChange: (e) => set("price", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-qty", type: "number", step: "100", min: "0", placeholder: "股数", value: form.qty, onChange: (e) => set("qty", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-date-input", type: "date", value: form.date || todayDate || "", onChange: (e) => set("date", e.target.value), "data-sltip": "变动日期（默认今日）" }),
          h("button", { className: "sl-btn sl-txn-add", onClick: () => submitTxn(p) }, "＋记一笔"),
        ),
      );
    }

    // ================================================================ 视图：设置
    function SettingsView() {
      const s = useStore();
      const cfg = s.config;
      const [probe, setProbe] = useState(null);
      const [probing, setProbing] = useState(false);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const seg = (label, options, value, onChange) =>
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, label),
          h("span", { className: "sl-seg" }, options.map(([v, t]) =>
            h("button", { key: v, className: v === value ? "on" : "", onClick: () => onChange(v) }, t))));
      return h(
        "div",
        { className: "sl-set" },
        // 配置损坏告警：常驻顶部，不随 toast 消失
        s.configWarning
          ? h("div", { className: "sl-warn" },
              h("span", { style: { flex: 1, minWidth: 0 } }, "⚠ " + s.configWarning.text),
              h("button", { className: "sl-x", "data-sltip": "我已知晓并要处理（关闭该提示）", onClick: () => dismissConfigWarning() }, "✕"))
          : null,
        seg("对话左下角指数栏", [["on", "显示"], ["off", "隐藏"]], cfg.barVisible ? "on" : "off",
          (v) => updateConfig((c) => { c.barVisible = v === "on"; return c; })),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "放置方式"),
          h("span", { className: "sl-seg" }, [
            ["floating", "悬浮锚定", "悬浮锚定：自动跟随对话输入区左下角，新会话页与已有对话都显示。"],
            ["dock", "嵌入输入框", "嵌入输入框：作为平台 composer.dock 槽位内容，仅在「已有对话」显示（新会话页该槽位宿主不渲染，属平台限制）。"],
          ].map(([v, t, tip]) =>
            h("button", { key: v, className: s.barPlacement === v ? "on" : "", "data-sltip": tip, onClick: () => setBarPlacement(v) }, t)))),
        seg("指数栏样式", [["full", "点位+涨跌"], ["compact", "仅涨跌幅"]], cfg.barStyle,
          (v) => updateConfig((c) => { c.barStyle = v; return c; })),
        seg("指数栏位置", [["left", "居左"], ["center", "居中"], ["right", "居右"]], cfg.barAlign,
          (v) => updateConfig((c) => { c.barAlign = v; return c; })),
        seg("刷新间隔", [[3000, "3s"], [5000, "5s"], [10000, "10s"], [30000, "30s"], [60000, "60s"]], cfg.pollMs,
          (v) => updateConfig((c) => { c.pollMs = v; return c; })),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "涨色 / 跌色"),
          h("span", { style: { display: "flex", gap: 8, alignItems: "center" } },
            h("input", { className: "sl-color", type: "color", value: cfg.riseColor, onChange: (e) => updateConfig((c) => { c.riseColor = e.target.value; return c; }) }),
            h("input", { className: "sl-color", type: "color", value: cfg.fallColor, onChange: (e) => updateConfig((c) => { c.fallColor = e.target.value; return c; }) }))),
        h("div", { className: "sl-setrow" },
          h("button", {
            className: "sl-btn", disabled: probing,
            onClick: async () => {
              setProbing(true);
              try { setProbe(await api("/probe")); } catch (e) { setProbe({ ok: false, checks: [{ label: "请求失败", ok: false, detail: String(e.message || e) }] }); }
              setProbing(false);
            },
          }, probing ? "测试中…" : "🔌 测试数据源"),
          h("button", {
            className: "sl-btn sl-btn-ghost",
            onClick: () => { if (confirm("恢复默认配置？自选/持仓将被清空。")) { localStorage.removeItem(LS_CONFIG); updateConfig(() => ({ version: 1, indices: [], barIndices: [], watchlist: [], positions: [], pollMs: 5000, riseColor: "#f5455c", fallColor: "#1eb980", barStyle: "full", barAlign: "left", barPlacement: "floating", barVisible: true, remind: true, pnlCurve: true })); } },
          }, "恢复默认")),
        probe
          ? h("div", { className: "sl-note" },
              probe.checks.map((c, i) => h("div", { key: i }, (c.ok ? "✓ " : "✗ ") + c.label + "（" + c.ms + "ms）： " + c.detail)),
              probe.configPath ? "配置文件：" + probe.configPath : "")
          : null,
      );
    }

    // ================================================================ 视图：个股详情
    function DetailView(props) {
      const s = useStore();
      const { code, name } = props.detail;
      const [period, setPeriod] = useState("minute");
      const [minute, setMinute] = useState(null);
      const [kline, setKline] = useState(null);
      const [candle, setCandle] = useState(null); // K线中选中/钉住的那一根（顶部指标区显示其信息）
      const cfg = s.config;
      // MA 选择存于全局配置 cfg.ma（跨股票/周期/会话保持）
      const maList = Array.isArray(cfg && cfg.ma) ? cfg.ma : MA_DEF;
      const maOn = {};
      for (const p of MA_ALL) maOn[p] = maList.indexOf(p) >= 0;
      const pos = cfg ? cfgFind(cfg.positions, code) : null; // 当前股票的持仓（用于成本线）
      const q = s.quotes[code];
      useEffect(() => {
        let alive = true;
        setMinute(null); setKline(null); setCandle(null);
        if (period === "minute") {
          api("/minute", { code }).then((r) => { if (alive) setMinute(r); }).catch(() => { if (alive) setMinute({ points: [], error: "获取失败" }); });
        } else {
          api("/kline", { code, period, count: 120 }).then((r) => { if (alive) setKline(r); }).catch(() => { if (alive) setKline({ candles: [], error: "获取失败" }); });
        }
        return () => { alive = false; };
      }, [code, period]);
      const col = q ? (q.percent > 0 ? "var(--sl-up)" : q.percent < 0 ? "var(--sl-down)" : "var(--sl-flat)") : "var(--sl-flat)";
      const chart =
        period === "minute"
          ? minute === null
            ? h("div", { className: "sl-empty" }, "分时加载中…")
            : h(MinuteChart, { points: minute.points, prevClose: minute.prevClose, color: col, height: 180 })
          : kline === null
            ? h("div", { className: "sl-empty" }, "K线加载中…")
            : h(KlineChart, { candles: kline.candles, error: kline.error, symbol: code, period: period, height: 200, riseColor: cfg ? cfg.riseColor : null, fallColor: cfg ? cfg.fallColor : null, ma: maList, cost: pos ? pos.cost || null : null, onCandle: setCandle });
      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", minHeight: 0 } },
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ detail: null }) }, "← 返回"),
            h("span", { className: "sl-dname" }, (q && q.name) || name || displayCode(code)),
            h("span", { style: { color: "var(--sl-muted)" } }, displayCode(code)),
            h("span", { style: { flex: 1 } }),
            pos && pos.cost
              ? h("span", {
                  className: "sl-cost-badge",
                  style: { color: q && q.price >= pos.cost ? "var(--sl-up)" : "var(--sl-down)" },
                  "data-sltip": "持仓成本 " + fmtPrice(pos.cost) + "（" + pos.qty + " 股）\nK 线图中的虚线即成本价，现价在其下方时变红",
                }, "成本 " + fmtPrice(pos.cost))
              : null,
            h("span", { className: "sl-dprice", style: { color: col } }, q ? fmtPrice(q.price) : "--"),
            h("span", { style: { color: col, fontWeight: 600 } }, q ? fmtPct(q.percent) : "")),
          // 顶部指标区：选中 K 线时显示该根信息，否则显示当日行情
          h("div", { className: "sl-stats" },
            candle
              ? [
                  ["日期", candle.time],
                  ["开", fmtPrice(candle.open)], ["高", fmtPrice(candle.high)],
                  ["低", fmtPrice(candle.low)], ["收", fmtPrice(candle.close)],
                  ["涨跌", (candle.chg >= 0 ? "+" : "") + fmtPrice(candle.chg)],
                  ["幅", candle.chgPct !== null ? fmtPct(candle.chgPct) : "—"],
                  ["量", fmtQty(candle.volume, code)],
                  candle.amp !== null ? ["振幅", fmtPct(candle.amp)] : null,
                ].filter(Boolean).map(([k, v]) => h("span", { key: k }, k + " ", h("b", { style: k === "涨跌" || k === "幅" ? { color: candle.close >= candle.open ? "var(--sl-up)" : "var(--sl-down)" } : null }, v)))
              : q
                ? [
                    ["今开", fmtPrice(q.open)], ["昨收", fmtPrice(q.yestclose)], ["最高", fmtPrice(q.high)], ["最低", fmtPrice(q.low)],
                    ["成交", fmtQty(q.volume, code)], ["金额", fmtMoney(q.amount, code)],
                    q.turnover !== null && q.turnover !== undefined ? ["换手", q.turnover + "%"] : null,
                    q.pe ? ["PE", q.pe] : null, q.pb ? ["PB", q.pb] : null,
                  ].filter(Boolean).map(([k, v]) => h("span", { key: k }, k + " ", h("b", null, v)))
                : h("span", null, "行情获取中…"),
            h("span", { style: { width: "100%" } }, candle ? "已选中该根 K 线 · 双击图表或点击空白处取消" : "更新时间：" + fmtTime(q && q.time)),
          ),
          h("div", { className: "sl-tabs", style: { padding: "2px 0" } },
            [["minute", "分时"], ["day", "日K"], ["week", "周K"], ["month", "月K"]].map(([p, t]) =>
              h("button", { key: p, className: "sl-tab" + (period === p ? " sl-tab-on" : ""), onClick: () => setPeriod(p) }, t)),
            period !== "minute"
              ? h("span", { style: { display: "inline-flex", gap: 2, marginLeft: "auto" } },
                  [5, 10, 20, 60].map((p) =>
                    h("button", { key: p, className: "sl-tab" + (maOn[p] ? " sl-tab-on" : ""), style: { padding: "1px 6px", fontSize: 10 }, onClick: () => toggleMa(p) }, "MA" + p)))
              : null),
        ),
        h("div", { className: "sl-chartbox" }, chart),
      );
    }

    /**
     * 标题栏数据新鲜度徽标：显示「距上次成功拿到行情已过去多久」。
     * - 语义是正计时（越大越旧），不是倒计时；上限约等于设置的刷新间隔 pollMs。
     * - 自带 1s ticker 驱动自身重渲染，避免数字僵住不动（旧实现只在别的状态变化时才重算）。
     * - 只在悬浮窗打开时挂载（Overlay 里 s.open 为真才渲染），面板关闭后不留空转定时器。
     * - updatedAt 为 0（从未拿到数据）时显示 —，避免 Date.now()-0 算出天文数字。
     */
    function FreshBadge(props) {
      const { updatedAt, pollMs } = props;
      const [, setTick] = useState(0);
      useEffect(() => {
        if (!updatedAt) return undefined;
        const iv = setInterval(() => setTick((t) => (t + 1) % 1000000), 1000);
        return () => clearInterval(iv);
      }, [updatedAt]);
      if (!updatedAt) return h("span", { className: "sl-fresh", "data-sltip": "尚未获取到行情" }, "⏱—");
      const age = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
      // 超过 2 个刷新周期（且至少 12s）视为陈旧，标黄提醒；休市时行情本就停更，不做强提示
      const limit = Math.max(12, Math.round((pollMs || 5000) / 1000) * 2);
      const stale = age > limit;
      return h("span", {
        className: "sl-fresh" + (stale ? " sl-fresh-stale" : ""),
        "data-sltip": (stale ? "行情已 " + age + "s 未更新（超过 " + limit + "s）\n可能已休市或推送中断，点 ⟳ 手动刷新" : "行情 " + age + "s 前更新") + "\n刷新间隔 " + Math.round((pollMs || 5000) / 1000) + "s",
      }, "⏱" + age + "s");
    }

    // ================================================================ 悬浮窗（shell.overlay）
    function Overlay(props) {
      const s = useStore();
      // 所有 hooks 必须无条件在顶层调用：若放进 s.detail 等条件分支，切换详情会改变
      // 本组件 hook 数量 → React 抛 "Rendered more hooks…" → 整棵 overlay 崩溃卸载。
      const [pos, setPos] = useState(() => {
        try {
          const raw = localStorage.getItem(LS_POS);
          if (raw) {
            const p = JSON.parse(raw);
            if (typeof p.x === "number" && typeof p.y === "number") return p;
          }
        } catch { /* ignore */ }
        return null;
      });
      const dragRef = useRef(null);
      useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current;
          if (!d) return;
          const x = clamp(e.clientX - d.dx, 8, window.innerWidth - 120);
          const y = clamp(e.clientY - d.dy, 8, window.innerHeight - 60);
          setPos({ x, y });
        };
        const onUp = () => {
          if (dragRef.current) {
            dragRef.current = null;
            setPos((p) => {
              try { if (p) localStorage.setItem(LS_POS, JSON.stringify(p)); } catch { /* ignore */ }
              return p;
            });
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
      }, []);
      useEffect(() => { initStore(); }, []);
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === "Escape" && state.detail) setState({ detail: null });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, []);
      if (!s.open) return null;
      // 手动位置同样只在渲染时钳进视口，**不回写 localStorage**：
      // 缩小时贴边显示，放大后自动回到用户原来的位置。
      const style = pos
        ? {
            left: clamp(pos.x, 8, Math.max(8, window.innerWidth - 120)),
            top: clamp(pos.y, 8, Math.max(8, window.innerHeight - 60)),
            right: "auto",
          }
        : { right: 16, top: 52 };
      const vars = s.config ? { "--sl-up": s.config.riseColor || "#f5455c", "--sl-down": s.config.fallColor || "#1eb980" } : undefined;
      const themeBtn = h("button", {
        className: "sl-icon", "data-sltip": "切换主题",
        onClick: () => {
          const next = state.theme === "dark" ? "light" : "dark";
          setState({ theme: next });
          try { localStorage.setItem(LS_THEME, next); } catch { /* ignore */ }
        },
      }, s.theme === "dark" ? "☀" : "🌙");
      // 标题随今日盈亏变脸（彩蛋）；无持仓/休市无变动时保持默认名
      const earn = s.config ? computeEarnings(s.config, s.quotes) : null;
      const mood = moodTitle(earn);
      const moodTip = earn && earn.has
        ? "今日盈亏 " + fmtMoneyExact(earn.today) + " 元\n标题会随今日战况变脸：赚钱加鸡腿 · 亏钱关灯吃面"
        : "添加持仓并填写成本/股数后，标题会随今日战况变脸 🍗🍜";
      return h(
        "div",
        {
          className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""),
          style: Object.assign({ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9990 }, vars || {}),
        },
        h(
          "div",
          { className: "sl-panel", style: Object.assign({ pointerEvents: "auto" }, style) },
          h(
            "div",
            {
              className: "sl-head",
              onPointerDown: (e) => {
                if (e.target.closest("button")) return;
                const rect = e.currentTarget.parentElement.getBoundingClientRect();
                dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
              },
            },
            h("span", { className: "sl-title", "data-sltip": moodTip }, mood),
            h("span", { className: "sl-tabs" },
              [["market", "大盘"], ["watch", "自选"], ["position", "持仓"], ["settings", "设置"]].map(([t, label]) =>
                h("button", { key: t, className: "sl-tab" + (s.tab === t && !s.detail ? " sl-tab-on" : ""), onClick: () => setState({ tab: t, detail: null }) }, label))),
            h(FreshBadge, { updatedAt: s.updatedAt, pollMs: s.config && s.config.pollMs }),
            h("button", { className: "sl-icon", "data-sltip": "立即刷新", onClick: () => refreshQuotes() }, "⟳"),
            themeBtn,
            h("button", { className: "sl-icon", "data-sltip": "关闭", onClick: closeOverlay }, "✕"),
          ),
          h("div", { className: "sl-body" },
            s.detail
              ? h(DetailView, { detail: s.detail })
              : s.tab === "market" ? h(MarketView) : s.tab === "watch" ? h(WatchView) : s.tab === "position" ? h(PositionView) : h(SettingsView)),
          h("div", { className: "sl-foot" },
            h("span", null, s.error ? "⚠ " + s.error : "腾讯行情"),
            h("span", null, s.updatedAt ? "更新 " + new Date(s.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—")),
        ),
        s.toast ? h("div", { key: s.toast.id, className: "sl-toast", style: s.toast.color ? { color: s.toast.color } : undefined }, s.toast.text) : null,
        s.sug ? h(SearchSuggest, { sug: s.sug, theme: s.theme }) : null,
        h(ContextMenu, { menu: s.menu }),
        h(EditPosDialog),
      );
    }

    // ================================================================ 指数栏（左下角）
    /** 共享的指数栏内容（大盘圆点 + 指数胶囊 + 📈/⚙ 按钮）。dock 与 floating 两种放置复用。 */
    function renderBarContent(s, cfg, gearProps) {
      const items = cfg.barIndices.map((code) => ({ idx: cfgFind(cfg.indices, code) || { code, name: displayCode(code) }, q: s.quotes[code] })).filter((x) => x.idx);
      const anyOpen = items.some((x) => isMarketOpen(x.idx.code));
      const earn = computeEarnings(cfg, s.quotes);
      return h(
        "div",
        { className: "sl-bar sl-align-" + (cfg.barAlign || "left") },
        h("span", { className: "sl-bar-dot" + (anyOpen ? " sl-open" : ""), "data-sltip": anyOpen ? "盘中" : "已收盘/休市", style: { flex: "none" } }),
        items.length === 0
          ? h("span", { className: "sl-chip", onClick: () => openOverlay("market"), "data-sltip": "点击选择要常驻显示的大盘指数" }, "＋ 选择指数显示在这里")
          : items.map(({ idx, q }) =>
              h(IndexChip, { key: idx.code, idx, q, theme: s.theme, onOpen: () => openOverlay("market") })),
        earn.has
          ? h(EarnChip, { cfg, quotes: s.quotes, theme: s.theme })
          : null,
        h("button", Object.assign({ className: "sl-bar-btn", "data-sltip": "设置", onClick: () => openOverlay("settings") }, gearProps || {}), "⚙"),
      );
    }
    /**
     * 收益胶囊：hover 弹出浮层展示 市值 / 累计收益(+%) / 今日，以及每只持仓的收益与盈亏%。
     * 浮层 fixed 定位到胶囊上方（不受指数栏 overflow/maxWidth 裁切），点击进持仓管理。
     */
    function EarnChip(props) {
      const [hover, setHover] = useState(false);
      const [rect, setRect] = useState(null);
      const chipRef = useRef(null);
      const hideTimer = useRef(null);
      const detail = useMemo(() => earningsDetail(props.cfg, props.quotes), [props.cfg, props.quotes]);
      const show = () => {
        clearTimeout(hideTimer.current);
        if (chipRef.current) {
          const r = chipRef.current.getBoundingClientRect();
          setRect({ left: r.left, bottom: window.innerHeight - r.top + 8 });
        }
        setHover(true);
      };
      const scheduleHide = () => {
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setHover(false), 160);
      };
      useEffect(() => () => clearTimeout(hideTimer.current), []);
      const sign = (v) => (v > 0 ? "sl-up" : v < 0 ? "sl-down" : "sl-flat");
      return h(
        react.Fragment,
        null,
        h("span", {
          ref: chipRef,
          className: "sl-chip sl-chip-earn",
          onClick: () => openOverlay("position"),
          onMouseEnter: show,
          onMouseLeave: scheduleHide,
        },
          h("span", { className: "sl-chip-name" }, "💰收益"),
          h("span", { className: "sl-chip-pct " + (detail.today > 0 ? "sl-up" : detail.today < 0 ? "sl-down" : "sl-flat") }, "今" + fmtSigned(detail.today))),
        hover && rect
          ? h("div", {
              className: "sl-root sl-pop" + (props.theme === "light" ? " sl-light" : ""),
              style: { position: "fixed", left: rect.left, bottom: rect.bottom, zIndex: 9995 },
              onMouseEnter: show,
              onMouseLeave: scheduleHide,
            },
              h("div", { className: "sl-pop-head" },
                h("span", null, "市值"),
                h("b", null, fmtSigned0(detail.value))),
              h("div", { className: "sl-pop-head" },
                h("span", null, "累计收益"),
                h("b", { className: sign(detail.pnl) }, fmtSigned(detail.pnl) + (detail.pnlPct !== null ? "（" + fmtPct(detail.pnlPct) + "）" : ""))),
              h("div", { className: "sl-pop-head" },
                h("span", null, "今日收益"),
                h("b", { className: sign(detail.today) }, fmtSigned(detail.today) + (detail.todayPct !== null ? "（" + fmtPct(detail.todayPct) + "）" : ""))),
              detail.rows.length > 0 ? h("div", { className: "sl-pop-sep" }) : null,
              // 每只持仓：今日盈亏 + 当日涨幅（累计与成本/市值等明细见行悬浮提示）
              detail.rows.map((r) =>
                h("div", {
                  key: r.code, className: "sl-pop-row",
                  // 已清仓：市值归零但今日/累计是已实现盈亏，必须显式说明，
                  // 否则用户以为这只票的收益被系统吞了
                  "data-sltip": r.name + "（" + displayCode(r.code) + "）" + (r.closed ? "　已清仓" : "")
                    + "\n今日 " + fmtMoneyExact(r.today) + " 元" + (r.todayPct !== null ? "（" + fmtPct(r.todayPct) + "）" : "")
                    + "\n累计 " + fmtMoneyExact(r.pnl) + " 元" + (r.pnlPct !== null ? "（" + fmtPct(r.pnlPct) + "）" : "")
                    + "\n成本 " + (r.cost ? fmtPrice(r.cost) : "—") + " × " + r.qty + " 股 · 现价 " + fmtPrice(r.price) + " · 市值 " + fmtExact(r.mv) + " 元",
                },
                  h("span", { className: "sl-pop-nm" }, r.name + (r.closed ? "（已清仓）" : "")),
                  h("span", { className: "sl-pop-pnl " + sign(r.today) }, fmtSigned(r.today) + " " + fmtPrice(r.price) + (r.todayPct !== null ? " " + fmtPct(r.todayPct) : "")))),
              h("div", { className: "sl-pop-foot" }, "点击管理持仓"),
            )
          : null,
      );
    }
    /** 金额（无正负号，万亿/亿/万，保留 0 位） */
    function fmtSigned0(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      const a = Math.abs(n);
      if (a >= 1e8) return (a / 1e8).toFixed(2) + "亿";
      if (a >= 1e4) return (a / 1e4).toFixed(2) + "万";
      return a.toFixed(0);
    }
    /** 精确金额（带正负号 + 千分位，元）：用于万/亿简写金额的悬浮提示 */
    function fmtMoneyExact(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      const sign = n > 0 ? "+" : n < 0 ? "-" : "";
      const a = Math.round(Math.abs(n));
      return sign + a.toLocaleString("en-US");
    }
    /** 精确金额（无符号 + 千分位，元）：用于市值/成本等恒正金额 */
    function fmtExact(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      return Math.round(n).toLocaleString("en-US");
    }
    function rootProps(s, cfg, extraStyle) {
      return {
        className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""),
        style: Object.assign({ "--sl-up": cfg.riseColor || "#f5455c", "--sl-down": cfg.fallColor || "#1eb980" }, extraStyle || {}),
      };
    }

    /** 汇总持仓收益：{ has, cost, value, today, realized, pnl, pnlPct }（依赖已填成本/股数的持仓） */
    function computeEarnings(cfg, quotes) {
      let cost = 0, value = 0, today = 0, realized = 0, has = false;
      for (const p of cfg.positions || []) {
        const q = quotes[p.code];
        if (!q) continue; // 没行情：整只跳过，不能凭空造数
        const qty = p.qty || 0;
        const c = p.cost || 0;
        // 今日盈亏与是否持仓无关：清仓股当天卖出的钱是真实盈亏，
        // 不能因为 qty 归零就从汇总里抹掉（这是清仓后收益消失的根因）。
        const td = todayPnl(p, q);
        today += td;
        if (!qty) {
          // 清仓：市值/成本按 0 计，但已实现盈亏要接住，否则累计会凭空归零
          realized += realizedPnl(p, q);
          if (td !== 0) has = true; // 今天动过这只，界面仍需展示汇总
          continue;
        }
        has = true;
        cost += c * qty;
        value += q.price * qty;
      }
      const pnl = value - cost + realized;
      return { has, cost, value, today, realized, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null };
    }
    /**
     * 悬浮窗标题随今日盈亏「变脸」（纯 UI 彩蛋，不影响任何数据）：
     *   无持仓/持平 → 📈 观望中 · 盈利 → 🍗 加鸡腿（≥3% 🚀 起飞了）· 亏损 → 🍜 关灯吃面（≤−3% 🧘 天台吹风）
     * 当日涨幅口径与持仓页一致：今日盈亏 ÷ 昨收市值（昨收市值 = 现市值 − 今日盈亏）。
     */
    function moodTitle(earn) {
      if (!earn || !earn.has || !Number.isFinite(earn.today) || earn.today === 0) return "📈 观望中";
      const yest = earn.value - earn.today;
      const pct = yest > 0 ? (earn.today / yest) * 100 : 0;
      if (earn.today > 0) return pct >= 3 ? "🚀 起飞了" : "🍗 加鸡腿";
      return pct <= -3 ? "🧘 天台吹风" : "🍜 关灯吃面";
    }
    /** 收益明细：汇总 + 每只持仓（用于悬浮窗 hover 浮层） */
    function earningsDetail(cfg, quotes) {
      let cost = 0, value = 0, today = 0, realized = 0, has = false;
      const rows = [];
      for (const p of cfg.positions || []) {
        const q = quotes[p.code];
        if (!q) continue; // 没行情：整只跳过
        const qty = p.qty || 0;
        const c = p.cost || 0;
        const td = todayPnl(p, q);
        if (!qty) {
          // 清仓股：市值/成本为 0，但今日已实现盈亏要显示出来，
          // 否则用户卖完后从明细里看到这只票凭空消失，以为数据丢了。
          const rp = realizedPnl(p, q);
          if (rp === 0 && td === 0) continue; // 既没持仓又没今日成交：不必展示
          has = true;
          today += td;
          realized += rp;
          rows.push({ code: p.code, name: q.name || p.name || displayCode(p.code), price: q.price, qty: 0, cost: c, mv: 0, pnl: rp, pnlPct: null, today: td, todayPct: null, closed: true });
          continue;
        }
        has = true;
        const mv = q.price * qty;
        const pnl = c ? (q.price - c) * qty : 0;
        const pnlPct = c ? ((q.price - c) / c) * 100 : null;
        // 当日涨幅 = 今日盈亏 / 昨收市值（昨收市值 = 现市值 − 今日盈亏），与持仓页口径一致
        const yestValue = mv - td;
        const todayPct = yestValue > 0 ? (td / yestValue) * 100 : null;
        cost += c * qty;
        value += mv;
        today += td;
        rows.push({ code: p.code, name: (q && q.name) || p.name || displayCode(p.code), price: q.price, qty, cost: c, mv, pnl, pnlPct, today: td, todayPct });
      }
      const pnl = value - cost + realized;
      const yestTotal = value - today;
      rows.sort((a, b) => b.mv - a.mv);
      return {
        has, cost, value, today, realized, pnl,
        pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
        todayPct: yestTotal > 0 ? (today / yestTotal) * 100 : null,
        rows,
      };
    }
    /** 收益金额格式化（带正负号，万亿/亿/万） */
    function fmtSigned(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      const sign = n > 0 ? "+" : n < 0 ? "-" : "";
      const a = Math.abs(n);
      if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + "亿";
      if (a >= 1e4) return sign + (a / 1e4).toFixed(2) + "万";
      return sign + a.toFixed(0);
    }

    /** 放置模式 dock：嵌入 conversation.composer.dock（仅已有对话生效，平台限制）。 */
    function IndexBar() {
      const s = useStore();
      useEffect(() => { initStore(); }, []);
      const cfg = s.config;
      if (!cfg || !cfg.barVisible || s.barPlacement !== "dock") return null;
      return h("div", rootProps(s, cfg), renderBarContent(s, cfg));
    }

    /**
     * 测量对话输入区（composer seat）几何，作为悬浮栏「自动锚定」的默认位置。
     * composer 常驻底部（不随消息滚动），故轮询 + resize 重测即可；找不到时回退视口左下角。
     */
    function useComposerAnchor() {
      const [rect, setRect] = useState(null);
      useEffect(() => {
        let alive = true;
        let last = null;
        const measure = () => {
          if (!alive) return;
          let next = null;
          const seat = document.querySelector("[data-composer-seat]") || document.querySelector('[data-conversation-region="composer"]');
          if (seat) {
            const r = seat.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              next = { left: r.left + 10, bottom: Math.max(8, window.innerHeight - r.bottom + 6), width: Math.max(200, r.width - 20), found: true };
            }
          }
          if (!next) next = { left: 16, bottom: 14, width: Math.min(560, Math.max(220, window.innerWidth - 32)), found: false };
          if (!last || Math.abs(next.left - last.left) > 1 || Math.abs(next.bottom - last.bottom) > 1 || Math.abs(next.width - last.width) > 1) {
            last = next;
            setRect(next);
          }
        };
        measure();
        const iv = setInterval(measure, 400);
        window.addEventListener("resize", measure);
        return () => {
          alive = false;
          clearInterval(iv);
          window.removeEventListener("resize", measure);
        };
      }, []);
      return rect;
    }

    /**
     * 放置模式 floating：shell.overlay 内 fixed 悬浮，可自由移动（默认自动锚定到对话左下角）。
     * 交互：点击任意指数 → 打开大悬浮窗；⚙ 短按=设置、按住拖动=移动指数栏、双击=回到自动锚定。
     */
    function FloatingIndexBar() {
      const s = useStore();
      useEffect(() => { initStore(); }, []);
      const rect = useComposerAnchor();
      const cfg = s.config;
      const [dragging, setDragging] = useState(false);
      const dragRef = useRef(null); // {ox,oy,sx,sy,moved}
      const suppressClickRef = useRef(false); // 拖动后抑制随之而来的 click（避免误开设置）
      const rootRef = useRef(null);

      // 全局拖动：⚙ 按下后由 window 跟踪移动/抬起
      useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) < 4) return; // 阈值内视为点击
          d.moved = true;
          if (!dragging) setDragging(true);
          const x = clamp(e.clientX - d.ox, 4, window.innerWidth - 40);
          const y = clamp(e.clientY - d.oy, 4, window.innerHeight - 24);
          setBarPos({ x, y }, false); // 拖动中仅更新内存，避免每帧写 localStorage
        };
        const onUp = () => {
          const d = dragRef.current;
          if (!d) return;
          dragRef.current = null;
          if (d.moved) {
            setDragging(false);
            setBarPos(state.barPos); // 抬起时落盘最终位置
            suppressClickRef.current = true; // 抑制紧随的 click
            setTimeout(() => { suppressClickRef.current = false; }, 0);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
      }, [dragging]);

      const startGearDrag = (e) => {
        if (e.button !== undefined && e.button !== 0) return; // 仅左键
        if (!rootRef.current) return;
        const r = rootRef.current.getBoundingClientRect();
        dragRef.current = { ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      };
      const resetPos = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragRef.current = null;
        setDragging(false);
        setBarPos(null);
        toast("指数栏已回到自动锚定位置");
      };

      // 视口尺寸 + 悬浮栏实测尺寸：用于**渲染时**把坐标钳进可视区。
      // 关键：钳制只影响本次显示，绝不回写 localStorage —— 否则缩小窗口时
      // 用户设定的原始坐标会被钳制值覆盖，再放大就回不到原位
      // （用户报告："放大缩小放大，悬浮又不在原来的位置了"）。
      const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const [barSize, setBarSize] = useState({ w: 260, h: 28 });
      useEffect(() => {
        const sync = () => {
          setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }));
          const el = rootRef.current;
          if (el && el.offsetWidth) {
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            setBarSize((p) => (p.w === w && p.h === h ? p : { w, h }));
          }
        };
        sync();
        window.addEventListener("resize", sync);
        return () => window.removeEventListener("resize", sync);
      }, []);
      // 每次渲染后补测实际尺寸（切换 full/compact 等会改变宽度）
      useEffect(() => {
        const el = rootRef.current;
        if (!el || !el.offsetWidth) return;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        setBarSize((p) => (p.w === w && p.h === h ? p : { w, h }));
      });

      if (!cfg || !cfg.barVisible || s.barPlacement === "dock") return null;
      if (!rect && !s.barPos) return null;
      // 手动位置：仅渲染时钳进视口（存储里始终保留用户的原位坐标）
      const clampedPos = s.barPos
        ? {
            x: clamp(s.barPos.x, 4, Math.max(4, vp.w - barSize.w - 4)),
            y: clamp(s.barPos.y, 4, Math.max(4, vp.h - barSize.h - 4)),
          }
        : null;
      const posStyle = clampedPos
        ? { left: clampedPos.x, top: clampedPos.y }
        : { left: rect.left, bottom: rect.bottom, maxWidth: rect.width };
      const base = rootProps(s, cfg);
      const gearProps = {
        className: "sl-bar-btn sl-gear" + (dragging ? " sl-gear-dragging" : ""),
        "data-sltip": "点击=设置 · 按住拖动=自由移动指数栏 · 双击=回到自动锚定",
        onPointerDown: startGearDrag,
        onDoubleClick: resetPos,
        onClick: (e) => {
          if (suppressClickRef.current || (dragRef.current && dragRef.current.moved)) return; // 拖动结束，忽略 click
          openOverlay("settings");
        },
      };
      return h(
        "div",
        {
          ref: rootRef,
          className: base.className,
          style: Object.assign({}, base.style, { position: "fixed", zIndex: 9985, pointerEvents: "none" }, posStyle),
        },
        h(
          "div",
          { className: "sl-bar-wrap" + (dragging ? " sl-bar-dragging" : ""), style: { pointerEvents: "auto", display: "inline-flex", alignItems: "center", maxWidth: "100%" } },
          renderBarContent(s, cfg, gearProps),
        ),
      );
    }

    function IndexChip(props) {
      const { idx, q } = props;
      const cfg = useStore().config;
      const elRef = useRef(null);
      const up = q && q.percent > 0;
      const down = q && q.percent < 0;
      const col = up ? "var(--sl-up)" : down ? "var(--sl-down)" : "var(--sl-flat)";
      const lastPrice = q ? q.price : null;
      const prevPriceRef = useRef(undefined);
      useEffect(() => {
        const prev = prevPriceRef.current;
        prevPriceRef.current = lastPrice;
        if (prev === undefined || prev === null || lastPrice === null || prev === lastPrice) return;
        const el = elRef.current;
        if (!el) return;
        el.classList.remove("sl-flash-up", "sl-flash-down");
        void el.offsetWidth;
        el.classList.add(lastPrice > prev ? "sl-flash-up" : "sl-flash-down");
      }, [lastPrice]);
      const compact = cfg && cfg.barStyle === "compact";
      return h(
        "span",
        {
          ref: elRef,
          className: "sl-chip",
          onClick: props.onOpen,
          "data-sltip": q
            ? idx.name + "（" + displayCode(idx.code) + "）\n现 " + fmtPrice(q.price) + " 涨跌 " + (q.change >= 0 ? "+" : "") + fmtPrice(q.change) + " " + fmtPct(q.percent) + "\n今开 " + fmtPrice(q.open) + " 昨收 " + fmtPrice(q.yestclose) + "\n最高 " + fmtPrice(q.high) + " 最低 " + fmtPrice(q.low) + "\n成交 " + fmtMoney(q.amount, idx.code) + " · " + fmtTime(q.time)
            : (idx.name || idx.code) + "：行情获取中",
        },
        h("span", { className: "sl-chip-name" }, shortIndexName(idx.name, idx.code)),
        !compact ? h("span", { className: "sl-chip-price", style: { color: col } }, q ? fmtPrice(q.price) : "--") : null,
        h("span", { className: "sl-chip-pct", style: { color: col } }, q ? fmtPct(q.percent) : "--"),
      );
    }

    // ================================================================ 插件主体
    /** Required services: slots（布局挂载点）。 */
    const inject = ["slots"];

    /**
     * Client plugin body：
     *  - conversation.composer.dock → 对话输入框下方指数栏（左下角）
     *  - shell.overlay              → 行情悬浮窗
     * @param ctx - client root context。
     */
    function apply(ctx) {
      const withBoundary = (node) => h(ErrorBoundary, { theme: state.theme }, node);
      ctx.effect(initTipLayer);
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({ name: "conversation.composer.dock", id: "dsh-stock-leek.bar" }, () => withBoundary(h(IndexBar))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.tip-layer", order: 999 }, () => h(TipLayer)));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.floating-bar", order: -10 }, () => withBoundary(h(FloatingIndexBar))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek" }, (props) => withBoundary(h(Overlay, props))));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
