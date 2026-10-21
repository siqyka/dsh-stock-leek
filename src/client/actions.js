    let inited = false;
    async function initStore() {
      if (inited) return;
      inited = true;
      try {
        const t = localStorage.getItem(LS_THEME);
        if (t === "light" || t === "dark") setState({ theme: t });
      } catch { /* ignore */ }
      try {
        const p = localStorage.getItem(LS_PLACEMENT);
        if (p === "dock" || p === "floating") setState({ barPlacement: p });
      } catch { /* ignore */ }
      try {
        const bp = localStorage.getItem(LS_BAR_POS);
        if (bp) {
          const o = JSON.parse(bp);
          if (o && typeof o.x === "number" && typeof o.y === "number") setState({ barPos: o });
        }
      } catch { /* ignore */ }
      let cfg = null;
      try {
        const raw = localStorage.getItem(LS_CONFIG);
        if (raw) cfg = JSON.parse(raw);
      } catch { /* ignore */ }

      // 通知权限只**读**不申请（申请必须由用户手势触发，§7.2）
      setState({ notifyPerm: notifyPermission() });
      if (cfg && Array.isArray(cfg.indices)) setState({ config: cfg });
      try {
        const r = await api("/config");
        if (r && r.config) {
          // 兼容旧版 host：其不认识的可选字段（如 ma/alerts）会被丢弃，优先保留本地已有值
          const merged = Object.assign({}, r.config);
          if (!Array.isArray(merged.ma) && cfg && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
          // 老 Host 的白名单重建会吃掉 alerts（与当年 ma 被吃同一个坑）：
          // 本地有规则而回包没有 → 保留本地，避免 UI 上规则凭空消失
          if (!Array.isArray(merged.alerts) && cfg && Array.isArray(cfg.alerts)) merged.alerts = cfg.alerts;
          // 同上：老 Host 吃掉 pausedMarkets（市场开关）时保留本地选择
          if (!Array.isArray(merged.pausedMarkets) && cfg && Array.isArray(cfg.pausedMarkets)) merged.pausedMarkets = cfg.pausedMarkets;
          setState({ config: merged });
          try { localStorage.setItem(LS_CONFIG, JSON.stringify(merged)); } catch { /* ignore */ }
        }
        if (Array.isArray(r.quotes)) {
          const quotes = Object.assign({}, state.quotes);
          for (const row of r.quotes) quotes[row.code] = row;
          setState({ quotes, updatedAt: r.updatedAt || Date.now() });
        }
        if (r && r.warning) {
          // 配置文件损坏：明确告知，不要静默吞掉用户的持仓数据
          configWarning(r.warning);
        }
      } catch { /* host 不可达：用本地缓存 */ }
      startPolling();
      refreshAlerts(); // 首屏补一次规则状态（不等 alert-stream 连上）
      openAlertStream(); // 预警通道与行情通道独立：隐藏不断，重连先对账
    }

    // 配置操作 helpers
    function cfgFind(list, code) {
      return list.find((x) => x.code === code);
    }
    function addIndex(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.indices, item.code)) {
          toast("该指数已在列表中");
          return null;
        }
        cfg.indices.push({ code: item.code, name: item.name || displayCode(item.code) });
        return cfg;
      });
    }
    function removeIndex(code) {
      updateConfig((cfg) => {
        cfg.indices = cfg.indices.filter((x) => x.code !== code);
        cfg.barIndices = cfg.barIndices.filter((x) => x !== code);
        return cfg;
      });
    }
    function toggleMa(period) {
      // MA 选择全局通用：写回配置，跨股票/周期/会话保持
      updateConfig((c) => {
        const cur = Array.isArray(c.ma) ? c.ma.slice() : [5, 10, 20];
        const i = cur.indexOf(period);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(period);
        c.ma = MA_ALL.filter((p) => cur.indexOf(p) >= 0); // 固定顺序
        return c;
      });
    }
    function toggleBarIndex(code) {
      updateConfig((cfg) => {
        const i = cfg.barIndices.indexOf(code);
        if (i >= 0) cfg.barIndices.splice(i, 1);
        else {
          if (cfg.barIndices.length >= 8) {
            toast("指数栏最多显示 8 个");
            return null;
          }
          cfg.barIndices.push(code);
        }
        return cfg;
      });
    }
    /** 通用重排（拖动排序）：把 cfg[key] 列表第 from 项移动到 to 位置 */
    function reorderList(key, from, to) {
      updateConfig((cfg) => {
        const arr = cfg[key];
        if (!Array.isArray(arr) || from < 0 || from >= arr.length) return null;
        const [item] = arr.splice(from, 1);
        arr.splice(Math.max(0, Math.min(arr.length, to)), 0, item);
        return cfg;
      });
    }
    /** 拖动排序后短暂抑制 click（跨浏览器：pointer capture 释放后 click 目标不确定） */
    let slDragStamp = 0;
    function justDragged() {
      return Date.now() - slDragStamp < 250;
    }
    /**
     * 左键拖动排序 hook：listRef 指向包含各行的容器（每行带 data-sl-idx）。
     * 返回 { drag, startDrag }；drag={from,overAt} 用于渲染落点指示线，startDrag(index,e) 挂到行手柄。
     */
    function useDragReorder(listRef, commit) {
      const [drag, setDrag] = useState(null);
      const dragRef = useRef(null);
      const commitRef = useRef(commit);
      commitRef.current = commit;
      const dragging = !!drag;
      const startDrag = (index, e) => {
        if (e.button !== undefined && e.button !== 0) return; // 仅左键
        dragRef.current = { from: index, overAt: index, moved: false };
        setDrag({ from: index, overAt: index });
        e.preventDefault();
        // 指针捕获：后续 move/up 重定向到手柄，事件仍冒泡到 window 监听
        try { if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId !== undefined) e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      useEffect(() => {
        if (!dragging) return undefined;
        const onMove = (ev) => {
          const d = dragRef.current;
          const container = listRef.current;
          if (!d || !container) return;
          const rows = Array.prototype.slice.call(container.querySelectorAll("[data-sl-idx]"));
          let overAt = d.from;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { overAt = i; break; }
            overAt = i + 1;
          }
          if (overAt !== d.from) d.moved = true;
          if (overAt !== d.overAt) { d.overAt = overAt; setDrag({ from: d.from, overAt: overAt }); }
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!d) return;
          slDragStamp = Date.now(); // 抑制紧随的 click（避免误开详情）
          let to = d.overAt;
          if (to > d.from) to -= 1; // 移除自身后目标位前移
          if (to !== d.from) commitRef.current(d.from, to);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
      }, [dragging]);
      return { drag, startDrag };
    }
    /** 落点指示线（在行之间） */
    function DropLine() {
      return h("div", { className: "sl-dropline" });
    }

    /** 列表超过该行数时，内部出现滚动条（表头与搜索框留在视野内） */
    const MAX_VISIBLE_ROWS = 10;

    /**
     * 给可排序列表加「最多显示 MAX_VISIBLE_ROWS 行」的上限。
     *
     * 上限按**实测行高**算，而不是写死像素：大盘行是两行式名称（名称+代码），
     * 自选行更矮，写死常量会在其中一种布局下多露半行或提前截断。
     *
     * 行高取前若干行的**最小值**：持仓行展开后会多出交易面板，比收起时高得多，
     * 若恰好用第一行（可能正展开着）当基准，上限会被撑成一大截，等于没限制。
     *
     * 行数不足上限时返回 null，不加 class，让容器自然撑开
     * （否则会出现"能滚但没内容"的空滚动条）。
     *
     * 用 ResizeObserver 跟踪：窗口缩放会改变字号进而改变行高，只测一次会失准。
     */
    function useListCap(listRef, count) {
      const [cap, setCap] = useState(null);
      useEffect(() => {
        const el = listRef.current;
        if (!el) return undefined;
        const measure = () => {
          if (count <= MAX_VISIBLE_ROWS) { setCap(null); return; }
          const rows = el.querySelectorAll("[data-sl-idx]");
          let rowH = 0;
          const n = Math.min(rows.length, 12);
          for (let i = 0; i < n; i++) {
            const h = rows[i].getBoundingClientRect().height;
            // 测试环境与首帧可能量不到高度，量不到就保持现状，等下一轮
            if (h > 0 && (rowH === 0 || h < rowH)) rowH = h;
          }
          if (!rowH) return;
          setCap(Math.round(rowH * MAX_VISIBLE_ROWS) + 1);
        };
        measure();
        let ro = null;
        try {
          if (typeof ResizeObserver === "function") {
            ro = new ResizeObserver(measure);
            ro.observe(el);
          }
        } catch { /* 老浏览器无 ResizeObserver，量一次也够用 */ }
        return () => { if (ro) ro.disconnect(); };
      }, [listRef, count]);
      return cap;
    }

    function addWatch(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.watchlist, item.code)) {
          toast("已在自选列表中");
          return null;
        }
        cfg.watchlist.push({ code: item.code, name: item.name || displayCode(item.code), addedAt: Date.now() });
        refreshQuotes();
        return cfg;
      });
    }
    function removeWatch(code) {
      updateConfig((cfg) => {
        cfg.watchlist = cfg.watchlist.filter((x) => x.code !== code);
        return cfg;
      });
    }
    function addPosition(item) {
      updateConfig((cfg) => {
        if (cfgFind(cfg.positions, item.code)) {
          toast("该持仓股已存在");
          return null;
        }
        cfg.positions.push({ code: item.code, name: item.name || displayCode(item.code), cost: 0, qty: 0 });
        refreshQuotes();
        return cfg;
      });
    }
    /**
     * 更新持仓（成本/股数等）。
     *
     * 记下 `openedAt` = 建仓当天的**行情日期**，供 todayPnl 区分
     * 「今天刚建的仓」与「昨天就持有、今天没动」——前者今日盈亏要按成本算，
     * 否则会凭空多出「昨天就持有」的浮盈（实测：成本 52.435/现价 52.390/昨收 52.310，
     * 界面显示 +80，真实是 −45）。
     *
     * **只在真发生"从空仓变成有仓"的那一刻写入**（prevQty 为 0 → nextQty > 0）。
     * 刻意不给已存在的老持仓补记：它们的建仓日无从推断，硬补会把「昨天就持有」
     * 误判成「今天建的」，让今日盈亏从昨收口径突变成成本口径、数字凭空跳变。
     * 老持仓保持旧口径，用户重新建仓（删掉再加）才会启用新口径。
     * 已有 openedAt 一律不覆盖——否则每次改股数都会把建仓日刷成今天。
     * 口径与 quoteDate 一致（行情日期而非本地日期，天然跳过周末）。
     */
    function updatePosition(code, patch) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p) return null;
        const prevQty = p.qty || 0;
        Object.assign(p, patch);
        const nextQty = p.qty || 0;
        if (!p.openedAt && prevQty <= 0 && nextQty > 0) {
          p.openedAt = quoteDate(state.quotes[code]);
        }
        // 编辑对话框改的是**基准持仓**（不是当前持仓）。
        // 关键：用户可能先记了几笔交易、再回头改成本/股数——那次修改等于宣告
        // 「此刻持仓就是这样」，之前的流水已被吸收，不能再叠加一遍（否则双重计算）。
        // 所以这里刷新 baseAt=现在，只让**之后**记的流水参与 replay。
        if (p.txns && p.txns.length) {
          p.baseQty = nextQty;
          p.baseCost = p.cost || 0;
          p.baseAt = Date.now();
          // 一律走 replay 得出当前持仓，**不在这里直接赋值**——
          // 直接赋会让 baseAt 过滤失效时也看不出问题（断言会空转，实测踩过）。
          applyReplay(p);
        }
        return cfg;
      });
    }
    function removePosition(code) {
      updateConfig((cfg) => {
        cfg.positions = cfg.positions.filter((x) => x.code !== code);
        return cfg;
      });
    }

    // ================================================================ 预警（规则 CRUD + 评估通道）
    /**
     * 规则 id：字符集必须满足 shared 的 sanitizeAlert（[A-Za-z0-9_-]{1,32}）——
     * 它是 .alerts 账本 states 的键，也是「多标签页认领」的标识。
     */
    function newAlertId() {
      return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    /** 规则类型的展示文案（与 Host 的 8 种一一对应） */
    const ALERT_TYPE_LABEL = {
      price_above: "现价上穿", price_below: "现价下穿",
      cost_above: "突破成本", cost_below: "跌破成本",
      pct_up: "涨幅达到", pct_down: "跌幅达到",
      limit_near: "接近涨跌停", speed_up: "涨速达到",
    };
    /** 比率类（单位 %）与价格类的区分：决定输入框单位与提示文案 */
    const ALERT_PCT_TYPES = ["pct_up", "pct_down", "limit_near", "speed_up"];
    function alertUnit(type) {
      return ALERT_PCT_TYPES.includes(type) ? "%" : "元";
    }
    function alertValueText(rule) {
      if (!rule) return "";
      // 成本类的阈值就是成本价本身，类型标签已含「成本」→ 不再重复后缀
      // （否则规则读作「突破成本 成本价」）
      if (rule.type === "cost_above" || rule.type === "cost_below") return "";
      const n = Number(rule.value);
      return (Number.isFinite(n) ? (Math.round(n * 10000) / 10000) : "--") + alertUnit(rule.type);
    }
    function alertRuleText(rule) {
      if (!rule) return "";
      const v = alertValueText(rule);
      const label = ALERT_TYPE_LABEL[rule.type] || rule.type;
      return v ? label + " " + v : label;
    }
    /**
     * 把扁平的规则数组按 code 归组（**纯派生视图**，不改存储）。
     *
     * 组顺序 = 各 code 首次出现的顺序。因为 addAlert 只 push、没有重排入口，
     * 首次出现即组内最早一条规则的 createdAt，于是顺序稳定——
     * 不按「最近触发」排，否则触发一次列表就跳位，用户找不着东西。
     */
    function groupAlerts(rules) {
      const groups = [];
      const byCode = new Map();
      for (const r of rules || []) {
        let g = byCode.get(r.code);
        if (!g) {
          g = { code: r.code, name: r.name || displayCode(r.code), rules: [] };
          byCode.set(r.code, g);
          groups.push(g);
        }
        g.rules.push(r);
      }
      return groups;
    }
    /**
     * 拉取预警规则状态（用于规则列表显示「已触发/待命」）。
     * 页面重开、标签页解冻、alert-stream 重连后都调它——不假设流不断（§7.1 修订）。
     * 触发历史已按要求去掉：Host 不再落盘 events，这里也不再读。
     */
    async function refreshAlerts() {
      try {
        const r = await api("/alerts");
        if (r && r.ok) setState({ alertStates: r.states || {} });
      } catch { /* Host 不可达：保留既有状态，不清零 */ }
    }

    /** 新增规则：本地先按 shared 同款清洗过一遍，非法直接挡在 UI（Host 侧还有一道） */
    function addAlert(item) {
      const rule = sanitizeAlert(Object.assign({ id: newAlertId(), createdAt: Date.now() }, item));
      if (!rule) {
        toast("预警规则不合法：检查类型 / 阈值 / 代码（limit_near 仅 A 股）", "#ff5555");
        return null;
      }
      let added = null;
      updateConfig((cfg) => {
        const list = Array.isArray(cfg.alerts) ? cfg.alerts.slice() : [];
        if (list.length >= 50) {
          toast("预警规则已达上限（50 条）", "#ff5555");
          return null;
        }
        list.push(rule);
        cfg.alerts = list;
        added = rule;
        return cfg;
      });
      if (added) {
        // 新规则塞进**收起的组**里，用户会以为没生效 → 自动展开该组
        setState({ alertOpen: added.code });
        toast("已添加预警：" + alertRuleText(added));
      }
      return added;
    }
    function removeAlert(id) {
      updateConfig((cfg) => {
        cfg.alerts = (cfg.alerts || []).filter((r) => r.id !== id);
        return cfg;
      });
      toast("已删除该预警规则");
    }
    // 曾经的「启用/停用」（toggleAlert / toggleAlertGroup）已整体移除：
    // 规则存在即参与评估，**删除就是停用**。两个理由：
    //   1) 它把"列表里有这条规则"和"它会不会响"变成两件事，对着规则列表也看不出哪些在生效；
    //   2) 分组抽屉把单条开关收进展开体后，收起态连入口都没有（组头那段文字点不动）。
    // 旧配置里残留的 enabled 字段不再读取也不再写回 —— sanitizeAlert 直接不产出它。
    /** 右键「设为预警」→ 预填该股的对话框（现价/成本价作初值，用户可改） */
    function openAddAlert(code, name, preset) {
      setState({ addAlert: { code, name: name || displayCode(code), preset: preset || null } });
    }
    /** 行情交易日 YYYY-MM-DD（A股 time=20261013161452 / 港美=2026-10-13 16:08:32）；浏览器今日兜底 */
