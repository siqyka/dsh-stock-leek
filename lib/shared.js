/**
 * 共享纯函数：格式化 + 盈亏计算。
 *
 * 从 client.js 抽出，理由：
 *   1. 这些函数零 DOM / 零 React 依赖，可以被 Host、测试、未来的通知模块直接复用；
 *   2. client.js 已 2700+ 行，单文件让每次改动都要在 UI 代码与计算代码间来回跳；
 *   3. 盈亏口径（todayPnl 的现金流算法）是本项目最容易被改错的逻辑，独立成文件后
 *      更容易被针对性测试覆盖。
 *
 * 注意：本文件不做任何 I/O，不读全局状态，所有输入显式传入。
 */

/** K 线可选均线周期（顺序即显示/存储顺序） */
export const MA_ALL = [5, 10, 20, 60];

/**
 * 盈亏曲线的「刷新 tick」：把行情时间戳压到**一个刷新周期**的粒度。
 *
 * 用途：决定「什么时候值得重新拉一次 /minute 重画曲线」。
 * 同一 tick 内重画必然得到一模一样的曲线，纯属浪费；跨 tick 才可能有新分钟点。
 *
 * 窗口取配置的刷新间隔 pollMs，而不是写死一分钟——
 * 用户把刷新间隔调到 3s 却要等一分钟曲线才动，是明显的「没跟随设置」。
 * pollMs 缺失/非法时兜底 5s（与 defaultConfig 一致）。
 *
 * 单独抽成纯函数是为了能直接对拍：修复前曲线用的是原始 updatedAt，
 * 盘中每轮推送都触发一次 /minute；这个函数是那个 bug 的守门人。
 */
export function curveRefreshTick(updatedAt, pollMs) {
  const t = Number(updatedAt);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const p = Number(pollMs);
  const win = Number.isFinite(p) && p >= 1000 ? p : 5000;
  return Math.floor(t / win);
}
/** 默认勾选的均线 */
export const MA_DEF = [5, 10, 20];

export function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

/** 价格：≥10000 一位小数，≥100 两位，其余三位（适配港股低价与美股） */
export function fmtPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "--";
  if (n >= 10000) return n.toFixed(1);
  return n >= 100 ? n.toFixed(2) : n.toFixed(3);
}

/** 带正号的百分比 */
export function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

/** 换手/涨速等纯百分比（无正号） */
export function fmtTurn(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2) + "%";
}

/** 成交额：A股接口单位=万元，港/美=元 */
export function fmtMoney(v, code) {
  let n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (/^(sh|sz|bj)/.test(code || "")) n = n * 1e4;
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "万亿";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
  if (n >= 1e4) return (n / 1e4).toFixed(0) + "万";
  return n.toFixed(0);
}

/** 成交量：A股=手，其余=股 */
export function fmtQty(v, code) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const unit = /^(sh|sz|bj)/.test(code || "") ? "手" : "股";
  if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿" + unit;
  if (n >= 1e4) return (n / 1e4).toFixed(1) + "万" + unit;
  return n.toFixed(0) + unit;
}

/** 时间戳 → HH:MM */
export function fmtTime(t) {
  const s = String(t || "");
  const m = s.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (m) return m[1] + ":" + m[2];
  if (/^\d{14}$/.test(s)) return s.slice(8, 10) + ":" + s.slice(10, 12);
  return s;
}

/** 精确金额（带正负号 + 千分位，元） */
export function fmtMoneyExact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return sign + Math.round(Math.abs(n)).toLocaleString("en-US");
}

/** 精确金额（无符号 + 千分位，元） */
export function fmtExact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return Math.round(n).toLocaleString("en-US");
}

/** 收益金额（带正负号，万亿/亿/万） */
export function fmtSigned(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e8) return sign + (a / 1e8).toFixed(2) + "亿";
  if (a >= 1e4) return sign + (a / 1e4).toFixed(2) + "万";
  return sign + a.toFixed(0);
}

/** 去掉市场前缀，仅留用户熟悉的代码 */
export function displayCode(code) {
  return String(code || "")
    .replace(/^(sh|sz|bj|gb_)/i, "")
    .replace(/^hk(?=[0-9])/, "")
    .replace(/^us/i, "");
}

/** 市场标签（沪/深/北/港/美） */
export function marketLabel(code) {
  const c = String(code || "");
  if (/^sh/i.test(c)) return "沪";
  if (/^sz/i.test(c)) return "深";
  if (/^bj/i.test(c)) return "北";
  if (/^hk/i.test(c)) return "港";
  if (/^us|^gb_/i.test(c)) return "美";
  return "";
}

/** 行情日期（YYYY-MM-DD），取不到回退今天 */
export function quoteDate(q) {
  if (!q) return todayStr();
  const t = String(q.time || "");
  if (/^\d{14}$/.test(t)) return t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8);
  return todayStr();
}

/** 行情时钟（HH:MM:SS），取不到回退当前时间 */
export function quoteClock(q) {
  if (q && typeof q.time === "string" && /^\d{14}$/.test(q.time)) {
    return q.time.slice(8, 10) + ":" + q.time.slice(10, 12) + ":" + q.time.slice(12, 14);
  }
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
}

function todayStr() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}

/**
 * 今日盈亏（现金流口径）。
 *
 *   有当日变动：qty×现价 + 今日卖出额 − 今日买入额 − 昨仓×昨收
 *   无当日变动：(现价 − 昨收) × qty
 *
 * 「昨仓」= 当前持仓 − 当日净买入。这样盘中加仓/减仓不会被算成盈亏。
 */
export function todayPnl(p, q) {
  if (!q || !Number.isFinite(q.price)) return 0;
  const now = q.price;
  const yest = Number.isFinite(q.yestclose) ? q.yestclose : null;
  const today = quoteDate(q);
  const txns = (p.txns || []).filter((t) => t.date === today);
  const qty = p.qty || 0;
  if (txns.length === 0) return yest !== null ? (now - yest) * qty : 0;
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
 * 这只持仓是否已「过期」，该在下一个交易日自动移除。
 *
 * 背景：当日清仓的股票要**保留**——用户还要看今天这笔赚没赚（见 computeEarnings
 * 的 realizedPnl）。但跨到下一个交易日后，它的今日盈亏归零、明细里只剩一行
 * 「已清仓」，继续占着持仓列表只是噪音，所以此时移除。
 *
 * 判据刻意用**行情日期**（refDate）而不是本地日期：
 *   - 行情日期天然跳过周末与节假日。周五收盘后行情日期仍是周五 → 周末不会误删；
 *     等周一开盘、行情日期变成周一，才删。
 *   - 盘前时段行情日期还停在前一交易日 → 当天清仓的票不会被「提前」清掉。
 * 若误用本地日期，周末打开插件就会把周五清仓的票删掉——而那本不该删。
 *
 * 以下情况一律**保留**（宁可留噪音，也不误删用户数据）：
 *   - 还有持仓（qty ≠ 0）
 *   - 没有任何成交记录（用户手动把股数改成 0，无从判断何时清仓）
 *   - 拿不到行情日期（停牌 / 退市 / 未订阅），无法安全判断
 */
export function isStaleClosedPosition(p, refDate) {
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
 *
 *   已实现 = 今日卖出额 − 今日买入额 − 昨仓 × 成本
 *
 * 清仓（qty=0）时市值与成本都归零，`value − cost` 会让累计盈亏凭空归零——
 * 但钱是赚到了的。用这个函数接住，让累计盈亏在清仓瞬间保持连续：
 *   卖出前 (12−10)×100 = 200；清仓后 1200 − 0 − 100×10 = 200 ✓
 *
 * 只统计「当日」txns：清仓发生在当天时正好完整覆盖；
 * 更早清仓的持仓其当日成交为 0，贡献 0（不会重复计入）。
 */
export function realizedPnl(p, q) {
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

/** 汇总持仓收益：{ has, cost, value, today, pnl, pnlPct } */
export function computeEarnings(cfg, quotes) {
  let cost = 0, value = 0, today = 0, realized = 0, has = false;
  for (const p of (cfg && cfg.positions) || []) {
    const q = quotes[p.code];
    if (!q) continue; // 没行情：整只跳过，不能凭空造数
    const qty = p.qty || 0;
    const c = p.cost || 0;
    // 今日盈亏与是否持仓无关：清仓股当天卖出的钱是真实盈亏，
    // 不能因为 qty 归零就从汇总里抹掉（这是清仓后收益消失的根因）。
    const td = todayPnl(p, q);
    today += td;
    if (!qty) {
      // 清仓：市值/成本按 0 计，但已实现盈亏要接住，否则累计会凭空归零
      realized += realizedPnl(p, q);
      if (td !== 0) has = true; // 今天动过这只，界面仍需展示汇总
      continue;
    }
    has = true;
    cost += c * qty;
    value += q.price * qty;
  }
  const pnl = value - cost + realized;
  return { has, cost, value, today, realized, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null };
}

/**
 * 收益明细（悬浮窗 hover 浮层）：汇总 + 每只持仓（按市值降序）。
 * 当日涨幅 = 今日盈亏 ÷ 昨收市值（昨收市值 = 现市值 − 今日盈亏）。
 */
export function earningsDetail(cfg, quotes) {
  let cost = 0, value = 0, today = 0, realized = 0, has = false;
  const rows = [];
  for (const p of (cfg && cfg.positions) || []) {
    const q = quotes[p.code];
    if (!q) continue; // 没行情：整只跳过
    const qty = p.qty || 0;
    const c = p.cost || 0;
    const td = todayPnl(p, q);
    if (!qty) {
      // 清仓股：市值/成本为 0，但今日已实现盈亏要显示出来，
      // 否则用户卖完后从明细里看到这只票凭空消失，以为数据丢了。
      const rp = realizedPnl(p, q);
      if (rp === 0 && td === 0) continue; // 既没持仓又没今日成交：不必展示
      has = true;
      today += td;
      realized += rp;
      rows.push({
        code: p.code,
        name: q.name || p.name || displayCode(p.code),
        price: q.price,
        qty: 0,
        cost: c,
        mv: 0,
        pnl: rp,
        pnlPct: null,
        today: td,
        todayPct: null,
        closed: true, // 前端据此显示「已清仓」而不是空白
      });
      continue;
    }
    has = true;
    const mv = q.price * qty;
    const pnl = c ? (q.price - c) * qty : 0;
    const pnlPct = c ? ((q.price - c) / c) * 100 : null;
    const yestValue = mv - td;
    const todayPct = yestValue > 0 ? (td / yestValue) * 100 : null;
    cost += c * qty;
    value += mv;
    today += td;
    rows.push({
      code: p.code,
      name: (q && q.name) || p.name || displayCode(p.code),
      price: q.price,
      qty,
      cost: c,
      mv,
      pnl,
      pnlPct,
      today: td,
      todayPct,
    });
  }
  const pnl = value - cost + realized;
  const yestTotal = value - today;
  rows.sort((a, b) => b.mv - a.mv);
  return {
    has,
    cost,
    value,
    today,
    realized,
    pnl,
    pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
    todayPct: yestTotal > 0 ? (today / yestTotal) * 100 : null,
    rows,
  };
}

/**
 * 标题变脸（纯 UI 彩蛋，不影响任何数据）：
 *   无持仓/持平 → 📈 观望中 · 盈利 → 🍗 加鸡腿（≥3% 🚀 起飞了）· 亏损 → 🍜 关灯吃面（≤−3% 🧘 天台吹风）
 */
export function moodTitle(earn) {
  if (!earn || !earn.has || !Number.isFinite(earn.today) || earn.today === 0) return "📈 观望中";
  const yest = earn.value - earn.today;
  const pct = yest > 0 ? (earn.today / yest) * 100 : 0;
  if (earn.today > 0) return pct >= 3 ? "🚀 起飞了" : "🍗 加鸡腿";
  return pct <= -3 ? "🧘 天台吹风" : "🍜 关灯吃面";
}