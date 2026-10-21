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
