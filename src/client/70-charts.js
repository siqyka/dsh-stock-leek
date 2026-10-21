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
