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
