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
     * composer 常驻底部（不随消息滚动），故轮询 + resize 重测即可。
     *
     * **找不到 composer 时不能跳到「视口最左边」**——插件、远程工作区这类面板
     * 根本没有对话输入区（不是新会话页那种"有输入框但没消息"的情况，是真的整块 UI 被替换），
     * 于是每 400ms 的测量都会走兜底分支，悬浮栏就从原来的位置猛地塌到 x=16（用户报的"跑到最左侧"）。
     *
     * 正确行为是**粘住上一次的有效位置**：看不到 composer 就当作"没变化"，
     * 让栏留在原地（面板关掉、对话回来的那一帧自然又跟上新的输入区）。
     * 只有从头到尾**一次都没测到过** composer 时才用兜底坐标（此时本来也没有对话区可对齐）。
     */
