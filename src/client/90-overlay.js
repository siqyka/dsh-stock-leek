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
