    const ALERT_TYPES = [
      "price_above", "price_below", "cost_above", "cost_below",
      "pct_up", "pct_down", "limit_near", "speed_up",
    ];
    function sanitizeAlert(raw) {
      if (!raw || typeof raw !== "object") return null;
      if (typeof raw.id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(raw.id)) return null;
      const code = typeof raw.code === "string" ? raw.code.trim() : "";
      if (!/^[A-Za-z0-9_.$-]{1,16}$/.test(code)) return null;
      if (!ALERT_TYPES.includes(raw.type)) return null;
      if (raw.type === "limit_near" && !/^(sh|sz|bj)/i.test(code)) return null;
      const value = Number(raw.value);
      if (!Number.isFinite(value) || value < 0) return null;
      const out = {
        id: raw.id,
        code,
        type: raw.type,
        value: Math.min(1e8, Math.round(value * 10000) / 10000),
      };
      // 没有 enabled：规则存在即参与评估，要停就删（与 lib/shared.js 同款，勿单边修改）
      if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, 40);
      if (Number.isFinite(Number(raw.createdAt))) out.createdAt = Math.round(Number(raw.createdAt));
      return out;
    }
    function sanitizeAlerts(raw) {
      if (!Array.isArray(raw)) return [];
      const seen = new Set();
      const out = [];
      for (const r of raw) {
        const v = sanitizeAlert(r);
        if (!v || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push(v);
        if (out.length >= 50) break;
      }
      return out;
    }
    // ==== 行情时间戳 → 市场本地交易日（与 lib/shared.js 一致）====
    // 三市场格式不同：A股 14 位数字 / 美股 "Y-M-D H:M:S" / 港股 "Y/M/D H:M:S"。
    // 只认 14 位会让美股、港股规则永远 no-day 不触发（实测踩过）。
    function quoteDayFor(q) {
      const t = String((q && q.time) || "").trim();
      if (/^\d{14}$/.test(t)) return t.slice(0, 8);
      const digits = t.replace(/[^\d]/g, "");
      if (digits.length >= 8 && /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.test(t)) {
        return digits.slice(0, 8);
      }
      return null;
    }
    // ==== 市场开关（与 lib/shared.js 一致；shared-drift 对拍锁定）====
    // 用户要求：A股/港股/美股三个开关可多选；被暂停的市场不刷新行情、
    // 指数栏也不因它展开。未知市场（无前缀）不受开关影响，按启用处理。
    function marketKeyOf(code) {
      const c = String(code || "").toLowerCase();
      if (/^(sh|sz|bj)/.test(c)) return "cn";
      if (/^hk/.test(c)) return "hk";
      if (/^(us|gb_)/.test(c)) return "us";
      return null;
    }
    function marketPaused(code, paused) {
      if (!Array.isArray(paused) || paused.length === 0) return false;
      const key = marketKeyOf(code);
      return key !== null && paused.includes(key);
    }
    function withoutPausedMarkets(codes, paused) {
      const arr = Array.isArray(codes) ? codes : [];
      if (!Array.isArray(paused) || paused.length === 0) return arr;
      return arr.filter((c) => !marketPaused(c, paused));
    }
    /**
     * 指数栏此刻该不该展开（**不含手动覆盖**，只回答"按时段该不该"）。
     *
     * 非交易时段只留「状态点 + 设置」，把桌面让出来。
     *
     * **午休不收起**：判据取整个交易日的跨度（首个开盘 − 缓冲 ~ 最后收盘 + 缓冲），
     * 而不是逐时段匹配。否则 A 股每天 11:30–13:00 栏会消失两个半小时。
     *
     * **市场开关参与判断**（用户要求）：被暂停的市场视为"永不展开"——
     * 它的行情都停了，展开一个显示定格数字的栏没有意义。
     */
