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
