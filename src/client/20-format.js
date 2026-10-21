
    // ================================================================ 常量与工具
    const BASE = "/dsh-stock-leek";
    const LS_CONFIG = "sl.config.v1";
    const LS_POS = "sl.overlay.pos.v1";
    const LS_THEME = "sl.theme.v1";
    /** K 线可选均线周期（顺序即显示/存储顺序） */
    const MA_ALL = [5, 10, 20, 60];
    const MA_DEF = [5, 10, 20];
    const LS_SIZE = "sl.overlay.size.v1";
    const LS_PLACEMENT = "sl.bar.placement.v1"; // dock | floating（纯 UI 偏好，存本地，不依赖 host）
    const LS_BAR_POS = "sl.bar.pos.v1"; // 悬浮指数栏手动位置 {x,y}（视口左上角坐标）；空=自动锚定

    /**
     * 旧版本用 `lf.` 前缀存这些本地偏好（lf = 早期插件名首字母）。
     * 改名后一次性把旧键的值搬到新键，避免用户的主题/窗口位置被重置。
     * 只在新键不存在且旧键存在时搬，搬完删旧键 —— 幂等，不覆盖用户后续的修改。
     */
    (function migrateLocalStorageKeys() {
      // 注意：浏览器里没有 process，这里必须用 globalThis，否则会抛 ReferenceError。
      // 该开关只给测试用：置 1 可跳过搬迁，用来验证「搬迁逻辑确实在工作」。
      if (globalThis.__SL_NO_LS_MIGRATE__ === true) return;
      const PAIRS = [
        ["lf.config.v1", LS_CONFIG], ["lf.overlay.pos.v1", LS_POS], ["lf.theme.v1", LS_THEME],
        ["lf.overlay.size.v1", LS_SIZE], ["lf.bar.placement.v1", LS_PLACEMENT], ["lf.bar.pos.v1", LS_BAR_POS],
      ];
      try {
        for (const [oldKey, newKey] of PAIRS) {
          const old = localStorage.getItem(oldKey);
          if (old === null) continue;
          if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
          localStorage.removeItem(oldKey);
        }
      } catch {
        /* 隐私模式等禁用了 localStorage：忽略，偏好丢失不影响功能 */
      }
    })();

    function clamp(v, a, b) {
      return Math.min(b, Math.max(a, v));
    }
    // lib/shared.js 的内联副本：client.js 无法 import 共享模块（见 docs/architecture.md）。
    // 任何一侧单独改动都会被 test/shared-drift.mjs 对拍出来。
    function curveRefreshTick(updatedAt, pollMs) {
      const t = Number(updatedAt);
      if (!Number.isFinite(t) || t <= 0) return 0;
      const p = Number(pollMs);
      const win = Number.isFinite(p) && p >= 1000 ? p : 5000;
      return Math.floor(t / win);
    }
    function fmtPrice(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return "--";
      if (n >= 10000) return n.toFixed(1);
      return n >= 100 ? n.toFixed(2) : n.toFixed(3);
    }
    function fmtPct(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "--";
      return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
    }
    /** 涨速/换手等纯百分比数值（无正号，保留 2 位 + %）；null/NaN → — */
    function fmtTurn(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "—";
      return n.toFixed(2) + "%";
    }
    function fmtMoney(v, code) {
      // A股接口成交额单位=万元，港/美=元
      let n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "-";
      if (/^(sh|sz|bj)/.test(code || "")) n = n * 1e4;
      if (n >= 1e12) return (n / 1e12).toFixed(2) + "万亿";
      if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
      if (n >= 1e4) return (n / 1e4).toFixed(0) + "万";
      return n.toFixed(0);
    }
    function fmtQty(v, code) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return "-";
      const unit = /^(sh|sz|bj)/.test(code || "") ? "手" : "股";
      if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿" + unit;
      if (n >= 1e4) return (n / 1e4).toFixed(1) + "万" + unit;
      return n.toFixed(0) + unit;
    }
    function fmtTime(t) {
      const s = String(t || "");
      const m = s.match(/(\d{2}):(\d{2}):(\d{2})/);
      if (m) return m[1] + ":" + m[2];
      if (/^\d{14}$/.test(s)) return s.slice(8, 10) + ":" + s.slice(10, 12);
      return s;
    }
    function displayCode(code) {
      return String(code || "")
        .replace(/^(sh|sz|bj|gb_)/i, "")
        .replace(/^hk(?=[0-9])/, "")
        .replace(/^us/i, "");
    }
    function marketLabel(code) {
      const c = String(code || "");
      if (/^sh/i.test(c)) return "沪";
      if (/^sz/i.test(c)) return "深";
      if (/^bj/i.test(c)) return "北";
      if (/^hk/i.test(c)) return "港";
      if (/^us|^gb_/i.test(c)) return "美";
      return "";
    }
    /** 指数简称：上证指数→上证、深证成指→深证…（仅用于左下角指数栏显示，tooltip/管理页保留全称） */
    const INDEX_SHORT = {
      上证指数: "上证", 深证成指: "深证", 创业板指: "创业板", 恒生指数: "恒指",
      纳斯达克: "纳指", 标普500: "标普", 道琼斯: "道指",
    };
    function shortIndexName(name, code) {
      const n = String(name || "").trim();
      if (INDEX_SHORT[n]) return INDEX_SHORT[n];
      // 兜底：去掉结尾「指数」（恒生指数→恒生、国企指数→国企），但保留「XX指」类
      if (n.length > 3 && /指数$/.test(n)) return n.replace(/指数$/, "");
      return n || displayCode(code);
    }
    /**
     * 指数栏的展开缓冲（分钟）：
     *   - 开盘**前** BAR_LEAD_MIN 分钟就位（A股 → 9:00，覆盖集合竞价）
     *   - 收盘**后** BAR_LAG_MIN 分钟才收回（A股 → 15:06，别在 15:00 准点消失）
     * 三个市场共用同一组缓冲，于是展开区间等宽：A股 9:00–15:06、港股 9:00–16:06、美股 9:00–16:06（各自本地时间）。
     */
    const BAR_LEAD_MIN = 30;
    const BAR_LAG_MIN = 6;

    /** 各市场的日内交易时段（自 00:00 起的分钟数）：[[start, end], ...] */
    function marketWindows(code) {
      const c = String(code || "").toLowerCase();
      if (/^(sh|sz|bj)/.test(c)) return [[570, 690], [780, 900]]; // A股 9:30–11:30 / 13:00–15:00
      if (/^hk/.test(c)) return [[570, 720], [780, 960]]; // 港股 9:30–12:00 / 13:00–16:00
      if (/^(us|gb_)/.test(c)) return [[570, 960]]; // 美股 9:30–16:00
      return [];
    }
    /** 某时刻在目标市场时区的「当日分钟数」 */
    function marketMinutes(code, now) {
      const c = String(code || "").toLowerCase();
      const tz = /^(sh|sz|bj)/.test(c) ? "Asia/Shanghai"
        : /^hk/.test(c) ? "Asia/Hong_Kong"
          : /^(us|gb_)/.test(c) ? "America/New_York" : null;
      try {
        if (!tz) return now.getHours() * 60 + now.getMinutes();
        const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
        const [hh, mm] = s.split(":").map(Number);
        return hh * 60 + mm;
      } catch {
        return now.getHours() * 60 + now.getMinutes();
      }
    }
    /**
     * 当前时刻（测试可用 globalThis.__sl_now__ 覆盖）。
     * 时段相关的判断全走这里，才能在 e2e 里把"非交易时段"稳定复现出来——
     * 否则断言只在真收盘时才成立，白天跑必然挂。
     */
    function marketNow() {
      const v = Number(globalThis.__sl_now__);
      if (Number.isFinite(v) && v > 0) return new Date(v);
      return new Date();
    }
    /** 该市场当前是否交易时段（本地近似判断，用于状态点） */
    function isMarketOpen(code, now) {
      now = now || marketNow();
      const c = String(code || "").toLowerCase();
      const wd = now.getDay();
      if (wd === 0 || wd === 6) return false;
      const t = marketMinutes(c, now);
      return marketWindows(c).some(([a, b]) => t >= a && t <= b);
    }
    // ==== 预警：规则清洗（与 lib/shared.js 同名副本，shared-drift 对拍锁定）====
    // UI 建规则时本地先用它校验/钳制，Host 侧 sanitizeConfig 是最终防线。
