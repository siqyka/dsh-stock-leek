    function shouldExpandBar(code, now) {
      now = now || marketNow();
      const c = String(code || "").toLowerCase();
      if (marketPaused(c, state.config && state.config.pausedMarkets)) return false; // 开关关掉 → 不参与展开
      const wd = now.getDay();
      if (wd === 0 || wd === 6) return false; // 周末一律收起
      const ws = marketWindows(c);
      if (!ws.length) return false; // 未知市场：保守收起
      const t = marketMinutes(c, now);
      const openAt = ws[0][0];
      const closeAt = ws[ws.length - 1][1];
      return t >= openAt - BAR_LEAD_MIN && t <= closeAt + BAR_LAG_MIN;
    }
    /**
     * 指数栏当前实际是否展开：手动覆盖优先于时段判断。
     * `barForce` 跨交易日自动失效——否则昨天临收盘手动收起，今天开盘也不展。
     */
    function barExpandedNow(s, cfg) {
      const items = barItems(s, cfg);
      const auto = items.length === 0 ? true : items.some((x) => shouldExpandBar(x.idx.code));
      const day = items.length && items[0].q ? quoteDate(items[0].q) : "";
      const force = state.barForceDay === day ? state.barForce : null;
      return { expanded: force === null ? auto : force, auto: auto, force: force };
    }
    /** 指数栏上排的指数（含没行情的） */
    function barItems(s, cfg) {
      return cfg.barIndices.map((code) => ({ idx: cfgFind(cfg.indices, code) || { code, name: displayCode(code) }, q: s.quotes[code] })).filter((x) => x.idx);
    }
    /**
     * 点状态点切换展开/收起：当前展开 → 收起，当前收起 → 展开。
     *
     * 手动选择会一直生效到**下一个交易日**（barForceDay 过期即失效），
     * 所以"临收盘手动收起"不会粘住明天开盘。不做"再点一下退回自动"——
     * 那样点出来的状态和自动状态永远观测不到同一种情形，反而更难预期。
     */
    function toggleBarExpand(s, cfg) {
      const now = barExpandedNow(s, cfg);
      const items = barItems(s, cfg);
      const day = items.length && items[0].q ? quoteDate(items[0].q) : "";
      setState({ barForce: !now.expanded, barForceDay: day });
    }

    async function api(path, params) {
      const qs = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      }
      const q = qs.toString();
      const res = await fetch(BASE + path + (q ? "?" + q : ""), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }
    async function apiPost(path, body) {
      const res = await fetch(BASE + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    // ================================================================ store（配置 + 行情 + 轮询，dock 与悬浮窗共享）
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
