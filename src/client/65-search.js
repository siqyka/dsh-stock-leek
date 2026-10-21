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
