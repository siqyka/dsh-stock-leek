    const listeners = new Set();
    let state = {
      config: null, // {indices, barIndices, watchlist, positions, pollMs, riseColor, fallColor, barStyle, barAlign, barVisible}
      quotes: {}, // code -> quote row
      updatedAt: 0,
      error: null,
      open: false, // 悬浮窗
      tab: "market",
      detail: null, // {code, name}
      toast: null,
      configWarning: null, // 配置损坏告警 {text, id}（设置页常驻条，直到关闭或保存成功）
      live: false, // 是否已建立 SSE 实时通道（false = 回落轮询）
      menu: null, // 右键菜单 {x, y, items, header, id}
      editPos: null, // 持仓编辑对话框 {code, name, cost, qty}
      tip: null, // 通用悬浮提示 {x, y, text}（全局委托 [data-sltip]）
      sug: null, // 搜索下拉（提升到 overlay 根层渲染）{rect, rows, busy, empty, onPick}
      theme: "dark",
      barPlacement: "floating", // dock | floating（本地偏好，默认悬浮：新会话页也能显示）
      barPos: null, // 悬浮栏手动位置 {x,y}；null=自动锚定（初始化时从 localStorage 读）
      barForce: null, // 指数栏展开的手动覆盖：null=按时段自动，true=强制展开，false=强制收起
      barForceDay: "", // 手动覆盖所属的行情日期；跨交易日自动失效（别让昨天的选择粘住今天）
      alertStates: {}, // ruleId → {phase, day}，展示每条规则的「已触发/待命」
      alertPanel: false, // 设置页里的预警二级页是否打开（预警不占 tab，从设置进入）
      alertLive: false, // 预警推送通道是否已连上（隐藏时也保持连接）
      alertPopups: [], // 待确认的预警弹窗队列 [{id, name, code, type, value, price, percent, at, shownAt}]
      visibleTick: 0, // 可见性变化计数：让预警弹窗的 10s 计时在恢复可见后重跑
      notifyPerm: "default", // 桌面通知权限：granted | denied | default | unsupported
      addAlert: null, // 右键「设为预警」弹出的规则对话框 {code, name, preset}
      alertOpen: null, // 预警页按代码分组的抽屉：当前展开的 code（单值手风琴，同持仓页 openCode）
      txnPanel: null, // 交易记录二级页 {code, name}；null=未打开。只显示被右键那只股票的成交
    };
    function setState(patch) {
      state = Object.assign({}, state, patch);
      // 测试钩子：暴露当前 store，供 e2e 读取真实配置（如 pollMs）而非猜测。
      // 用 globalThis 而非 export —— 这里是浏览器工厂，没有模块出口。
      globalThis.__sl_test_state__ = state;
      for (const l of listeners) l();
    }
    function subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    }
    function useStore() {
      return useSyncExternalStore(subscribe, () => state, () => state);
    }
    function toast(text, color) {
      setState({ toast: { text, color: color || null, id: Date.now() } });
      setTimeout(() => {
        if (state.toast && state.toast.text === text) setState({ toast: null });
      }, 2600);
    }
    /**
     * 配置损坏告警：比 toast 更持久（配置类问题不该 2.6 秒就消失），
     * 存进 state.configWarning，由设置页顶部常驻条展示，直到用户保存配置或手动关闭。
     */
    function configWarning(text) {
      setState({ configWarning: { text: String(text || ""), id: Date.now() } });
    }
    function dismissConfigWarning() {
      setState({ configWarning: null });
    }

    /** 指数栏放置方式（本地偏好）：floating 悬浮锚定（新会话页也显示）/ dock 嵌入 composer.dock */
    function setBarPlacement(v) {
      const next = v === "dock" ? "dock" : "floating";
      setState({ barPlacement: next });
      try { localStorage.setItem(LS_PLACEMENT, next); } catch { /* ignore */ }
    }

    /** 打开右键菜单（items=[{label,danger,onClick}|{sep:true}]，header 为小字标题） */
    function openMenu(e, items, header) {
      e.preventDefault();
      e.stopPropagation();
      setState({ menu: { x: e.clientX, y: e.clientY, items, header: header || null, id: Date.now() } });
    }
    function closeMenu() {
      if (state.menu) setState({ menu: null });
    }
    /** 置顶：把 cfg[listKey] 中该 code 的项移到第一位 */
    function pinTop(listKey, code) {
      updateConfig((cfg) => {
        const arr = cfg[listKey];
        if (!Array.isArray(arr)) return null;
        const i = arr.findIndex((x) => x.code === code);
        if (i <= 0) return null; // 已在首位或不存在
        const [item] = arr.splice(i, 1);
        arr.unshift(item);
        return cfg;
      });
    }
    /** 打开持仓编辑对话框（成本/股数） */
    function openEditPos(p) {
      closeMenu();
      setState({ editPos: { code: p.code, name: p.name || displayCode(p.code), cost: String(p.cost || ""), qty: String(p.qty || "") } });
    }

    /** 悬浮栏位置：{x,y}=手动；null=回到自动锚定。persist=false 仅更新内存（拖动中高频），抬起时再落盘 */
    function setBarPos(pos, persist) {
      // 防御：坐标 NaN（如测量失败）会让 JSON 落盘成 null，位置信息无声丢失 → 拒绝写入
      if (pos && (!Number.isFinite(pos.x) || !Number.isFinite(pos.y))) {
        setState({ barPos: null });
        return;
      }
      setState({ barPos: pos });
      if (persist === false) return;
      try {
        if (pos) localStorage.setItem(LS_BAR_POS, JSON.stringify(pos));
        else localStorage.removeItem(LS_BAR_POS);
      } catch { /* ignore */ }
    }

    /**
 * 多标签页配置同步。
 *
 * 问题：每个标签页各持一份内存副本，各自 POST，最后写的赢 —— 先写页面的改动无声丢失。
 * 方案：写入成功后用 BroadcastChannel 广播最新配置，其他标签页立即采用（不再各写各的）。
 * 降级：环境不支持 BroadcastChannel 时靠 Host 的 __rev + conflict 字段兜底告警。
 */
const CFG_CHANNEL = "dsh-stock-leek.config";
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
