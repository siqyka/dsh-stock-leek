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

/** 汇总持仓收益：{ has, cost, value, today, pnl, pnlPct } */
export function computeEarnings(cfg, quotes) {
  let cost = 0, value = 0, today = 0, has = false;
  for (const p of (cfg && cfg.positions) || []) {
    const q = quotes[p.code];
    const qty = p.qty || 0;
    const c = p.cost || 0;
    if (!q || !qty) continue;
    has = true;
    cost += c * qty;
    value += q.price * qty;
    today += todayPnl(p, q);
  }
  const pnl = value - cost;
  return { has, cost, value, today, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null };
}

/**
 * 收益明细（悬浮窗 hover 浮层）：汇总 + 每只持仓（按市值降序）。
 * 当日涨幅 = 今日盈亏 ÷ 昨收市值（昨收市值 = 现市值 − 今日盈亏）。
 */
export function earningsDetail(cfg, quotes) {
  let cost = 0, value = 0, today = 0, has = false;
  const rows = [];
  for (const p of (cfg && cfg.positions) || []) {
    const q = quotes[p.code];
    const qty = p.qty || 0;
    const c = p.cost || 0;
    if (!q || !qty) continue;
    has = true;
    const mv = q.price * qty;
    const pnl = c ? (q.price - c) * qty : 0;
    const pnlPct = c ? ((q.price - c) / c) * 100 : null;
    const td = todayPnl(p, q);
    const yestValue = mv - td;
    const todayPct = qty && yestValue > 0 ? (td / yestValue) * 100 : null;
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
  const pnl = value - cost;
  const yestTotal = value - today;
  rows.sort((a, b) => b.mv - a.mv);
  return {
    has,
    cost,
    value,
    today,
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