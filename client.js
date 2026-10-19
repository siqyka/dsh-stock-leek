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
  // 必须等于 package.json 的 name：客户端加载器会校验"加载到的 bundle 是否用
  // __ModuleLoader__.load 注册了它期望的 id"，而期望的 id 来自包名。
  id: "@shiqyka/dsh-stock-leek",
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
/* ---------------- 预警页（设置内的二级页） ---------------- */
.sl-alert{display:flex;flex-direction:column;gap:6px}
.sl-alert-add{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.sl-alert-add .sl-input{padding:3px 6px;font-size:11px}
.sl-alert-type{max-width:96px}
.sl-alert-val{max-width:74px}
.sl-alert-unit{color:var(--sl-muted);font-size:10px}
.sl-alert-list{display:flex;flex-direction:column;gap:2px;margin-top:2px}
.sl-alert-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:8px;font-size:11px}
.sl-alert-row:hover{background:var(--sl-hover)}
.sl-alert-nm{color:var(--sl-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:96px}
.sl-alert-cond{color:var(--sl-dim);white-space:nowrap;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.sl-alert-fired{color:var(--sl-warn);font-size:10px;white-space:nowrap}
/* 预警按代码分组的抽屉：组头常驻可见（收起时也能看到哪只响过），展开才列规则 */
.sl-alert-group{border:1px solid var(--sl-border-soft);border-radius:8px;background:var(--sl-bg2);overflow:hidden}
.sl-alert-ghead{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:11px;cursor:pointer}
.sl-alert-ghead:hover{background:var(--sl-hover)}
.sl-alert-gnm{color:var(--sl-text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px}
.sl-alert-gcode{color:var(--sl-muted);font-size:10px;flex:none;font-variant-numeric:tabular-nums}
.sl-alert-gcnt{color:var(--sl-muted);font-size:10px;white-space:nowrap;flex:none}
.sl-alert-garw{color:var(--sl-muted);font-size:9px;flex:none;width:10px;text-align:center}
.sl-alert-gbody{border-top:1px solid var(--sl-border-soft);padding:2px 4px 4px;display:flex;flex-direction:column;gap:2px}
.sl-alert-gbody .sl-alert-row{padding-left:10px}

/* 预警弹窗：显示在对话区左上角；触发时无条件弹出，10s 自动消失、可手动关闭 */
.sl-alert-pop{width:100%;box-sizing:border-box;background:var(--sl-bg);border:1px solid var(--sl-warn);border-left:3px solid var(--sl-warn);border-radius:10px;padding:10px 14px;box-shadow:var(--sl-shadow);cursor:pointer;display:flex;flex-direction:column;gap:5px}
.sl-alert-pop:hover{background:var(--sl-bg2)}
.sl-alert-pop-head{display:flex;align-items:center;gap:8px}
.sl-alert-pop-title{flex:1;min-width:0;font-weight:700;color:var(--sl-warn);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 叠加计数：同时最多 3 条，溢出的合并到最早那条并显示 +N */
.sl-alert-pop-more{flex:none;min-width:18px;padding:0 5px;border-radius:999px;background:var(--sl-warn);color:#fff;font-size:10px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.sl-alert-pop-row{display:flex;align-items:baseline;gap:10px;font-variant-numeric:tabular-nums}
.sl-alert-pop-main .sl-alert-pop-cond{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sl-alert-pop-val{font-size:15px;font-weight:600;color:var(--sl-text)}
.sl-alert-pop-time{margin-left:auto;color:var(--sl-muted);font-size:10px;white-space:nowrap}
/* 倒计时进度条：10s 内从满到空（时长由内联 animationDuration 给出） */
.sl-alert-pop-bar{height:2px;border-radius:2px;background:var(--sl-warn);transform-origin:left center;animation:slAlertBar linear forwards;margin-top:2px}
@keyframes slAlertBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
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
/* 抽屉只剩记一笔表单，明细挪到二级页 → 留一行指路 */
.sl-txn-hint{color:var(--sl-muted);font-size:9px;opacity:.8}
/* 交易记录二级页：列宽与 .sl-txn-row 内的 side/date/num/amt 一一对齐 */
.sl-txnrec{display:flex;flex-direction:column;gap:6px}
.sl-txnrec-sum{display:flex;align-items:center;gap:10px;padding:5px 8px;border:1px solid var(--sl-border-soft);border-radius:8px;background:var(--sl-bg2);font-size:11px;color:var(--sl-dim)}
.sl-txnrec-sum b{font-variant-numeric:tabular-nums}
.sl-txnrec-cnt{color:var(--sl-muted);font-size:10px;white-space:nowrap}
.sl-txnrec-head{display:flex;align-items:center;gap:6px;padding:2px 4px;color:var(--sl-muted);font-size:10px}
.sl-txnrec-head span:nth-child(1){width:16px;flex:none}
.sl-txnrec-head span:nth-child(2){width:74px;flex:none}
.sl-txnrec-head span:nth-child(3){width:64px;flex:none;text-align:right}
.sl-txnrec-head span:nth-child(4){width:64px;flex:none;text-align:right}
.sl-txnrec-head span:nth-child(5){flex:1;text-align:right}
.sl-txnrec-list{display:flex;flex-direction:column;gap:2px;max-height:none;overflow-y:auto}
.sl-txnrec-list .sl-txn-row{padding:3px 4px;border:1px solid var(--sl-border-soft);border-radius:6px;background:var(--sl-bg2)}
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
/* 五档盘口：卖盘在上、买盘在下（价格自上而下递减，与券商软件一致） */
.sl-ob{display:flex;flex-direction:column;gap:1px;padding:6px 8px 8px;margin:0 6px 8px;border:1px solid var(--sl-border-soft);border-radius:8px;background:var(--sl-bg2)}
.sl-ob-head{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--sl-muted);margin-bottom:3px}
.sl-ob-row{position:relative;display:flex;align-items:center;gap:8px;font-size:11px;padding:2px 4px;border-radius:4px;font-variant-numeric:tabular-nums;overflow:hidden}
.sl-ob-row:hover{background:var(--sl-hover)}
.sl-ob-lv{flex:none;width:22px;color:var(--sl-muted);font-size:10px}
.sl-ob-price{flex:none;width:74px;text-align:right}
.sl-ob-qty{flex:none;width:58px;text-align:right;color:var(--sl-dim)}
/* 横条：绝对定位铺在行底，宽度按该档量占十档最大量的比例 */
.sl-ob-bar{position:absolute;left:0;top:0;bottom:0;width:100%;pointer-events:none;display:flex;justify-content:flex-end;opacity:.16}
.sl-ob-bar i{display:block;height:100%;border-radius:4px 0 0 4px}
.sl-ob-bid .sl-ob-price{color:var(--sl-up)}
.sl-ob-bid .sl-ob-bar i{background:var(--sl-up)}
.sl-ob-ask .sl-ob-price{color:var(--sl-down)}
.sl-ob-ask .sl-ob-bar i{background:var(--sl-down)}
/* 中间那行现价：把卖盘与买盘分开 */
.sl-ob-mid{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--sl-muted);padding:3px 4px;margin:2px 0;border-top:1px dashed var(--sl-border-soft);border-bottom:1px dashed var(--sl-border-soft);font-variant-numeric:tabular-nums}
.sl-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:10000;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:8px;padding:6px 14px;box-shadow:var(--sl-shadow);pointer-events:none;white-space:nowrap;color:var(--sl-text)}
/* 右键菜单 */
.sl-menu{position:fixed;z-index:10001;min-width:168px;max-width:240px;padding:4px;display:flex;flex-direction:column;gap:1px;background:var(--sl-bg);border:1px solid var(--sl-border);border-radius:8px;box-shadow:var(--sl-shadow);pointer-events:auto}
.sl-menu-item{display:flex;align-items:center;gap:8px;background:transparent;border:none;color:var(--sl-text);padding:5px 10px;border-radius:6px;cursor:pointer;font:inherit;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sl-menu-item:hover{background:var(--sl-hover)}
/* 单色线性图标：随文字变色（危险项跟着变红），比彩色 emoji 视觉统一 */
.sl-menu-ico{flex:none;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:.75}
.sl-menu-item:hover .sl-menu-ico{opacity:1}
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
    /**
     * 指数栏的展开缓冲（分钟）：
     *   - 开盘**前** BAR_LEAD_MIN 分钟就位（A股 → 9:00，覆盖集合竞价）
     *   - 收盘**后** BAR_LAG_MIN 分钟才收回（A股 → 15:06，别在 15:00 准点消失）
     * 三个市场共用同一组缓冲，于是展开区间等宽：A股 9:00–15:06、港股 9:00–16:06、美股 9:00–16:06（各自本地时间）。
     */
    const BAR_LEAD_MIN = 30;
    const BAR_LAG_MIN = 6;

    /** 各市场的日内交易时段（自 00:00 起的分钟数）：[[start, end], ...] */
    function marketWindows(code) {
      const c = String(code || "").toLowerCase();
      if (/^(sh|sz|bj)/.test(c)) return [[570, 690], [780, 900]]; // A股 9:30–11:30 / 13:00–15:00
      if (/^hk/.test(c)) return [[570, 720], [780, 960]]; // 港股 9:30–12:00 / 13:00–16:00
      if (/^(us|gb_)/.test(c)) return [[570, 960]]; // 美股 9:30–16:00
      return [];
    }
    /** 某时刻在目标市场时区的「当日分钟数」 */
    function marketMinutes(code, now) {
      const c = String(code || "").toLowerCase();
      const tz = /^(sh|sz|bj)/.test(c) ? "Asia/Shanghai"
        : /^hk/.test(c) ? "Asia/Hong_Kong"
          : /^(us|gb_)/.test(c) ? "America/New_York" : null;
      try {
        if (!tz) return now.getHours() * 60 + now.getMinutes();
        const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
        const [hh, mm] = s.split(":").map(Number);
        return hh * 60 + mm;
      } catch {
        return now.getHours() * 60 + now.getMinutes();
      }
    }
    /**
     * 当前时刻（测试可用 globalThis.__sl_now__ 覆盖）。
     * 时段相关的判断全走这里，才能在 e2e 里把"非交易时段"稳定复现出来——
     * 否则断言只在真收盘时才成立，白天跑必然挂。
     */
    function marketNow() {
      const v = Number(globalThis.__sl_now__);
      if (Number.isFinite(v) && v > 0) return new Date(v);
      return new Date();
    }
    /** 该市场当前是否交易时段（本地近似判断，用于状态点） */
    function isMarketOpen(code, now) {
      now = now || marketNow();
      const c = String(code || "").toLowerCase();
      const wd = now.getDay();
      if (wd === 0 || wd === 6) return false;
      const t = marketMinutes(c, now);
      return marketWindows(c).some(([a, b]) => t >= a && t <= b);
    }
    // ==== 预警：规则清洗（与 lib/shared.js 同名副本，shared-drift 对拍锁定）====
    // UI 建规则时本地先用它校验/钳制，Host 侧 sanitizeConfig 是最终防线。
    const ALERT_TYPES = [
      "price_above", "price_below", "cost_above", "cost_below",
      "pct_up", "pct_down", "limit_near", "speed_up",
    ];
    function sanitizeAlert(raw) {
      if (!raw || typeof raw !== "object") return null;
      if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(raw.id)) return null;
      const code = typeof raw.code === "string" ? raw.code.trim() : "";
      if (!/^[A-Za-z0-9_.$-]{1,16}$/.test(code)) return null;
      if (!ALERT_TYPES.includes(raw.type)) return null;
      if (raw.type === "limit_near" && !/^(sh|sz|bj)/i.test(code)) return null;
      const value = Number(raw.value);
      if (!Number.isFinite(value) || value < 0) return null;
      const out = {
        id: raw.id,
        code,
        type: raw.type,
        value: Math.min(1e8, Math.round(value * 10000) / 10000),
      };
      // 没有 enabled：规则存在即参与评估，要停就删（与 lib/shared.js 同款，勿单边修改）
      if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, 40);
      if (Number.isFinite(Number(raw.createdAt))) out.createdAt = Math.round(Number(raw.createdAt));
      return out;
    }
    function sanitizeAlerts(raw) {
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      const out = [];
      for (const r of raw) {
        const v = sanitizeAlert(r);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
        if (out.length >= 50) break;
      }
      return out;
    }
    // ==== 行情时间戳 → 市场本地交易日（与 lib/shared.js 一致）====
    // 三市场格式不同：A股 14 位数字 / 美股 "Y-M-D H:M:S" / 港股 "Y/M/D H:M:S"。
    // 只认 14 位会让美股、港股规则永远 no-day 不触发（实测踩过）。
    function quoteDayFor(q) {
      const t = String((q && q.time) || "").trim();
      if (/^\d{14}$/.test(t)) return t.slice(0, 8);
      const digits = t.replace(/[^\d]/g, "");
      if (digits.length >= 8 && /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(t)) {
        return digits.slice(0, 8);
      }
      return null;
    }
    // ==== 市场开关（与 lib/shared.js 一致；shared-drift 对拍锁定）====
    // 用户要求：A股/港股/美股三个开关可多选；被暂停的市场不刷新行情、
    // 指数栏也不因它展开。未知市场（无前缀）不受开关影响，按启用处理。
    function marketKeyOf(code) {
      const c = String(code || "").toLowerCase();
      if (/^(sh|sz|bj)/.test(c)) return "cn";
      if (/^hk/.test(c)) return "hk";
      if (/^(us|gb_)/.test(c)) return "us";
      return null;
    }
    function marketPaused(code, paused) {
      if (!Array.isArray(paused) || paused.length === 0) return false;
      const key = marketKeyOf(code);
      return key !== null && paused.includes(key);
    }
    function withoutPausedMarkets(codes, paused) {
      const arr = Array.isArray(codes) ? codes : [];
      if (!Array.isArray(paused) || paused.length === 0) return arr;
      return arr.filter((c) => !marketPaused(c, paused));
    }
    /**
     * 指数栏此刻该不该展开（**不含手动覆盖**，只回答"按时段该不该"）。
     *
     * 非交易时段只留「状态点 + 设置」，把桌面让出来。
     *
     * **午休不收起**：判据取整个交易日的跨度（首个开盘 − 缓冲 ~ 最后收盘 + 缓冲），
     * 而不是逐时段匹配。否则 A 股每天 11:30–13:00 栏会消失两个半小时。
     *
     * **市场开关参与判断**（用户要求）：被暂停的市场视为"永不展开"——
     * 它的行情都停了，展开一个显示定格数字的栏没有意义。
     */
    function shouldExpandBar(code, now) {
      now = now || marketNow();
      const c = String(code || "").toLowerCase();
      if (marketPaused(c, state.config && state.config.pausedMarkets)) return false; // 开关关掉 → 不参与展开
      const wd = now.getDay();
      if (wd === 0 || wd === 6) return false; // 周末一律收起
      const ws = marketWindows(c);
      if (!ws.length) return false; // 未知市场：保守收起
      const t = marketMinutes(c, now);
      const openAt = ws[0][0];
      const closeAt = ws[ws.length - 1][1];
      return t >= openAt - BAR_LEAD_MIN && t <= closeAt + BAR_LAG_MIN;
    }
    /**
     * 指数栏当前实际是否展开：手动覆盖优先于时段判断。
     * `barForce` 跨交易日自动失效——否则昨天临收盘手动收起，今天开盘也不展。
     */
    function barExpandedNow(s, cfg) {
      const items = barItems(s, cfg);
      const auto = items.length === 0 ? true : items.some((x) => shouldExpandBar(x.idx.code));
      const day = items.length && items[0].q ? quoteDate(items[0].q) : "";
      const force = state.barForceDay === day ? state.barForce : null;
      return { expanded: force === null ? auto : force, auto: auto, force: force };
    }
    /** 指数栏上排的指数（含没行情的） */
    function barItems(s, cfg) {
      return cfg.barIndices.map((code) => ({ idx: cfgFind(cfg.indices, code) || { code, name: displayCode(code) }, q: s.quotes[code] })).filter((x) => x.idx);
    }
    /**
     * 点状态点切换展开/收起：当前展开 → 收起，当前收起 → 展开。
     *
     * 手动选择会一直生效到**下一个交易日**（barForceDay 过期即失效），
     * 所以"临收盘手动收起"不会粘住明天开盘。不做"再点一下退回自动"——
     * 那样点出来的状态和自动状态永远观测不到同一种情形，反而更难预期。
     */
    function toggleBarExpand(s, cfg) {
      const now = barExpandedNow(s, cfg);
      const items = barItems(s, cfg);
      const day = items.length && items[0].q ? quoteDate(items[0].q) : "";
      setState({ barForce: !now.expanded, barForceDay: day });
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
      barForce: null, // 指数栏展开的手动覆盖：null=按时段自动，true=强制展开，false=强制收起
      barForceDay: "", // 手动覆盖所属的行情日期；跨交易日自动失效（别让昨天的选择粘住今天）
      alertStates: {}, // ruleId → {phase, day}，展示每条规则的「已触发/待命」
      alertPanel: false, // 设置页里的预警二级页是否打开（预警不占 tab，从设置进入）
      alertLive: false, // 预警推送通道是否已连上（隐藏时也保持连接）
      alertPopups: [], // 待确认的预警弹窗队列 [{id, name, code, type, value, price, percent, at, shownAt}]
      visibleTick: 0, // 可见性变化计数：让预警弹窗的 10s 计时在恢复可见后重跑
      notifyPerm: "default", // 桌面通知权限：granted | denied | default | unsupported
      addAlert: null, // 右键「设为预警」弹出的规则对话框 {code, name, preset}
      alertOpen: null, // 预警页按代码分组的抽屉：当前展开的 code（单值手风琴，同持仓页 openCode）
      txnPanel: null, // 交易记录二级页 {code, name}；null=未打开。只显示被右键那只股票的成交
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
            // 同上：老 Host 吃掉 alerts 时保留本地规则，别让用户刚建的规则在回包后消失
            if (!Array.isArray(merged.alerts) && Array.isArray(cfg.alerts)) merged.alerts = cfg.alerts;
            // 同上：老 Host 吃掉 pausedMarkets（市场开关）时保留本地选择，
            // 否则用户刚关掉的市场会被静默重新打开
            if (!Array.isArray(merged.pausedMarkets) && Array.isArray(cfg.pausedMarkets)) merged.pausedMarkets = cfg.pausedMarkets;
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
      // 市场开关（可多选）：被暂停的市场**完全不刷**——开关关掉 = 用户明确
      // 不要这个市场的行情，与"已收盘自动停"同一条链。
      const codes = withoutPausedMarkets(allCodes(cfg), cfg.pausedMarkets);
      if (codes.length === 0) {
        // 全部市场都被暂停 / 无任何代码：跳过本次拉取。
        // 保留已有 quotes 不清空（界面还能显示最后一份快照），只更新时间戳。
        setState({ error: null, updatedAt: Date.now() });
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
    /** 关注集合（含详情页那只）；排除被暂停的市场——订阅了 Host 也会去拉上游 */
    function sseCodes() {
      const base = withoutPausedMarkets(allCodes(state.config), state.config && state.config.pausedMarkets);
      const d = state.detail && state.detail.code;
      // 详情页那只**不受开关限制**：用户主动打开了个股详情，就是要看它
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
    // ================================================================ 预警推送通道 + 通知降级
    //
    // 与行情流刻意不同：**隐藏时不关**（docs/alerts-plan.md §7.1）。
    // 这条流只在触发时才有数据（一天几条），零上游请求，与「隐藏断流」
    // 原本要对齐的连接数目标不冲突；行情流照旧隐藏即断。
    let alertEs = null;
    let alertEsTried = false;
    /** 桌面通知能力探测：DSH 宿主可能是 webview，Notification 未必存在 */
    function notifySupported() {
      return typeof Notification === "function";
    }
    function notifyPermission() {
      if (!notifySupported()) return "unsupported";
      return Notification.permission; // "granted" | "denied" | "default"
    }
    /**
     * 三级降级（§7.3）：
     *   页面可见            → toast + 铃铛角标
     *   隐藏 + 已授权        → 系统通知（点击回到页面）
     *   隐藏 + 未授权/不可用 → document.title 加 ⚠ 前缀
     * 全不可用也仍有历史 + 角标——功能不依赖通知成立。
     */
    function flashTitle(text) {
      const base = document.title.replace(/^⚠ /, "");
      document.title = "⚠ " + base;
      clearTimeout(flashTitle._t);
      flashTitle._t = setTimeout(() => { document.title = base; }, 6000);
    }
    /**
     * 多标签页去重（§7.4）：三个标签页都隐藏 → 会弹三条重复系统通知。
     * 用 navigator.locks 按事件 id 认领，抢到的才弹；不支持时退回「照弹」。
     */
    function claimEvent(key) {
      if (typeof navigator === "undefined" || !navigator.locks || !navigator.locks.request) {
        return Promise.resolve(true); // 无 locks：照弹（注释说明，不静默丢通知）
      }
      return new Promise((resolve) => {
        try {
          navigator.locks.request("sl-alert-" + key, { ifAvailable: true }, (lock) => {
            if (!lock) { resolve(false); return undefined; } // 别的标签页抢到了
            resolve(true);
            return new Promise((r) => setTimeout(r, 1500)); // 持锁一小会儿，挡住并发重复
          }).catch(() => resolve(true));
        } catch {
          resolve(true);
        }
      });
    }
    /**
     * 收到一条预警事件。
     *
     * 关键行为：**无论页面可见与否，都在应用内弹一个必须手动确认的预警弹窗**
     * （用户明确要求）。原因：DSH 是 Electron webview，隐藏/最小化时
     * document.title 根本看不见，系统通知又未必可用——只靠那两条等于收不到。
     * 应用内弹窗挂在 shell.overlay 上，窗口恢复时一定在，且不会被忽略。
     *
     * 系统通知作为**叠加增强**（可见时也发）：能弹就多一条通道，不互斥。
     */
    async function notifyAlert(ev) {
      const name = (ev && ev.name) || displayCode(ev && ev.code);
      const cond = alertRuleText(ev); // 成本类不带「成本价」后缀（类型标签已含），与列表口径一致
      const body = name + " " + cond + "，现价 " + fmtPrice(ev.price);
      const hidden = typeof document !== "undefined" && document.hidden;

      // ① 应用内弹窗：唯一的**保证通道**，可见与否都弹
      pushAlertPopup(ev);

      // ② 不再补 toast：用户明确不要 —— 弹窗本身已足够醒目，
      //    top 处再飘一条「⚠ 苹果 现价上穿…」属于重复打扰（截图反馈）。
      //    去掉后预警只剩「弹窗」一种可见通道（+可选系统通知）。

      // ③ 系统通知：能力具备就发（用户点过「开启桌面通知」）；隐藏时去重防三连弹
      if (notifyPermission() === "granted") {
        if (hidden) {
          const mine = await claimEvent(String(ev.ruleId || "") + ":" + String(ev.at || ""));
          if (!mine) return; // 另一个标签页已弹过
        }
        try {
          const n = new Notification("🔔 预警 · " + name, { body, tag: "sl-" + (ev.ruleId || "") + "-" + (ev.at || "") });
          n.onclick = () => { try { window.focus(); } catch { /* ignore */ } openAlertPanel(); };
        } catch {
          flashTitle(body); // 构造失败（权限被收回等）→ 退回标题提示，弹窗仍在
        }
      } else if (hidden) {
        flashTitle(body); // 无通知能力时的额外兜底（弹窗已在，这条只是锦上添花）
      }
    }
    /**
     * 预警弹窗入队。
     *
     * 规则（用户要求）：**同一时间最多展示 3 条**；再多时不再新增卡片，
     * 而是把溢出的**叠加到最早那条**上（它显示「+N」计数）。
     * 好处：短时间密集触发（如开盘多条同时命中）不会把屏幕铺满，
     * 但也不会丢信息——被叠加的条数明确可见。
     */
    const ALERT_POPUP_MAX = 3;
    function pushAlertPopup(ev) {
      const hidden = typeof document !== "undefined" && document.hidden;
      const item = {
        id: String(ev.ruleId || "") + ":" + String(ev.at || Date.now()),
        name: (ev && ev.name) || displayCode(ev && ev.code),
        code: ev && ev.code,
        type: ev && ev.type,
        value: ev && ev.value,
        price: ev && ev.price,
        percent: ev && ev.percent,
        at: (ev && ev.at) || Date.now(),
        overflow: 0, // 被叠加到本条的数量（>0 时卡片上显示 +N）
        // 可见计时的起点；0 = 尚未开始（页面当时不可见，等恢复可见再起算）。
        // 隐藏期间不推进，否则弹窗会在用户看不见时过期——那等于没弹。
        shownAt: hidden ? 0 : Date.now(),
      };
      const list = (state.alertPopups || []).filter((x) => x.id !== item.id);
      if (list.length >= ALERT_POPUP_MAX) {
        // 满了：叠加到**最早那条**（index 0），不新增卡片
        const head = list[0];
        list[0] = Object.assign({}, head, {
          overflow: (Number(head.overflow) || 0) + 1,
          // 叠加时刷新计时起点：让用户有完整 10 秒看清「又来了几条」
          shownAt: hidden ? 0 : Date.now(),
        });
        setState({ alertPopups: list });
        return;
      }
      list.push(item);
      setState({ alertPopups: list });
    }
    function dismissAlertPopup(id) {
      setState({ alertPopups: (state.alertPopups || []).filter((x) => x.id !== id) });
    }
    function dismissAllAlertPopups() {
      if ((state.alertPopups || []).length) setState({ alertPopups: [] });
    }
    // 测试钩子：暴露真实内部路径供 e2e 驱动通知降级/通道语义。
    // 用 globalThis 而非 export（浏览器工厂没有模块出口），与 __sl_test_state__ 同惯例。
    globalThis.__sl_notify_test__ = notifyAlert;
    globalThis.__sl_alert_stream_open__ = () => !!alertEs;
    function openAlertStream() {
      if (!sseSupported()) return;
      closeAlertStream();
      try {
        alertEs = new EventSource(BASE + "/alert-stream");
      } catch {
        alertEs = null;
        return;
      }
      alertEs.onopen = () => {
        alertEsTried = true;
        // 重连后先对账：冻结期间漏掉的事件靠账本补齐（不假设流不断，§7.1 修订）
        refreshAlerts();
      };
      alertEs.onmessage = (evt) => {
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return;
        }
        if (!payload || payload.type !== "alert" || !payload.event) return;
        // 触发历史已去掉：事件不再入 state，直接交给弹窗通道
        notifyAlert(payload.event);
      };
      alertEs.onerror = () => {
        // 与行情流不同：这里**不回落到轮询**，只标注断开并稍后重连——
        // 预警数据由 Host 照常记录，客户端断了也不丢事件。
        setState({ alertLive: false });
        closeAlertStream();
        clearTimeout(openAlertStream._t);
        openAlertStream._t = setTimeout(() => { if (!document.hidden) openAlertStream(); }, 15000);
      };
      setState({ alertLive: true });
    }
    function closeAlertStream() {
      if (!alertEs) return;
      try {
        alertEs.close();
      } catch { /* ignore */ }
      alertEs = null;
      setState({ alertLive: false });
    }
    /** 申请桌面通知权限：**只在用户点按钮时**调用（浏览器要求手势，开局弹框体验也差） */
    async function requestNotifyPermission() {
      if (!notifySupported()) { toast("当前环境不支持系统通知（历史与角标仍可用）", "#e6a23c"); return "unsupported"; }
      try {
        const p = await Notification.requestPermission();
        setState({ notifyPerm: p });
        toast(p === "granted" ? "已开启桌面通知" : "未获得通知权限（历史与角标仍可用）", p === "granted" ? null : "#e6a23c");
        return p;
      } catch {
        return "unsupported";
      }
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearTimeout(pollTimer);
        closeStream(); // 隐藏时断开行情 SSE（与服务端连接数对齐）
        // 预警流**故意不断**：它只在触发时有数据、零上游请求（§7.1）。
        // 这正是「关掉页面也能收到预警」成立的前提。
      } else if (pollActive) {
        refreshQuotes();
        schedulePoll();
        if (sseTried && sseSupported()) openStream(); // 可见时恢复行情通道
        refreshAlerts(); // 回到页面先对账（冻结期间可能漏了事件）
        if (!alertEs && sseSupported()) openAlertStream();
        // 恢复可见：给隐藏期间弹出的预警补上计时起点（它们此前 shownAt=0，未开始倒计时），
        // 并 bump visibleTick 让 AlertPopup 的计时 effect 重跑
        const pops = state.alertPopups || [];
        if (pops.some((p) => !p.shownAt)) {
          const now = Date.now();
          setState({ alertPopups: pops.map((p) => (p.shownAt ? p : Object.assign({}, p, { shownAt: now }))) });
        } else {
          setState({ visibleTick: (state.visibleTick || 0) + 1 });
        }
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

      // 通知权限只**读**不申请（申请必须由用户手势触发，§7.2）
      setState({ notifyPerm: notifyPermission() });
      if (cfg && Array.isArray(cfg.indices)) setState({ config: cfg });
      try {
        const r = await api("/config");
        if (r && r.config) {
          // 兼容旧版 host：其不认识的可选字段（如 ma/alerts）会被丢弃，优先保留本地已有值
          const merged = Object.assign({}, r.config);
          if (!Array.isArray(merged.ma) && cfg && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
          // 老 Host 的白名单重建会吃掉 alerts（与当年 ma 被吃同一个坑）：
          // 本地有规则而回包没有 → 保留本地，避免 UI 上规则凭空消失
          if (!Array.isArray(merged.alerts) && cfg && Array.isArray(cfg.alerts)) merged.alerts = cfg.alerts;
          // 同上：老 Host 吃掉 pausedMarkets（市场开关）时保留本地选择
          if (!Array.isArray(merged.pausedMarkets) && cfg && Array.isArray(cfg.pausedMarkets)) merged.pausedMarkets = cfg.pausedMarkets;
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
      refreshAlerts(); // 首屏补一次规则状态（不等 alert-stream 连上）
      openAlertStream(); // 预警通道与行情通道独立：隐藏不断，重连先对账
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
    /**
     * 更新持仓（成本/股数等）。
     *
     * 记下 `openedAt` = 建仓当天的**行情日期**，供 todayPnl 区分
     * 「今天刚建的仓」与「昨天就持有、今天没动」——前者今日盈亏要按成本算，
     * 否则会凭空多出「昨天就持有」的浮盈（实测：成本 52.435/现价 52.390/昨收 52.310，
     * 界面显示 +80，真实是 −45）。
     *
     * **只在真发生"从空仓变成有仓"的那一刻写入**（prevQty 为 0 → nextQty > 0）。
     * 刻意不给已存在的老持仓补记：它们的建仓日无从推断，硬补会把「昨天就持有」
     * 误判成「今天建的」，让今日盈亏从昨收口径突变成成本口径、数字凭空跳变。
     * 老持仓保持旧口径，用户重新建仓（删掉再加）才会启用新口径。
     * 已有 openedAt 一律不覆盖——否则每次改股数都会把建仓日刷成今天。
     * 口径与 quoteDate 一致（行情日期而非本地日期，天然跳过周末）。
     */
    function updatePosition(code, patch) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p) return null;
        const prevQty = p.qty || 0;
        Object.assign(p, patch);
        const nextQty = p.qty || 0;
        if (!p.openedAt && prevQty <= 0 && nextQty > 0) {
          p.openedAt = quoteDate(state.quotes[code]);
        }
        // 编辑对话框改的是**基准持仓**（不是当前持仓）。
        // 关键：用户可能先记了几笔交易、再回头改成本/股数——那次修改等于宣告
        // 「此刻持仓就是这样」，之前的流水已被吸收，不能再叠加一遍（否则双重计算）。
        // 所以这里刷新 baseAt=现在，只让**之后**记的流水参与 replay。
        if (p.txns && p.txns.length) {
          p.baseQty = nextQty;
          p.baseCost = p.cost || 0;
          p.baseAt = Date.now();
          // 一律走 replay 得出当前持仓，**不在这里直接赋值**——
          // 直接赋会让 baseAt 过滤失效时也看不出问题（断言会空转，实测踩过）。
          applyReplay(p);
        }
        return cfg;
      });
    }
    function removePosition(code) {
      updateConfig((cfg) => {
        cfg.positions = cfg.positions.filter((x) => x.code !== code);
        return cfg;
      });
    }

    // ================================================================ 预警（规则 CRUD + 评估通道）
    /**
     * 规则 id：字符集必须满足 shared 的 sanitizeAlert（[A-Za-z0-9_-]{1,32}）——
     * 它是 .alerts 账本 states 的键，也是「多标签页认领」的标识。
     */
    function newAlertId() {
      return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    /** 规则类型的展示文案（与 Host 的 8 种一一对应） */
    const ALERT_TYPE_LABEL = {
      price_above: "现价上穿", price_below: "现价下穿",
      cost_above: "突破成本", cost_below: "跌破成本",
      pct_up: "涨幅达到", pct_down: "跌幅达到",
      limit_near: "接近涨跌停", speed_up: "涨速达到",
    };
    /** 比率类（单位 %）与价格类的区分：决定输入框单位与提示文案 */
    const ALERT_PCT_TYPES = ["pct_up", "pct_down", "limit_near", "speed_up"];
    function alertUnit(type) {
      return ALERT_PCT_TYPES.includes(type) ? "%" : "元";
    }
    function alertValueText(rule) {
      if (!rule) return "";
      // 成本类的阈值就是成本价本身，类型标签已含「成本」→ 不再重复后缀
      // （否则规则读作「突破成本 成本价」）
      if (rule.type === "cost_above" || rule.type === "cost_below") return "";
      const n = Number(rule.value);
      return (Number.isFinite(n) ? (Math.round(n * 10000) / 10000) : "--") + alertUnit(rule.type);
    }
    function alertRuleText(rule) {
      if (!rule) return "";
      const v = alertValueText(rule);
      const label = ALERT_TYPE_LABEL[rule.type] || rule.type;
      return v ? label + " " + v : label;
    }
    /**
     * 把扁平的规则数组按 code 归组（**纯派生视图**，不改存储）。
     *
     * 组顺序 = 各 code 首次出现的顺序。因为 addAlert 只 push、没有重排入口，
     * 首次出现即组内最早一条规则的 createdAt，于是顺序稳定——
     * 不按「最近触发」排，否则触发一次列表就跳位，用户找不着东西。
     */
    function groupAlerts(rules) {
      const groups = [];
      const byCode = new Map();
      for (const r of rules || []) {
        let g = byCode.get(r.code);
        if (!g) {
          g = { code: r.code, name: r.name || displayCode(r.code), rules: [] };
          byCode.set(r.code, g);
          groups.push(g);
        }
        g.rules.push(r);
      }
      return groups;
    }
    /**
     * 拉取预警规则状态（用于规则列表显示「已触发/待命」）。
     * 页面重开、标签页解冻、alert-stream 重连后都调它——不假设流不断（§7.1 修订）。
     * 触发历史已按要求去掉：Host 不再落盘 events，这里也不再读。
     */
    async function refreshAlerts() {
      try {
        const r = await api("/alerts");
        if (r && r.ok) setState({ alertStates: r.states || {} });
      } catch { /* Host 不可达：保留既有状态，不清零 */ }
    }

    /** 新增规则：本地先按 shared 同款清洗过一遍，非法直接挡在 UI（Host 侧还有一道） */
    function addAlert(item) {
      const rule = sanitizeAlert(Object.assign({ id: newAlertId(), createdAt: Date.now() }, item));
      if (!rule) {
        toast("预警规则不合法：检查类型 / 阈值 / 代码（limit_near 仅 A 股）", "#ff5555");
        return null;
      }
      let added = null;
      updateConfig((cfg) => {
        const list = Array.isArray(cfg.alerts) ? cfg.alerts.slice() : [];
        if (list.length >= 50) {
          toast("预警规则已达上限（50 条）", "#ff5555");
          return null;
        }
        list.push(rule);
        cfg.alerts = list;
        added = rule;
        return cfg;
      });
      if (added) {
        // 新规则塞进**收起的组**里，用户会以为没生效 → 自动展开该组
        setState({ alertOpen: added.code });
        toast("已添加预警：" + alertRuleText(added));
      }
      return added;
    }
    function removeAlert(id) {
      updateConfig((cfg) => {
        cfg.alerts = (cfg.alerts || []).filter((r) => r.id !== id);
        return cfg;
      });
      toast("已删除该预警规则");
    }
    // 曾经的「启用/停用」（toggleAlert / toggleAlertGroup）已整体移除：
    // 规则存在即参与评估，**删除就是停用**。两个理由：
    //   1) 它把"列表里有这条规则"和"它会不会响"变成两件事，对着规则列表也看不出哪些在生效；
    //   2) 分组抽屉把单条开关收进展开体后，收起态连入口都没有（组头那段文字点不动）。
    // 旧配置里残留的 enabled 字段不再读取也不再写回 —— sanitizeAlert 直接不产出它。
    /** 右键「设为预警」→ 预填该股的对话框（现价/成本价作初值，用户可改） */
    function openAddAlert(code, name, preset) {
      setState({ addAlert: { code, name: name || displayCode(code), preset: preset || null } });
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
        if (qty < 0 && cur + qty < 0) {
          toast("卖出股数超过当前持仓（" + cur + "）", "#ff5555");
          return null;
        }
        // 第一笔流水之前先把当时的持仓冻结为「基准」。用户可能先手填成本+股数，也可能直接记账。
        ensureBase(p);
        p.txns = p.txns || [];
        p.txns.push({
          id: (txn.date || "") + ":" + Date.now() + ":" + Math.round(Math.random() * 1e6),
          date: txn.date || "",
          time: txn.time || "",
          price: Math.round(price * 10000) / 10000,
          qty,
          // 记录时刻：用于判断这笔是否晚于「最后一次手动修正」，早于修正点的会被吸收
          at: Date.now(),
        });
        p.txns.sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
        // 记完流水后从「基准 + 修正点之后的流水」重算 qty/cost，而不是增量改：
        // 增量公式一旦和手工编辑过的值混在一起就会永久失配，且无法自愈。
        applyReplay(p);
        ok = true;
        return cfg;
      });
      return ok;
    }
    /**
     * 冻结基准持仓（只在第一次出现流水时做一次，此时还没有修正点 baseAt）。
     *
     * baseQty/baseCost 就是「开始记账那一刻的持仓」，来源是用户手填的成本/股数。
     * 冻结后当前持仓由「基准 + 基准之后的流水」决定，手工录入与逐笔记账落在同一模型。
     * 已经有 baseQty 字段的不再改动（哪怕值是 0，那也是「基准空仓」的合法记录）。
     */
    function ensureBase(p) {
      if (p && p.baseQty === undefined) {
        p.baseQty = p.qty || 0;
        p.baseCost = p.cost || 0;
        // 首次冻结时还没有任何修正点 → baseAt=0 表示"全部流水都参与"
        if (p.baseAt === undefined) p.baseAt = 0;
      }
    }
    /** 按「基准 + 修正点之后的流水」重算并写回 p.qty / p.cost */
    function applyReplay(p) {
      const b = replayPosition(p.baseQty, p.baseCost, p.txns, p.baseAt);
      p.qty = b.qty;
      p.cost = b.cost;
    }
    /**
     * 从交易流水重算「持仓股数 + 成本价」（加权平均法）。
     * **成本口径的唯一真相源**：以前是增量维护 qty/cost，与编辑对话框（手工改）
     * 形成两个真相源，实测产出了自相矛盾的配置（cost 低于所有买入价、
     * qty 与流水净额差 8800 股）。改成「流水是唯一输入」后，任何增删都自洽。
     * 规则：买入加权摊薄 / 卖出只减股数不改成本 / 清仓后成本归零 / 超卖夹到 0。
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function costBasisFromTxns(txns) {
      let qty = 0;
      let cost = 0;
      for (const t of txns || []) {
        const q = Number(t && t.qty);
        const price = Number(t && t.price);
        if (!Number.isFinite(q) || q === 0 || !Number.isFinite(price) || price <= 0) continue;
        if (q > 0) {
          const newQty = qty + q;
          // qty 为 0 时 `cost*qty` 自然是 0，清仓后重新建仓不会被旧成本污染
          cost = Math.round(((cost * qty + price * q) / newQty) * 10000) / 10000;
          qty = newQty;
        } else {
          qty = Math.max(0, qty + q);
          // 刻意不清零 cost：realizedPnl 要用它算已实现盈亏，
          // 清零会让「清仓瞬间累计盈亏暴涨」（实测 37000 → 140000）
        }
      }
      return { qty, cost };
    }
    /**
     * 基准（最后一次手动修正）+ 交易流水 → 当前持仓。lib/shared.js 的内联副本。
     *
     * 只在「修正点（baseAt）之后」记的流水才叠加：用户可能先手填持仓、记几笔交易，
     * **再回头改成本/股数**——那次修改等于宣告"此刻持仓就是这样"，之前的流水已被
     * 吸收，再叠一遍就是双重计算。
     *   baseAt ≤ 0 → 全部流水参与（还没发生过修正）
     *   baseAt > 0 → 只算之后记的；更早的（含没有 at 的老流水）视为已被吸收
     */
    function replayPosition(baseQty, baseCost, txns, baseAt) {
      const bq = Number(baseQty) || 0;
      const bc = Number(baseCost) || 0;
      const cut = Number(baseAt) || 0;
      const list = [];
      if (bq > 0 && bc > 0) list.push({ qty: bq, price: bc });
      for (const t of txns || []) {
        if (cut > 0) {
          const at = Number(t && t.at);
          if (!Number.isFinite(at) || at <= cut) continue;
        }
        list.push(t);
      }
      return costBasisFromTxns(list);
    }
    function removeTxn(code, id) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p || !p.txns) return null;
        const t = p.txns.find((x) => x.id === id);
        if (!t) return null;
        ensureBase(p);
        p.txns = p.txns.filter((x) => x.id !== id);
        if (p.txns.length === 0) {
          // 最后一笔流水删掉 → 回到期初状态（用户手填的值），而不是把持仓清零
          delete p.txns;
          if (p.baseQty !== undefined) { p.qty = p.baseQty; p.cost = p.baseCost; }
        } else {
          // 撤销任意一笔都能回到自洽状态
          applyReplay(p);
        }
        return cfg;
      });
    }
    /**
     * 今日收益（现金流法，支持当日多次买卖）：
     *   今日盈亏 = 当前持仓×现价 + 今日卖出金额 − 今日买入金额 − 昨日持仓×昨收
     *   其中 昨日持仓 = 当前持仓(qty) − 今日净变动(Σ今日 txns.qty)
     * 无今日变动时退化为 (现价 − 昨收) × qty。qty 视为「当前持仓」，与成本/股数录入一致。
     *
     * 例外：**今天才建立的持仓**（openedAt === 今日）按成本算 (现价−成本)×qty。
     * 因为直接填成本+股数建仓没有 txns，光看「无当日变动」分不清
     * 「昨天就持有今天没动」和「今天刚买」；按昨收算会给新仓凭空加一段浮盈。
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function todayPnl(p, q) {
      if (!q || !Number.isFinite(q.price)) return 0;
      const now = q.price;
      const yest = Number.isFinite(q.yestclose) ? q.yestclose : null;
      const today = quoteDate(q);
      const txns = (p.txns || []).filter((t) => t.date === today);
      const qty = p.qty || 0;
      if (txns.length === 0) {
        const openedToday = p.openedAt === today;
        const cost = Number.isFinite(p.cost) ? p.cost : null;
        if (openedToday && cost !== null && cost > 0) return (now - cost) * qty;
        return yest !== null ? (now - yest) * qty : 0;
      }
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
      // 详情页整体替换 body，两个二级页都得退出，否则返回时"回"到一个被遮住的面板
      state = Object.assign({}, state, { detail: { code, name }, alertPanel: false, txnPanel: null }); // 先落 state，供 syncStreamCodes 读到
      for (const l of listeners) l();
      syncStreamCodes(); // 订阅集合变了 → 重连流
    }
    function closeOverlay() {
      setState({ open: false, detail: null, menu: null, editPos: null, tip: null, alertPanel: false, txnPanel: null });
    }
    /** 打开交易记录二级页（只显示这只股票的成交）。从持仓行右键进入。 */
    function openTxnPanel(code, name) {
      setState({ open: true, tab: "position", detail: null, alertPanel: false, txnPanel: { code, name: name || displayCode(code) } });
    }
    /** 打开预警二级页（设置页入口与系统通知点击共用）。
     *  注：原「已读/未读」逻辑随触发历史一起去掉——没有历史列表就没有未读概念。 */
    function openAlertPanel() {
      refreshAlerts();
      setState({ open: true, tab: "settings", detail: null, alertPanel: true });
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
    /**
     * 菜单图标（16px 单色线性 SVG，stroke=currentColor）。
     * 用户要求：要图标但**不要 emoji**——彩色 emoji 与暗色面板风格冲突，
     * 线性图标随主题变色、危险项随文字变红，视觉统一且简洁。
     *
     * ⚠️ 实现说明：每个图标是 `h("svg", …, h("path", …))` 的**真实元素树**，
     * 不用 `dangerouslySetInnerHTML` —— mini-React 测试 harness 只认
     * createElement 出来的结构（踩过：用 innerHTML 会让 e2e 大面积崩）。
     * 图标名由调用点以 `icon` 字段给出（字符串，调用点保持一行）。
     */
    const menuSvg = (children) =>
      h("svg", {
        className: "sl-menu-ico",
        viewBox: "0 0 18 18",
        width: 14, height: 14, "aria-hidden": true,
      }, children);
    const menuPath = (d) => h("path", { d, fill: "none" });
    const menuCircle = (cx, cy, r) => h("circle", { cx, cy, r, fill: "none" });
    const MENU_ICONS = {
      pin: menuSvg([menuPath("M9 2l5 5-2.2 2.2.8 3.2-1.8 1.8-3.2-.8L5.4 15.6 3.4 13.6 5.2 11.8 4.4 8.6 6.6 6.4 9.8 7.2z")]),
      plus: menuSvg([menuPath("M9 4v10"), menuPath("M4 9h10")]),
      minus: menuSvg([menuPath("M4 9h10")]),
      bell: menuSvg([menuPath("M12.5 12H5.5c.8-1 .8-2.2.8-3.5C6.3 6 7.4 4.5 9 4.5s2.7 1.5 2.7 4c0 1.3 0 2.5.8 3.5z"), menuPath("M8 14a1.2 1.2 0 002 0")]),
      pencil: menuSvg([menuPath("M3.5 14.5l.8-3 7.2-7.2 2.2 2.2-7.2 7.2z"), menuPath("M10.5 5.3l2.2 2.2")]),
      list: menuSvg([menuPath("M5 5.5h8"), menuPath("M5 9h8"), menuPath("M5 12.5h8")]),
      trash: menuSvg([menuPath("M3.5 5h11"), menuPath("M7 5V3.5h4V5"), menuPath("M5 5l.7 9.5h6.6L13 5"), menuPath("M7.5 7.5v4.5"), menuPath("M10.5 7.5v4.5")]),
      gear: menuSvg([menuCircle(9, 9, 2.2), menuPath("M9 3.2v1.9"), menuPath("M9 12.9v1.9"), menuPath("M3.2 9h1.9"), menuPath("M12.9 9h1.9"), menuPath("M4.9 4.9l1.3 1.3"), menuPath("M11.8 11.8l1.3 1.3"), menuPath("M13.1 4.9l-1.3 1.3"), menuPath("M6.2 11.8l-1.3 1.3")]),
    };
    /** 单个线性图标（按名字取预构建的元素树） */
    function MenuIcon(props) {
      return MENU_ICONS[props.name] || null;
    }
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
                }, it.icon ? h(MenuIcon, { name: it.icon }) : null, h("span", null, it.label)),
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
                    { label: "置顶", icon: "pin", onClick: () => pinTop("indices", idx.code) },
                    { label: inBar ? "从指数栏移除" : "添加到左下角指数栏", icon: inBar ? "minus" : "plus", onClick: () => toggleBarIndex(idx.code) },
                    { sep: true },
                    { label: "删除指数", icon: "trash", danger: true, onClick: () => { removeIndex(idx.code); toast("已删除 " + (idx.name || idx.code)); } },
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
                    { label: "置顶", icon: "pin", onClick: () => pinTop("watchlist", w.code) },
                    { label: "设为预警", icon: "bell", onClick: () => openAddAlert(w.code, (q && q.name) || w.name, { type: "price_above", value: q && q.price }) },
                    { sep: true },
                    { label: "删除自选", icon: "trash", danger: true, onClick: () => { removeWatch(w.code); toast("已删除自选 " + (w.name || w.code)); } },
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
                    { label: "置顶", icon: "pin", onClick: () => pinTop("positions", p.code) },
                    { label: "编辑成本 / 股数", icon: "pencil", onClick: () => openEditPos(p) },
                    { label: expanded ? "收起交易" : "记一笔交易", icon: "list", onClick: () => { setOpenCode(expanded ? null : p.code); resetForm(); } },
                    { label: txnCount ? "交易记录（" + txnCount + " 笔）" : "查看交易记录", icon: "list", onClick: () => openTxnPanel(p.code, (q && q.name) || p.name) },
                    { label: "设为预警", icon: "bell", onClick: () => openAddAlert(p.code, (q && q.name) || p.name, p.cost > 0 ? { type: "cost_below", value: p.cost } : { type: "price_above", value: q && q.price }) },
                    { sep: true },
                    { label: "删除持仓", icon: "trash", danger: true, onClick: () => { removePosition(p.code); toast("已删除持仓 " + (p.name || p.code)); } },
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
                ? h(TxnPanel, { p, form, setForm, submitTxn, todayDate: quoteDate(q) })
                : null,
            );
          }),
          dropAt(cfg.positions.length) ? h(DropLine) : null),
        h("div", { className: "sl-addbar" },
          h(SearchBox, { placeholder: "搜索添加持仓股…", onPick: (row) => { addPosition(row); toast("已添加持仓 " + row.name + "，右键该行可编辑成本/股数"); } })),
      );
    }

    /**
     * 持仓行的交易抽屉：**只剩记一笔表单**。
     * 成交列表已移到「交易记录」二级页（右键 📒 进入，那里空间更大、能放删除与汇总）。
     * 抽屉留着是为了「顺手补一笔」不用跳页。
     */
    function TxnPanel(props) {
      const { p, form, setForm, submitTxn, todayDate } = props;
      const set = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
      return h(
        "div",
        { className: "sl-txn-panel" },
        h(
          "div",
          { className: "sl-txn-form" },
          h("span", { className: "sl-seg sl-txn-seg" },
            [["buy", "买入"], ["sell", "卖出"]].map(([v, t]) =>
              h("button", { key: v, className: form.side === v ? "on" : "", onClick: () => set("side", v) }, t))),
          h("input", { className: "sl-mini sl-txn-price", type: "number", step: "0.001", min: "0", placeholder: "价格", value: form.price, onChange: (e) => set("price", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-qty", type: "number", step: "100", min: "0", placeholder: "股数", value: form.qty, onChange: (e) => set("qty", e.target.value) }),
          h("input", { className: "sl-mini sl-txn-date-input", type: "date", value: form.date || todayDate || "", onChange: (e) => set("date", e.target.value), "data-sltip": "成交日期（默认今日）" }),
          h("button", { className: "sl-btn sl-txn-add", onClick: () => submitTxn(p) }, "＋记一笔"),
        ),
        h("div", { className: "sl-txn-hint" }, "成交明细见右键「📒 交易记录」"),
      );
    }

    /**
     * 交易记录二级页：只显示**被右键那只股票**的成交（最新在前）。
     * 挂在持仓 tab 下（与预警挂在设置下同一套路），「← 返回」回持仓列表。
     */
    function TxnRecordsView(props) {
      const s = useStore();
      const cfg = s.config;
      const panel = props.panel;
      const listRef = useRef(null);
      // 成交明细按 MAX_VISIBLE_ROWS 封顶（与大盘/自选/持仓同一套 10 行上限）。
      // Hooks 不能放在 early return 之后，所以行数在这里用 cfg 安全取值。
      const rowCount = (() => {
        if (!cfg || !panel) return 0;
        const pp = cfgFind(cfg.positions, panel.code);
        return ((pp && pp.txns) || []).length;
      })();
      const rowCap = useListCap(listRef, rowCount);
      if (!cfg || !panel) return h("div", { className: "sl-empty" }, "加载中…");
      const p = cfgFind(cfg.positions, panel.code);
      const q = s.quotes[panel.code];
      const txns = ((p && p.txns) || []).slice().reverse(); // 最新在前
      const today = quoteDate(q);
      // 汇总：买入额 / 卖出额 / 净股数（净=0 说明已清仓）
      let buyAmt = 0, sellAmt = 0, net = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      const todayTxns = txns.filter((t) => t.date === today);
      return h(
        "div",
        { className: "sl-txnrec" },
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ txnPanel: null }) }, "← 返回"),
            h("span", { className: "sl-dname" }, "📒 交易记录：" + (panel.name || displayCode(panel.code)) + "（" + displayCode(panel.code) + "）"))),
        txns.length === 0
          ? h("div", { className: "sl-empty" }, "还没有交易记录。右键持仓行「记一笔交易」补录。")
          : h(
              react.Fragment,
              null,
              // 汇总条：买入/卖出成交额 + 净股数（清仓时净=0）
              // 用 fmtSigned0 而非 fmtMoney：后者对 0 返回 "-"，汇总里"买 -"读不通
              h("div", { className: "sl-txnrec-sum" },
                h("span", { "data-sltip": "全部买入成交合计 " + fmtExact(buyAmt) + " 元" }, "买 ", h("b", { className: "sl-up" }, fmtSigned0(buyAmt))),
                h("span", { "data-sltip": "全部卖出成交合计 " + fmtExact(sellAmt) + " 元" }, "卖 ", h("b", { className: "sl-down" }, fmtSigned0(sellAmt))),
                h("span", { "data-sltip": "累计净买入股数（0 = 已清仓）" }, "净 ", h("b", null, net + " 股")),
                h("span", { style: { flex: 1 } }),
                h("span", { className: "sl-txnrec-cnt" }, txns.length + " 笔" + (todayTxns.length ? " · 今日 " + todayTxns.length + " 笔" : ""))),
              h("div", { className: "sl-txnrec-head" },
                h("span", null, "方向"), h("span", null, "日期"), h("span", null, "价格"), h("span", null, "股数"), h("span", null, "金额"), h("span", null, "")),
              h("div", {
                className: "sl-txnrec-list" + (rowCap ? " sl-sortable-cap" : ""),
                ref: listRef,
                style: rowCap ? { maxHeight: rowCap + "px" } : null,
              },
                txns.map((t, ti) =>
                  h(
                    "div",
                    { key: t.id, "data-sl-idx": ti, className: "sl-txn-row" },
                    h("span", { className: "sl-txn-side " + (t.qty > 0 ? "sl-up" : "sl-down") }, t.qty > 0 ? "买" : "卖"),
                    h("span", { className: "sl-txn-date" }, t.date || "-"),
                    h("span", { className: "sl-txn-num" }, "@" + fmtPrice(t.price)),
                    h("span", { className: "sl-txn-num" }, Math.abs(t.qty) + "股"),
                    h("span", { className: "sl-txn-amt" }, fmtMoney(Math.abs(t.price * t.qty), "")),
                    t.date === today ? h("span", { className: "sl-txn-today" }, "今") : null,
                    h("button", { className: "sl-x", "data-sltip": "删除该笔成交", onClick: () => removeTxn(panel.code, t.id) }, "✕"),
                  ),
                ))),
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
        // 自动刷新市场（**多选**）：关掉的市场不刷行情、不评估预警、指数栏不因它展开。
        // 「已收盘自动停」按各市场的交易时段判定；这里的开关是叠加在其上的总闸。
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel", "data-sltip": "关闭的市场：不刷新行情、不评估预警\n指数栏也不因它展开。收盘的市场自动停（无需开关）" }, "自动刷新市场"),
          h("span", { className: "sl-seg" },
            [["cn", "A股"], ["hk", "港股"], ["us", "美股"]].map(([k, label]) => {
              const paused = ((cfg.pausedMarkets) || []).includes(k);
              return h("button", {
                key: k,
                className: paused ? "" : "on",
                "data-sltip": paused
                  ? label + "已暂停：不刷新行情、不评估预警、指数栏不因它展开"
                  : label + "自动刷新：收盘后自动停",
                onClick: () => updateConfig((c) => {
                  const cur = Array.isArray(c.pausedMarkets) ? c.pausedMarkets.slice() : [];
                  c.pausedMarkets = paused ? cur.filter((x) => x !== k) : cur.concat([k]);
                  return c;
                }),
              }, label);
            }))),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "涨色 / 跌色"),
          h("span", { style: { display: "flex", gap: 8, alignItems: "center" } },
            h("input", { className: "sl-color", type: "color", value: cfg.riseColor, onChange: (e) => updateConfig((c) => { c.riseColor = e.target.value; return c; }) }),
            h("input", { className: "sl-color", type: "color", value: cfg.fallColor, onChange: (e) => updateConfig((c) => { c.fallColor = e.target.value; return c; }) }))),
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "股票预警"),
          h("button", {
            className: "sl-btn",
            "data-sltip": "规则管理 / 桌面通知",
            onClick: () => openAlertPanel(),
          }, (() => {
            // 触发历史已去掉 → 没有「未读数」可算，改为显示规则条数。
            // 规则不再有启用/停用之分，所以这里就是纯粹的总数。
            const list = cfg.alerts || [];
            return list.length ? "🔔 预警（" + list.length + " 条）" : "🔔 预警";
          })())),
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
            onClick: () => { if (confirm("恢复默认配置？自选/持仓/预警将被清空。")) { localStorage.removeItem(LS_CONFIG); updateConfig(() => ({ version: 1, indices: [], barIndices: [], watchlist: [], positions: [], pollMs: 5000, riseColor: "#f5455c", fallColor: "#1eb980", barStyle: "full", barAlign: "left", barPlacement: "floating", barVisible: true, remind: true, alerts: [], pausedMarkets: [], pnlCurve: true })); } },
          }, "恢复默认")),
        probe
          ? h("div", { className: "sl-note" },
              probe.checks.map((c, i) => h("div", { key: i }, (c.ok ? "✓ " : "✗ ") + c.label + "（" + c.ms + "ms）： " + c.detail)),
              probe.configPath ? "配置文件：" + probe.configPath : "")
          : null,
      );
    }

    // ================================================================ 视图：预警
    function AlertView() {
      const s = useStore();
      const cfg = s.config;
      const [form, setForm] = useState({ code: "", type: "price_above", value: "" });
      const groupRef = useRef(null);
      // 规则按**组**封顶（一组=一只股票），与大盘/自选/持仓同一套 10 行上限。
      // 必须在 early return 之前调用（Hooks 规则），所以 count 用 cfg 安全取值。
      const alertGroups = groupAlerts(cfg && Array.isArray(cfg.alerts) ? cfg.alerts : []);
      const groupCap = useListCap(groupRef, alertGroups.length);
      if (!cfg) return h("div", { className: "sl-empty" }, "加载中…");
      const rules = Array.isArray(cfg.alerts) ? cfg.alerts : [];
      // 触发历史已按要求去掉（Host 不再落盘 events，界面也不再展示）
      const on = cfg.remind !== false; // 总开关
      // 可选代码：自选 + 持仓 + 指数候选（去重，保持用户熟悉的名字）
      const pool = [];
      const seen = new Set();
      for (const list of [cfg.positions, cfg.watchlist, cfg.indices]) {
        for (const x of list || []) {
          if (!x || seen.has(x.code)) continue;
          seen.add(x.code);
          pool.push({ code: x.code, name: x.name || displayCode(x.code) });
        }
      }
      const submit = () => {
        const code = String(form.code || "").trim();
        if (!code) { toast("请先选择或填写股票代码", "#ff5555"); return; }
        const isCost = form.type === "cost_above" || form.type === "cost_below";
        const raw = isCost ? 0 : Number(form.value);
        if (!isCost && (!Number.isFinite(raw) || raw <= 0)) { toast("阈值需为正数", "#ff5555"); return; }
        const hit = pool.find((p) => p.code === code);
        const ok = addAlert({ code, name: hit ? hit.name : displayCode(code), type: form.type, value: raw });
        if (ok) setForm({ code: "", type: form.type, value: "" });
      };
      return h(
        "div",
        { className: "sl-alert" },
        // 二级页返回头：预警不占 tab，从设置页进入（复用详情页的返回样式）
        h("div", { className: "sl-dhead" },
          h("div", { className: "sl-dtop" },
            h("button", { className: "sl-back", onClick: () => setState({ alertPanel: false }) }, "← 返回"),
            h("span", { className: "sl-dname" }, "🔔 预警"),
            h("span", { style: { flex: 1 } }),
            s.alertLive
              ? h("span", { style: { color: "var(--sl-muted)", fontSize: 10 }, "data-sltip": "预警通道已连接：隐藏页面也会保持（零上游请求），触发即推送" }, "通道已连接")
              : null)),
        // 总开关：关掉后规则保留但不评估（Host 侧同样以它为门）
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "预警总开关"),
          h("span", { className: "sl-seg" },
            h("button", {
              className: on ? "on" : "",
              "data-sltip": on ? "已开启：有规则就会评估" : "已关闭：规则保留但不评估",
              onClick: () => updateConfig((c) => { c.remind = !on; return c; }),
            }, on ? "已开启" : "已关闭"))),
        // 桌面通知：权限只在这里申请（用户手势），绝不在加载时弹框（§7.2）
        h("div", { className: "sl-setrow" },
          h("span", { className: "sl-setlabel" }, "桌面通知"),
          h("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
            h("span", {
              className: "sl-alert-unit",
              "data-sltip": s.alertLive
                ? "预警通道已连接：隐藏页面也会保持（零上游请求），触发即推送"
                : "预警通道未连接：触发事件仍由 Host 记录，回到页面会自动对账补齐",
            }, s.alertLive ? "通道已连接" : "通道未连接"),
            h("button", {
              className: "sl-btn" + (s.notifyPerm === "granted" ? "" : " sl-btn-ghost"),
              "data-sltip": notifyPermission() === "unsupported"
                ? "当前环境没有 Notification（webview 常见）：历史与角标照常可用"
                : "点此申请系统通知权限（浏览器要求用户手势，所以不在加载时弹）",
              onClick: () => requestNotifyPermission(),
            }, s.notifyPerm === "granted" ? "通知已开启" : "开启桌面通知"))),
        // 新增规则：代码 + 类型 + 阈值
        h("div", { className: "sl-alert-add" },
          h("input", {
            className: "sl-input", placeholder: "代码/选择", value: form.code, list: "sl-alert-codes",
            onChange: (e) => setForm(Object.assign({}, form, { code: e.target.value })),
          }),
          h("datalist", { id: "sl-alert-codes" }, pool.slice(0, 60).map((p) => h("option", { key: p.code, value: p.code }, p.name))),
          h("select", {
            className: "sl-input sl-alert-type", value: form.type,
            onChange: (e) => setForm(Object.assign({}, form, { type: e.target.value })),
          }, Object.keys(ALERT_TYPE_LABEL).map((t) =>
            h("option", { key: t, value: t, disabled: t === "limit_near" && !/^(sh|sz|bj)/i.test(form.code) }, ALERT_TYPE_LABEL[t]))),
          form.type === "cost_above" || form.type === "cost_below"
            ? h("span", { className: "sl-alert-unit", "data-sltip": "成本类规则不需要阈值：以该股持仓成本价为判据" }, "成本价")
            : h("input", {
                className: "sl-input sl-alert-val", placeholder: "阈值", value: form.value,
                onChange: (e) => setForm(Object.assign({}, form, { value: e.target.value })),
              }),
          form.type === "cost_above" || form.type === "cost_below" ? null
            : h("span", { className: "sl-alert-unit" }, alertUnit(form.type)),
          h("button", { className: "sl-btn", onClick: submit }, "＋ 添加")),
        pool.length === 0
          ? h("div", { className: "sl-note" }, "提示：先在自选/持仓里添加股票，或在上面直接填写代码。")
          : null,
        // 规则列表：**按代码分组的抽屉**（同一只票的多条规则收在一组里）。
        // 分组是派生视图，cfg.alerts 仍是扁平数组、Host 状态机仍按规则 id 索引，
        // 所以存储与评估层完全不感知分组。手风琴单开，与持仓页 openCode 同一套交互。
        rules.length === 0
          ? h("div", { className: "sl-empty" }, "还没有预警规则。可在自选/持仓行右键「设为预警」，或在上方添加。")
          : h("div", {
              className: "sl-alert-list" + (groupCap ? " sl-sortable-cap" : ""),
              ref: groupRef,
              style: groupCap ? { maxHeight: groupCap + "px" } : null,
            }, alertGroups.map((g, gi) => {
              const open = s.alertOpen === g.code;
              const firedN = g.rules.filter((r) => (s.alertStates || {})[r.id] && s.alertStates[r.id].phase === "fired").length;
              return h(
                "div",
                { key: g.code, "data-sl-idx": gi, className: "sl-alert-group" },
                h("div", {
                  className: "sl-alert-ghead",
                  onClick: () => setState({ alertOpen: open ? null : g.code }),
                  "data-sltip": open ? "点击收起该股的预警规则" : "点击展开该股的 " + g.rules.length + " 条规则",
                },
                  h("span", { className: "sl-alert-gnm" }, g.name),
                  h("span", { className: "sl-alert-gcode" }, displayCode(g.code)),
                  h("span", { style: { flex: 1 } }),
                  firedN > 0
                    ? h("span", { className: "sl-alert-fired", "data-sltip": "今日已触发 " + firedN + " 条；回落到滞回带外才会重新待命" }, "已触发 " + firedN)
                    : null,
                  // 纯计数，不是开关：规则没有启用/停用之分（删除即停用）
                  h("span", { className: "sl-alert-gcnt" }, g.rules.length + " 条"),
                  h("span", { className: "sl-alert-garw" }, open ? "▾" : "▸")),
                open
                  ? h("div", { className: "sl-alert-gbody" },
                      g.rules.map((r) => {
                        const st = (s.alertStates || {})[r.id];
                        return h("div", { key: r.id, className: "sl-alert-row" },
                          h("span", { className: "sl-alert-cond" }, alertRuleText(r)),
                          st && st.phase === "fired"
                            ? h("span", { className: "sl-alert-fired", "data-sltip": "今日已触发过；回落到滞回带外才会重新待命" }, "已触发")
                            : null,
                          h("button", { className: "sl-x", "data-sltip": "删除该规则", onClick: () => removeAlert(r.id) }, "✕"));
                      }))
                  : null,
              );
            })),
      );
    }

    /**
     * 右键「设为预警」的规则对话框：预填该股现价/成本价，选类型 + 阈值即可。
     * 结构与定位对齐 EditPosDialog（同样用内联样式 + usePanelRect 贴合悬浮窗），
     * 不引入新的弹层类名——项目里弹层本来就没走 CSS 类。
     */
    function AddAlertDialog() {
      const s = useStore();
      const d = s.addAlert;
      const [type, setType] = useState("price_above");
      const [value, setValue] = useState("");
      const panelRect = usePanelRect(!!d);
      const boxRef = useRef(null);
      // 每次换股票/重新打开时按预填值初始化（成本类不需要阈值）
      useEffect(() => {
        if (!d) return;
        const pre = d.preset || {};
        setType(pre.type || "price_above");
        setValue(Number.isFinite(pre.value) && pre.value > 0 ? String(Math.round(pre.value * 10000) / 10000) : "");
      }, [d && d.code, d && d.preset && d.preset.type]);
      useEffect(() => {
        if (!d) return undefined;
        const onKey = (e) => { if (e.key === "Escape") setState({ addAlert: null }); };
        const onDown = (e) => {
          if (boxRef.current && !boxRef.current.contains(e.target)) setState({ addAlert: null });
        };
        window.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onDown);
        return () => {
          window.removeEventListener("keydown", onKey);
          document.removeEventListener("mousedown", onDown);
        };
      }, [d]);
      if (!d) return null;
      const isCost = type === "cost_above" || type === "cost_below";
      const isLimit = type === "limit_near";
      const limitOk = /^(sh|sz|bj)/i.test(d.code);
      const submit = () => {
        const raw = isCost ? 0 : Number(value);
        if (!isCost && (!Number.isFinite(raw) || raw <= 0)) { toast("阈值需为正数", "#ff5555"); return; }
        const ok = addAlert({ code: d.code, name: d.name, type, value: raw });
        if (ok) setState({ addAlert: null });
      };
      const boxW = 300;
      const cx = panelRect ? panelRect.left + panelRect.width / 2 : window.innerWidth / 2;
      const cy = panelRect ? panelRect.top + panelRect.height / 2 : window.innerHeight / 2;
      const style = { position: "fixed", left: cx, top: cy, transform: "translate(-50%,-50%)", zIndex: 10002, pointerEvents: "auto" };
      const row = (label, node) => h("label", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 } },
        h("span", { className: "sl-setlabel" }, label), node);
      return h(
        "div",
        { className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""), style },
        h(
          "div",
          { ref: boxRef, style: { width: boxW, background: "var(--sl-bg)", border: "1px solid var(--sl-accent-border)", borderRadius: 10, padding: 12, boxShadow: "var(--sl-shadow)", display: "flex", flexDirection: "column", gap: 8 } },
          h("div", { style: { fontWeight: 700, color: "var(--sl-accent)" } }, "🔔 设为预警：" + (d.name || displayCode(d.code)) + "（" + displayCode(d.code) + "）"),
          row("条件", h("select", {
            className: "sl-input", style: { width: 170 }, value: type,
            onChange: (e) => setType(e.target.value),
          }, Object.keys(ALERT_TYPE_LABEL).map((t) =>
            h("option", { key: t, value: t, disabled: t === "limit_near" && !limitOk }, ALERT_TYPE_LABEL[t])))),
          isLimit && !limitOk
            ? h("div", { className: "sl-note" }, "港/美股没有涨跌停，该类型仅对 A 股可用。")
            : null,
          isCost
            ? h("div", { className: "sl-note" }, "以该股持仓成本价为判据（成本缺失时自动跳过，不会误报）。")
            : row("阈值", h("span", { style: { display: "flex", alignItems: "center", gap: 6 } },
                h("input", {
                  className: "sl-input", style: { width: 110 }, type: "number", step: "0.01", min: "0",
                  value, autoFocus: true, placeholder: "阈值",
                  onChange: (e) => setValue(e.target.value),
                  onKeyDown: (e) => { if (e.key === "Enter") submit(); },
                }),
                h("span", { style: { color: "var(--sl-muted)" } }, alertUnit(type)))),
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 } },
            h("button", { className: "sl-btn sl-btn-ghost", onClick: () => setState({ addAlert: null }) }, "取消"),
            h("button", { className: "sl-btn", onClick: submit }, "添加规则")),
        ),
      );
    }

    /**
     * 预警弹窗：触发时**无条件弹出**（页面可见或隐藏都弹），必须手动确认。
     *
     * 为什么不复用 toast：toast 是 pointer-events:none 的单行提示、2.6 秒自散，
     * 极易被忽略；而预警是"错过了就失去意义"的事件。这里的弹窗：
     *   - 挂在 shell.overlay 顶层（fixed + 高 z-index），窗口恢复时一定可见
     *   - **10 秒后自动消失**，也可点击 ✕ / Escape / 点主体立即关掉
     *   - 多条触发时堆叠展示（队列上限 5，避免离开一天回来被刷屏）
     *   - 点击弹窗主体 → 进预警二级页看历史并标记已读
     *
     * ⚠️ 倒计时**只在页面可见时走**：隐藏时暂停。否则弹窗会在你看不见的时候
     * 悄悄过期——那正好违背「隐藏也要能收到预警」这条要求。重新可见后给满 10 秒。
     */
    /**
     * 探测对话区几何：预警弹窗要显示在「对话消息区」里（用户指定位置），
     * 而不是屏幕右上角。用宿主已稳定的 composer 槽位反推：
     *   - composer seat 的父容器即对话面板（消息区 + 输入区）
     *   - 弹窗落在该容器顶部居中，宽度取容器宽度的一部分
     * 找不到时回退视口上方居中（保证任何宿主版本下都能显示）。
     * 与 useComposerAnchor 同款做法：轮询 + resize，容忍宿主改版。
     */
    function useConversationRect(active) {
      const [rect, setRect] = useState(null);
      useEffect(() => {
        if (!active) return undefined;
        let alive = true;
        let last = null;
        const measure = () => {
          if (!alive) return;
          let next = null;
          const seat = document.querySelector("[data-composer-seat]")
            || document.querySelector('[data-conversation-region="composer"]');
          if (seat) {
            // composer 往上找 1~2 层即对话面板容器。
            // ⚠️ 曾爬 3 层：容易越过对话面板爬到侧边栏/应用根容器，
            // 那样"对话区内居中"的基准就偏了，弹窗看着不在中间（实测反馈）。
            // 这里取更保守的 2 层，并对几何做合理性检查（宽度应显著小于视口）。
            let box = seat;
            for (let i = 0; i < 2 && box && box.parentElement; i++) box = box.parentElement;
            const r = box.getBoundingClientRect();
            if (r.width > 200 && r.height > 120 && r.width <= window.innerWidth) {
              next = { left: r.left, top: r.top, width: r.width, height: r.height };
            }
          }
          if (!next) {
            // 回退：**视口居中**（与主路径的居中语义一致）。
            // ⚠️ 这里曾遗留「贴左」（left: 24）——它是"贴左对齐"那版的产物，
            // 用户改回居中后仍留着，导致探测不到 composer seat 时弹窗跑偏到
            // 屏幕左边、看着完全不在中间（实测反馈「中间的没有看到」）。
            // 两条路径必须给出一致的视觉位置。
            const w = Math.min(520, Math.max(200, window.innerWidth - 64));
            next = { left: Math.round((window.innerWidth - w) / 2), top: 72, width: w, height: window.innerHeight - 160 };
          }
          // 诊断钩子：浏览器控制台可查「弹窗实际用的几何 + 是否走了回退」。
          // 排查「弹窗不在中间」这类问题时，比猜宿主 DOM 结构快得多：
          //   __sl_conv_rect__   → { left, top, width, height, fallback }
          globalThis.__sl_conv_rect__ = Object.assign({}, next, { fallback: !seat, vw: window.innerWidth, vh: window.innerHeight });
          if (!last || Math.abs(next.left - last.left) > 1 || Math.abs(next.top - last.top) > 1 || Math.abs(next.width - last.width) > 1) {
            last = next;
            setRect(next);
          }
        };
        measure();
        const iv = setInterval(measure, 500);
        window.addEventListener("resize", measure);
        return () => {
          alive = false;
          clearInterval(iv);
          window.removeEventListener("resize", measure);
        };
      }, [active]);
      return rect;
    }

    const ALERT_POPUP_MS = 10000;
    function AlertPopup() {
      const s = useStore();
      const list = s.alertPopups || [];
      // hook 必须无条件在顶层调用（有弹窗时才需要测量 → 用 active 参数控制内部行为）
      const convRect = useConversationRect(list.length > 0);
      // 已到期的自动关闭：只在可见时推进（隐藏时把剩余时间冻结）
      useEffect(() => {
        if (!list.length) return undefined;
        if (typeof document !== "undefined" && document.hidden) return undefined;
        const started = Date.now();
        // 每条各自计自己的剩余时间：新弹的不会因为旧的在倒计时而被提前清掉
        const timers = list.map((ev) => {
          const age = Date.now() - (Number(ev.shownAt) || started);
          const left = Math.max(0, ALERT_POPUP_MS - age);
          return setTimeout(() => dismissAlertPopup(ev.id), left);
        });
        return () => { for (const t of timers) clearTimeout(t); };
      }, [list.map((x) => x.id).join(","), s.visibleTick]);
      useEffect(() => {
        if (!list.length) return undefined;
        // Escape 关闭最上面一条（与其它弹层习惯一致）
        const onKey = (e) => { if (e.key === "Escape") dismissAlertPopup(list[list.length - 1].id); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [list.length]);
      if (!list.length) return null;
      // 定位：**对话区顶部居中**（用户指定回到 29d4fcf 那版的观感）。
      //   - 探测到对话区：在对话区内水平居中、贴其顶部
      //   - 探测不到：视口居中（translateX(-50%)，与 29d4fcf 回退一致）
      //
      // ⚠️ 相对 29d4fcf 的唯一加强：坐标仍**钳进视口**。那版没钳制，
      // 窗口缩小时弹窗会跑到可视区外（用户实测「全屏可见、缩小就消失」）。
      // 居中语义不变，只是把结果夹在可视范围内。
      const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
      const vh = (typeof window !== "undefined" && window.innerHeight) || 768;
      const conv = convRect;
      // 宽度：优先贴合对话区（上限 560），并夹进视口
      const wantW = conv ? Math.min(560, Math.max(240, conv.width - 48)) : 360;
      const boxW = Math.round(Math.max(200, Math.min(wantW, vw - 32)));
      // 顶部：贴对话区顶部（回退 72）
      const wantTop = conv ? conv.top + 12 : 72;
      const top = Math.round(Math.max(8, Math.min(wantTop, Math.max(8, vh - 120))));
      let style;
      if (conv) {
        // 对话区内居中
        const centered = Math.round(conv.left + (conv.width - boxW) / 2);
        const left = Math.round(Math.max(8, Math.min(centered, vw - boxW - 8)));
        style = {
          position: "fixed", left, top, width: boxW, zIndex: 10005,
          display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto",
          maxHeight: Math.round(Math.min(Math.max(120, conv.height - 32), vh - top - 16)), overflowY: "auto",
        };
      } else {
        // 回退：视口居中（与 29d4fcf 一致），宽度按视口夹紧避免越界
        style = {
          position: "fixed", left: "50%", transform: "translateX(-50%)", top, width: boxW, zIndex: 10005,
          display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto",
          maxHeight: Math.round(Math.max(160, vh - top - 24)), overflowY: "auto",
        };
      }
      return h("div", {
        className: "sl-root sl-theme-" + s.theme + (s.theme === "light" ? " sl-light" : ""),
        style,
      },
        list.map((ev) => h("div", {
          key: ev.id,
          className: "sl-alert-pop",
          role: "alert",
          "data-sltip": "点击进入预警设置；10 秒后自动消失，也可点 ✕ 立即关闭\n同一规则每个交易日只提示一次，次日符合条件时会再提示",
          onClick: () => { openAlertPanel(); },
        },
          h("div", { className: "sl-alert-pop-head" },
            h("span", { className: "sl-alert-pop-title" }, "🔔 预警 · " + ev.name),
            // 叠加计数：本条卡片承载了多少条溢出预警（最多展示 3 条，多余叠到最早那条）
            Number(ev.overflow) > 0
              ? h("span", {
                  className: "sl-alert-pop-more",
                  "data-sltip": "另有 " + ev.overflow + " 条预警被合并到这条（同时最多展示 3 条）",
                }, "+" + ev.overflow)
              : null,
            h("button", {
              className: "sl-x",
              "data-sltip": "立即关闭（不必等 10 秒）",
              onClick: (e) => { e.stopPropagation(); dismissAlertPopup(ev.id); },
            }, "✕")),
          h("div", { className: "sl-alert-pop-row sl-alert-pop-main" },
            h("span", { className: "sl-alert-pop-cond" }, alertRuleText(ev)),
            h("span", { className: "sl-alert-pop-val" }, fmtPrice(ev.price)),
            Number.isFinite(Number(ev.percent))
              ? h("span", { className: Number(ev.percent) > 0 ? "sl-up" : Number(ev.percent) < 0 ? "sl-down" : "sl-flat" }, fmtPct(ev.percent))
              : null,
            h("span", { className: "sl-alert-pop-time" },
              new Date(Number(ev.at) || Date.now()).toLocaleTimeString("zh-CN", { hour12: false }))),
          // 倒计时进度条：让"还剩多久"可见，避免用户以为它会一直留着
          h("div", { className: "sl-alert-pop-bar", style: { animationDuration: ALERT_POPUP_MS + "ms" } }),
        )),
        list.length > 1 || list.some((x) => Number(x.overflow) > 0)
          ? h("button", {
              className: "sl-btn sl-btn-ghost",
              "data-sltip": "关闭全部预警弹窗（含被合并的条数）",
              onClick: () => dismissAllAlertPopups(),
            }, "全部关闭（" + list.reduce((n, x) => n + 1 + (Number(x.overflow) || 0), 0) + "）")
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
        // 五档盘口：跟行情快照一起来，不额外请求；放在图下方，避免挤压 K 线主视图
        h(OrderBook, { q }),
      );
    }

    /**
     * 五档买卖盘（Order Book）。
     *
     * 数据来自行情快照本身的 `q.book`（腾讯同一份响应里就有买一~买五/卖一~卖五），
     * 不额外发请求，跟随现有刷新间隔一起更新。
     *
     * 展示顺序：**卖五~卖一在上、买一~买五在下**（价格自上而下递减），
     * 与券商软件的盘口一致；中间那行是现价。
     * 每档的横条按「该档挂单量 / 十档最大量」画，用来一眼看出哪边压得重。
     */
    function OrderBook(props) {
      const q = props.q;
      const book = q && q.book;
      if (!book || ((book.bids || []).length === 0 && (book.asks || []).length === 0)) {
        return h("div", { className: "sl-empty", style: { padding: "6px 8px" } }, "该股暂无五档盘口数据（停牌、集合竞价前，或港美股不提供）");
      }
      const bids = book.bids || [];
      const asks = book.asks || [];
      const maxQty = Math.max(1, ...bids.map((x) => x.qty), ...asks.map((x) => x.qty));
      // 委比 = (买量 − 卖量) / (买量 + 卖量)，衡量盘口多空压力
      const sumB = bids.reduce((a, x) => a + x.qty, 0);
      const sumA = asks.reduce((a, x) => a + x.qty, 0);
      const ratio = sumB + sumA > 0 ? ((sumB - sumA) / (sumB + sumA)) * 100 : null;
      const row = (side, lv, x) => {
        const isBid = side === "bid";
        const tip = (isBid ? "买" : "卖") + lv + " " + fmtPrice(x.price) + "\n挂单 " + fmtQty(x.qty, q.code) + "（" + x.qty + " 股）";
        return h("div", { key: side + lv, className: "sl-ob-row " + (isBid ? "sl-ob-bid" : "sl-ob-ask"), "data-sltip": tip },
          h("span", { className: "sl-ob-lv" }, (isBid ? "买" : "卖") + lv),
          h("span", { className: "sl-ob-price" }, fmtPrice(x.price)),
          h("span", { className: "sl-ob-qty" }, fmtQty(x.qty, q.code)),
          h("span", { className: "sl-ob-bar" }, h("i", { style: { width: Math.max(2, Math.round((x.qty / maxQty) * 100)) + "%" } })));
      };
      // 卖盘倒序：卖五在最上，卖一贴近现价
      const askRows = asks.map((x, i) => row("ask", i + 1, x)).reverse();
      return h("div", { className: "sl-ob" },
        h("div", { className: "sl-ob-head" },
          h("span", null, "五档盘口"),
          h("span", { style: { flex: 1 } }),
          ratio !== null
            ? h("span", {
                className: ratio > 0 ? "sl-up" : ratio < 0 ? "sl-down" : "sl-flat",
                "data-sltip": "委比 = (买五档总量 − 卖五档总量) ÷ 两者之和\n买 " + sumB + " 股 / 卖 " + sumA + " 股",
              }, "委比 " + (ratio > 0 ? "+" : "") + ratio.toFixed(1) + "%")
            : null),
        asks.length ? askRows : null,
        h("div", { className: "sl-ob-mid" },
          h("span", null, "现价"),
          h("b", { style: { color: q.percent > 0 ? "var(--sl-up)" : q.percent < 0 ? "var(--sl-down)" : "var(--sl-flat)" } }, fmtPrice(q.price))),
        bids.length ? bids.map((x, i) => row("bid", i + 1, x)) : null);
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
                h("button", {
                  key: t,
                  className: "sl-tab" + (s.tab === t && !s.detail && !s.alertPanel && !s.txnPanel ? " sl-tab-on" : ""),
                  // 点任何 tab 都退出二级页（预警/交易记录分别挂在设置、持仓下，否则会「点了持仓却还停在交易记录」）
                  onClick: () => setState({ tab: t, detail: null, alertPanel: false, txnPanel: null }),
                }, label))),
            h(FreshBadge, { updatedAt: s.updatedAt, pollMs: s.config && s.config.pollMs }),
            h("button", { className: "sl-icon", "data-sltip": "立即刷新", onClick: () => refreshQuotes() }, "⟳"),
            themeBtn,
            h("button", { className: "sl-icon", "data-sltip": "关闭", onClick: closeOverlay }, "✕"),
          ),
          h("div", { className: "sl-body" },
            s.detail
              ? h(DetailView, { detail: s.detail })
              : s.tab === "market" ? h(MarketView)
                : s.tab === "watch" ? h(WatchView)
                  : s.tab === "position" ? (s.txnPanel ? h(TxnRecordsView, { panel: s.txnPanel }) : h(PositionView))
                    : s.alertPanel ? h(AlertView)
                      : h(SettingsView)),
          h("div", { className: "sl-foot" },
            h("span", null, s.error ? "⚠ " + s.error : "腾讯行情"),
            h("span", null, s.updatedAt ? "更新 " + new Date(s.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—")),
        ),
        s.toast ? h("div", { key: s.toast.id, className: "sl-toast", style: s.toast.color ? { color: s.toast.color } : undefined }, s.toast.text) : null,
        s.sug ? h(SearchSuggest, { sug: s.sug, theme: s.theme }) : null,
        h(ContextMenu, { menu: s.menu }),
        h(EditPosDialog),
        h(AddAlertDialog),
        // ⚠️ 预警弹窗**不在这里**：Overlay 开头有 `if (!s.open) return null`，
        // 放在这里会导致「悬浮窗关着时预警弹窗也不显示」（用户实测反馈）。
        // 它已改为独立 slot 注册（见 apply 里的 alert-popup），与悬浮窗开关解耦。
      );
    }

    // ================================================================ 指数栏（左下角）
    /** 共享的指数栏内容（大盘圆点 + 指数胶囊 + 📈/⚙ 按钮）。dock 与 floating 两种放置复用。 */
    function renderBarContent(s, cfg, gearProps) {
      const items = barItems(s, cfg);
      const anyOpen = items.some((x) => isMarketOpen(x.idx.code));
      // 收盘后指数和收益都是昨天的数字，摆在桌面上只是噪音 → 只留状态点 + 设置。
      // 一个指数都没配时保留「＋ 选择指数」的引导（没有可收起的东西）。
      const bar = barExpandedNow(s, cfg);
      const expanded = bar.expanded;
      const earn = computeEarnings(cfg, s.quotes);
      return h(
        "div",
        { className: "sl-bar sl-align-" + (cfg.barAlign || "left") },
        h("span", {
          className: "sl-bar-dot" + (anyOpen ? " sl-open" : ""),
          // 点一下收起/展开：收起后索引胶囊没了，这条同时是切换开关和进大盘页的入口
          onClick: () => toggleBarExpand(s, cfg),
          "data-sltip": bar.force === null
            ? (expanded ? "盘中，点击收起" : anyOpen ? "盘中，点击展开" : "非交易时段，点击展开")
            : (expanded ? "手动展开中" : "手动收起中"),
          style: { flex: "none", cursor: "pointer" },
        }),
        expanded
          ? items.length === 0
            ? h("span", { className: "sl-chip", onClick: () => openOverlay("market"), "data-sltip": "点击选择要常驻显示的大盘指数" }, "＋ 选择指数显示在这里")
            : items.map(({ idx, q }) =>
                h(IndexChip, { key: idx.code, idx, q, theme: s.theme, onOpen: () => openOverlay("market") }))
          : null,
        expanded && earn.has
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

    /**
     * 定时强制重渲染，让指数栏的「按时段展开/收起」不依赖行情推送。
     *
     * 没有它就只能靠每次 /quotes 顺带重渲染来跨过 9:25 / 15:05 这两个边界；
     * 一旦断网或 SSE 停了，收盘后栏就会一直挂着昨天的数字不收。
     * 30s 一跳足够——展开/收起的精度需求本来就是分钟级。
     */
    function useClockTick(ms) {
      const [, force] = useState(0);
      useEffect(() => {
        const t = setInterval(() => force((n) => n + 1), ms || 30000);
        return () => clearInterval(t);
      }, [ms]);
    }

    /**
     * 放置模式 dock：嵌入 conversation.composer.dock（仅已有对话生效，平台限制）。
     *
     * 位置：宿主把该槽位与「上下文占用（52%）」并排放在同一个 flex 行里，且**槽位在前**：
     *   <div class="..._dock">  ← display:flex; justify-content:center; gap:12px
     *     {dock 槽位}            ← 我们
     *     <ContextMeter/>        ← 52%
     *   </div>
     * 需求是排在 52% **之后**，所以给自己 `order:1`（ContextMeter 保持默认 order:0）。
     * 用 order 而不是去改宿主 DOM：容器类名是哈希的（如 RlGAzG_dock），跨版本会变，
     * 而 order 只作用在自己身上，宿主改版也不会失效。
     */
    function IndexBar() {
      const s = useStore();
      useEffect(() => { initStore(); }, []);
      useClockTick(30000);
      const cfg = s.config;
      if (!cfg || !cfg.barVisible || s.barPlacement !== "dock") return null;
      return h("div", rootProps(s, cfg, { order: 1 }), renderBarContent(s, cfg));
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
      useClockTick(30000); // 保证按时段展开/收起不依赖行情推送
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
      // 预警弹窗：**独立 slot**，与悬浮窗（Overlay）的 open 状态解耦。
      // 曾经挂在 Overlay 内部 → 悬浮窗关着时 `if (!s.open) return null` 会连带
      // 把弹窗一起吞掉，导致「不打开悬浮窗就收不到预警」（用户实测反馈）。
      // order 取 1000：排在提示层（999）之后，保证预警在最上层。
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.alert-popup", order: 1000 }, () => withBoundary(h(AlertPopup))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek.floating-bar", order: -10 }, () => withBoundary(h(FloatingIndexBar))));
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "dsh-stock-leek" }, (props) => withBoundary(h(Overlay, props))));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
