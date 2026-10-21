
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
