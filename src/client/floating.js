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
