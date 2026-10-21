    function quoteDate(q) {
      const t = String((q && q.time) || "");
      let m = t.match(/^(\d{4})(\d{2})(\d{2})/);
      if (m) return m[1] + "-" + m[2] + "-" + m[3];
      m = t.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    /** 行情交易时刻 HH:MM */
    function quoteClock(q) {
      const t = String((q && q.time) || "");
      const m = t.match(/(\d{2}):(\d{2})/);
      if (m) return m[1] + ":" + m[2];
      const m2 = t.match(/^\d{8}(\d{2})(\d{2})/);
      if (m2) return m2[1] + ":" + m2[2];
      return "";
    }
    /**
     * 添加一笔变动：side=buy/sell（或 qty 直接为负=卖出）。
     * 买入：股数 +、成本按加权平均摊薄；卖出：股数 −（成本不变，下限 0）。
     * 今日收益据此计算（见 todayPnl），支持当日多次买卖。
     */
    function addTxn(code, txn) {
      const price = Number(txn.price);
      const rawQty = Number(txn.qty);
      let qty;
      if (txn.side === "buy") qty = Math.abs(rawQty);
      else if (txn.side === "sell") qty = -Math.abs(rawQty);
      else qty = rawQty; // 未指定方向：负数即卖出
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty === 0) {
        toast("变动无效：价格需 > 0，股数需非 0", "#ff5555");
        return false;
      }
      let ok = false;
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p) return null;
        const cur = p.qty || 0;
        if (qty < 0 && cur + qty < 0) {
          toast("卖出股数超过当前持仓（" + cur + "）", "#ff5555");
          return null;
        }
        // 第一笔流水之前先把当时的持仓冻结为「基准」。用户可能先手填成本+股数，也可能直接记账。
        ensureBase(p);
        p.txns = p.txns || [];
        p.txns.push({
          id: (txn.date || "") + ":" + Date.now() + ":" + Math.round(Math.random() * 1e6),
          date: txn.date || "",
          time: txn.time || "",
          price: Math.round(price * 10000) / 10000,
          qty,
          // 记录时刻：用于判断这笔是否晚于「最后一次手动修正」，早于修正点的会被吸收
          at: Date.now(),
        });
        p.txns.sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
        // 记完流水后从「基准 + 修正点之后的流水」重算 qty/cost，而不是增量改：
        // 增量公式一旦和手工编辑过的值混在一起就会永久失配，且无法自愈。
        applyReplay(p);
        ok = true;
        return cfg;
      });
      return ok;
    }
    /**
     * 冻结基准持仓（只在第一次出现流水时做一次，此时还没有修正点 baseAt）。
     *
     * baseQty/baseCost 就是「开始记账那一刻的持仓」，来源是用户手填的成本/股数。
     * 冻结后当前持仓由「基准 + 基准之后的流水」决定，手工录入与逐笔记账落在同一模型。
     * 已经有 baseQty 字段的不再改动（哪怕值是 0，那也是「基准空仓」的合法记录）。
     */
    function ensureBase(p) {
      if (p && p.baseQty === undefined) {
        p.baseQty = p.qty || 0;
        p.baseCost = p.cost || 0;
        // 首次冻结时还没有任何修正点 → baseAt=0 表示"全部流水都参与"
        if (p.baseAt === undefined) p.baseAt = 0;
      }
    }
    /** 按「基准 + 修正点之后的流水」重算并写回 p.qty / p.cost */
    function applyReplay(p) {
      const b = replayPosition(p.baseQty, p.baseCost, p.txns, p.baseAt);
      p.qty = b.qty;
      p.cost = b.cost;
    }
    /**
     * 从交易流水重算「持仓股数 + 成本价」（加权平均法）。
     * **成本口径的唯一真相源**：以前是增量维护 qty/cost，与编辑对话框（手工改）
     * 形成两个真相源，实测产出了自相矛盾的配置（cost 低于所有买入价、
     * qty 与流水净额差 8800 股）。改成「流水是唯一输入」后，任何增删都自洽。
     * 规则：买入加权摊薄 / 卖出只减股数不改成本 / 清仓后成本归零 / 超卖夹到 0。
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function costBasisFromTxns(txns) {
      let qty = 0;
      let cost = 0;
      for (const t of txns || []) {
        const q = Number(t && t.qty);
        const price = Number(t && t.price);
        if (!Number.isFinite(q) || q === 0 || !Number.isFinite(price) || price <= 0) continue;
        if (q > 0) {
          const newQty = qty + q;
          // qty 为 0 时 `cost*qty` 自然是 0，清仓后重新建仓不会被旧成本污染
          cost = Math.round(((cost * qty + price * q) / newQty) * 10000) / 10000;
          qty = newQty;
        } else {
          qty = Math.max(0, qty + q);
          // 刻意不清零 cost：realizedPnl 要用它算已实现盈亏，
          // 清零会让「清仓瞬间累计盈亏暴涨」（实测 37000 → 140000）
        }
      }
      return { qty, cost };
    }
    /**
     * 基准（最后一次手动修正）+ 交易流水 → 当前持仓。lib/shared.js 的内联副本。
     *
     * 只在「修正点（baseAt）之后」记的流水才叠加：用户可能先手填持仓、记几笔交易，
     * **再回头改成本/股数**——那次修改等于宣告"此刻持仓就是这样"，之前的流水已被
     * 吸收，再叠一遍就是双重计算。
     *   baseAt ≤ 0 → 全部流水参与（还没发生过修正）
     *   baseAt > 0 → 只算之后记的；更早的（含没有 at 的老流水）视为已被吸收
     */
    function replayPosition(baseQty, baseCost, txns, baseAt) {
      const bq = Number(baseQty) || 0;
      const bc = Number(baseCost) || 0;
      const cut = Number(baseAt) || 0;
      const list = [];
      if (bq > 0 && bc > 0) list.push({ qty: bq, price: bc });
      for (const t of txns || []) {
        if (cut > 0) {
          const at = Number(t && t.at);
          if (!Number.isFinite(at) || at <= cut) continue;
        }
        list.push(t);
      }
      return costBasisFromTxns(list);
    }
    function removeTxn(code, id) {
      updateConfig((cfg) => {
        const p = cfgFind(cfg.positions, code);
        if (!p || !p.txns) return null;
        const t = p.txns.find((x) => x.id === id);
        if (!t) return null;
        ensureBase(p);
        p.txns = p.txns.filter((x) => x.id !== id);
        if (p.txns.length === 0) {
          // 最后一笔流水删掉 → 回到期初状态（用户手填的值），而不是把持仓清零
          delete p.txns;
          if (p.baseQty !== undefined) { p.qty = p.baseQty; p.cost = p.baseCost; }
        } else {
          // 撤销任意一笔都能回到自洽状态
          applyReplay(p);
        }
        return cfg;
      });
    }
    /**
     * 今日收益（现金流法，支持当日多次买卖）：
     *   今日盈亏 = 当前持仓×现价 + 今日卖出金额 − 今日买入金额 − 昨日持仓×昨收
     *   其中 昨日持仓 = 当前持仓(qty) − 今日净变动(Σ今日 txns.qty)
     * 无今日变动时退化为 (现价 − 昨收) × qty。qty 视为「当前持仓」，与成本/股数录入一致。
     *
     * 例外：**今天才建立的持仓**（openedAt === 今日）按成本算 (现价−成本)×qty。
     * 因为直接填成本+股数建仓没有 txns，光看「无当日变动」分不清
     * 「昨天就持有今天没动」和「今天刚买」；按昨收算会给新仓凭空加一段浮盈。
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function todayPnl(p, q) {
      if (!q || !Number.isFinite(q.price)) return 0;
      const now = q.price;
      const yest = Number.isFinite(q.yestclose) ? q.yestclose : null;
      const today = quoteDate(q);
      const txns = (p.txns || []).filter((t) => t.date === today);
      const qty = p.qty || 0;
      if (txns.length === 0) {
        const openedToday = p.openedAt === today;
        const cost = Number.isFinite(p.cost) ? p.cost : null;
        if (openedToday && cost !== null && cost > 0) return (now - cost) * qty;
        return yest !== null ? (now - yest) * qty : 0;
      }
      let net = 0, buyAmt = 0, sellAmt = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      if (yest === null) return 0; // 无昨收：无法计算今日，返回 0
      const heldFromYesterday = qty - net;
      return qty * now + sellAmt - buyAmt - heldFromYesterday * yest;
    }
    /**
     * 这只持仓是否已过期（下一个交易日该移除）。lib/shared.js 的内联副本。
     * 判据用**行情日期**而非本地日期：行情日期天然跳过周末/节假日与盘前时段，
     * 不会在周末误删周五清仓的票。详见 lib/shared.js 的注释。
     */
    function isStaleClosedPosition(p, refDate) {
      if (!p || (p.qty || 0) !== 0) return false;
      const txns = Array.isArray(p.txns) ? p.txns : [];
      if (!txns.length) return false;
      let last = "";
      for (const t of txns) {
        const d = String((t && t.date) || "");
        if (d > last) last = d;
      }
      if (!last) return false;
      const ref = String(refDate || "");
      if (!ref) return false;
      return ref > last;
    }
    /**
     * 已实现盈亏（相对成本口径），用于**清仓后**的累计盈亏。
     *   已实现 = 今日卖出额 − 今日买入额 − 昨仓 × 成本
     * 清仓时市值与成本都归零，`value − cost` 会让累计盈亏凭空归零——但钱是赚到了的。
     * 用它接住，让累计盈亏在清仓瞬间保持连续：
     *   卖出前 (12−10)×100 = 200；清仓后 1200 − 0 − 100×10 = 200
     * lib/shared.js 的内联副本，两端由 test/shared-drift.mjs 对拍。
     */
    function realizedPnl(p, q) {
      if (!q || !Number.isFinite(q.price)) return 0;
      const today = quoteDate(q);
      const txns = (p.txns || []).filter((t) => t.date === today);
      if (txns.length === 0) return 0;
      const qty = p.qty || 0;
      const cost = Number.isFinite(p.cost) ? p.cost : 0;
      let net = 0, buyAmt = 0, sellAmt = 0;
      for (const t of txns) {
        net += t.qty;
        if (t.qty > 0) buyAmt += t.price * t.qty;
        else sellAmt += t.price * -t.qty;
      }
      const heldFromYesterday = qty - net;
      return sellAmt - buyAmt - heldFromYesterday * cost;
    }
