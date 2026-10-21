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
