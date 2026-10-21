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
/* 五档盘口：**左卖右买**两列 */
.sl-ob{display:flex;flex-direction:column;gap:2px;padding:6px 8px 8px;margin:0 6px 8px;border:1px solid var(--sl-border-soft);border-radius:8px;background:var(--sl-bg2)}
.sl-ob-head{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--sl-muted);margin-bottom:2px}
/* 手数/金额切换 */
.sl-ob-unit{display:inline-flex;gap:0;border:1px solid var(--sl-border-soft);border-radius:5px;overflow:hidden;flex:none}
.sl-ob-unit button{background:transparent;border:none;color:var(--sl-muted);cursor:pointer;font:inherit;font-size:10px;line-height:1;padding:2px 7px}
.sl-ob-unit button:hover{color:var(--sl-text);background:var(--sl-hover)}
.sl-ob-unit button.on{color:var(--sl-accent);background:var(--sl-accent-soft)}
.sl-ob-ratio{flex:none;font-size:10px;font-variant-numeric:tabular-nums}
/* 两列列头 */
.sl-ob-cols{display:flex;gap:10px;font-size:10px;color:var(--sl-muted);padding:0 4px 2px;border-bottom:1px solid var(--sl-border-soft)}
.sl-ob-colhead{flex:1;min-width:0}
.sl-ob-t-bid{text-align:right}
/* 主体：左卖右买，两列各 5 行 */
.sl-ob-body{display:flex;gap:10px}
.sl-ob-side{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.sl-ob-row{position:relative;display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 4px;border-radius:4px;font-variant-numeric:tabular-nums;overflow:hidden;min-height:18px}
.sl-ob-row:hover{background:var(--sl-hover)}
/* 占位行：某侧不足五档时保持两列等高，避免左右错位 */
.sl-ob-pad{visibility:hidden}
.sl-ob-lv{flex:none;width:24px;color:var(--sl-muted);font-size:10px}
.sl-ob-price{flex:none;width:62px;text-align:right}
.sl-ob-qty{flex:1;min-width:0;text-align:right;color:var(--sl-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 横条：铺在行底，宽度按当前口径（手数/金额）占十档最大值的比例 */
.sl-ob-bar{position:absolute;left:0;top:0;bottom:0;width:100%;pointer-events:none;display:flex;opacity:.16}
.sl-ob-bar i{display:block;height:100%}
/* 卖盘横条从右往左长（贴着中间），买盘从左往右长 —— 两列视觉上向中间收敛 */
.sl-ob-ask .sl-ob-bar{justify-content:flex-end}
.sl-ob-ask .sl-ob-bar i{border-radius:4px 0 0 4px}
.sl-ob-bid .sl-ob-bar{justify-content:flex-start}
.sl-ob-bid .sl-ob-bar i{border-radius:0 4px 4px 0}
.sl-ob-ask .sl-ob-price{color:var(--sl-down)}
.sl-ob-ask .sl-ob-bar i{background:var(--sl-down)}
.sl-ob-bid .sl-ob-price{color:var(--sl-up)}
.sl-ob-bid .sl-ob-bar i{background:var(--sl-up)}
/* ---- 上下结构：卖5→卖1 / 现价 / 买1→买5（券商软件惯例） ---- */
.sl-ob-rows .sl-ob-stack{display:flex;flex-direction:column;gap:1px}
/* 上下结构是单列铺满，行内横条从右往左长（读数区在左，条贴在右） */
.sl-ob-rows .sl-ob-lv{width:28px}
.sl-ob-rows .sl-ob-price{width:84px}
.sl-ob-rows .sl-ob-qty{flex:1}
.sl-ob-rows .sl-ob-bar{justify-content:flex-end}
.sl-ob-rows .sl-ob-bar i{border-radius:4px 0 0 4px}
/* ---- 集合竞价：没有真实盘口，只显示虚拟匹配价/可匹配量 ---- */
.sl-ob-auction-row{display:flex;align-items:center;gap:8px;font-size:11px;padding:4px;border-radius:5px;background:var(--sl-bg);font-variant-numeric:tabular-nums}
.sl-ob-auction-tag{flex:none;font-size:10px;color:var(--sl-warn);border:1px solid var(--sl-warn);border-radius:4px;padding:0 4px}
.sl-ob-auction-px{flex:none;font-weight:600}
.sl-ob-auction-qty{flex:none;color:var(--sl-dim)}
.sl-ob-auction-hint{flex:none;font-size:10px;color:var(--sl-muted)}
.sl-ob-auction-note{font-size:10px;color:var(--sl-muted);padding:2px 4px 0}
/* 中间现价行：把上下两半分开 */
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
