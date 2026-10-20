/**
 * dsh-stock-leek — Host（node）端
 *
 * DSH 插件的服务端：在 dsh web server 上注册 /dsh-stock-leek/* 只读行情路由 + 配置读写。
 *
 *   GET  /dsh-stock-leek/quotes?codes=sh000001,sz399001,hk00700  批量实时行情（腾讯 qt.gtimg.cn，GBK）
 *   GET  /dsh-stock-leek/minute?code=sh000001                    分时（分钟点 + 昨收）
 *   GET  /dsh-stock-leek/kline?code=sh600519&period=day&count=160 日/周/月 K（前复权）
 *   GET  /dsh-stock-leek/search?q=茅台                           全市场搜索（腾讯 smartbox：A/北/港/美/指数/ETF）
 *   GET  /dsh-stock-leek/config                                  读取配置（指数栏/自选/持仓/轮询…）
 *   POST /dsh-stock-leek/config                                  保存配置（原子写盘）
 *   GET  /dsh-stock-leek/stream                                  SSE 行情推送（多标签页共用一次拉取）
 *
 * 配置持久化在 ~/.dsh/dsh-stock-leek/config.json（可用 DSH_STOCK_LEEK_CONFIG 覆盖），
 * 因此换浏览器 / 清缓存后自选与持仓不丢失。
 *
 * 数据源：腾讯财经公开行情接口
 *   - 行情快照  https://qt.gtimg.cn/q=...
 *   - 分时/K线  https://web.ifzq.gtimg.cn/appstock/…
 *   - 搜索      https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get
 * Host 用 Node 原生 fetch 直连，不依赖 web provider / 沙箱网络策略。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
// 共享纯逻辑（格式化 / 盈亏口径 / 常量）：client.js 因平台不支持相对 require 只能内联一份，
// test/shared-drift.mjs 会校验两边行为一致，防止改动漂移。
import { MA_ALL, MARKET_KEYS, withoutPausedMarkets, isMarketOpen, quoteDayFor, stepAlert, sanitizeAlerts } from "./lib/shared.js";

const name = "dsh-stock-leek";
/** Required services: webServer（HTTP 路由）。 */
const inject = ["webServer"];

const PREFIX = "/dsh-stock-leek";
const QUOTE_API = "https://qt.gtimg.cn/q=";
const MINUTE_API = "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r={r}";
const KLINE_API = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,{end},{count},qfq";
/** 美股专用 K 线端点：通用 fqkline 对美股只回当天 1 根，usfqkline 才给完整序列（实测） */
const US_KLINE_API = "https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param={code},{period},,{end},{count},qfq";
const SEARCH_API = "https://proxy.finance.qq.com/ifzqgtimg/appstock/smartbox/search/get?q={q}";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** 上游行情缓存 TTL（毫秒）：指数栏 + 悬浮窗共享同一次抓取，避免重复打腾讯接口 */
const QUOTE_TTL = 1500;
const MINUTE_TTL = 5000;
const KLINE_TTL = 60000;

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/**
 * 配置落盘位置：~/.dsh/dsh-stock-leek/config.json
 * （统一放在 DSH 的配置根目录下，与其它插件的数据聚在一起，方便备份/清理）
 *
 * 环境变量：新名 DSH_STOCK_LEEK_CONFIG 优先；旧名 DSH_LEEK_FUND_CONFIG 仍兼容，
 * 免得老脚本 / 老文档里写着的调用方直接失效。
 *
 * LEGACY_CONFIG_PATHS 是历次改名前的落盘位置，**按新到旧排列**，
 * 启动时逐个尝试搬迁（见 migrateLegacyConfig），保证改名不丢用户的自选与持仓。
 *
 * ⚠️ 路径**惰性解析**（每次读取时才看环境变量），不能在模块顶层固化：
 * 测试的 config-guard 需要在本模块被 import *之后*才有机会设置环境变量
 * （ESM 的静态 import 会提升，守卫根本来不及跑），顶层固化会导致测试
 * 直接写到用户的真实配置上，把持仓数据覆盖掉。
 */
let _configPath = null; // 已解析则缓存，保证同一进程内路径稳定
function envConfig() {
  return process.env.DSH_STOCK_LEEK_CONFIG || process.env.DSH_LEEK_FUND_CONFIG || "";
}
function configPath() {
  if (_configPath) return _configPath;
  _configPath = envConfig() || join(homedir(), ".dsh", "dsh-stock-leek", "config.json");
  return _configPath;
}
function legacyConfigPaths() {
  return [
    join(homedir(), ".dsh", "dsh-leek-fund", "config.json"),
    join(homedir(), ".dsh-leek-fund", "config.json"),
  ];
}
/** 测试专用：清掉路径缓存，让下次读取重新解析（配合环境变量变更） */
export function __resetConfigPathCache() {
  _configPath = null;
}
/** 测试专用：返回当前生效的配置路径（惰性解析） */
export function getConfigPathForTest() {
  return configPath();
}
/**
 * 模块加载标记（测试守卫用）。
 * 若测试在 useTestConfigPath() 之前就 import 了本模块，这个标记会被守卫看到，
 * 从而提前发现"环境变量来不及生效"的导入顺序错误，避免写到用户真实配置。
 */
globalThis[Symbol.for("dsh-stock-leek.index.loaded")] = true;

/** 候选大盘指数（默认全部展示在「大盘」页，用户挑选若干放到对话左下角） */
const DEFAULT_BAR = ["sh000001", "sz399001"];
const DEFAULT_INDICES = [
  { code: "sh000001", name: "上证指数" },
  { code: "sz399001", name: "深证成指" },
  { code: "sz399006", name: "创业板指" },
  { code: "sh000688", name: "科创50" },
  { code: "sh000300", name: "沪深300" },
  { code: "sh000905", name: "中证500" },
  { code: "bj899050", name: "北证50" },
  { code: "hkHSI", name: "恒生指数" },
  { code: "hkHSTECH", name: "恒生科技" },
  { code: "usIXIC", name: "纳斯达克" },
  { code: "usDJI", name: "道琼斯" },
  { code: "usINX", name: "标普500" },
];

function defaultConfig() {
  return {
    version: 1,
    /** 大盘候选（可增删） */
    indices: DEFAULT_INDICES.map((x) => ({ ...x })),
    /** 显示在对话左下角的指数代码（有序） */
    barIndices: DEFAULT_BAR.slice(),
    /** 自选股 */
    watchlist: [
      { code: "sh600519", name: "贵州茅台", addedAt: 0 },
      { code: "sz300750", name: "宁德时代", addedAt: 0 },
    ],
    /** 持仓：cost=成本价（元/股），qty=股数 */
    positions: [],
    /** 轮询间隔（毫秒，最小 2000） */
    pollMs: 5000,
    /** 涨跌配色（A 股惯例：红涨绿跌） */
    riseColor: "#f5455c",
    fallColor: "#1eb980",
    /** 左下角指数栏样式：compact（只显示涨跌幅）/ full（点位+涨跌幅） */
    barStyle: "full",
    /** 指数栏水平对齐：left / center / right */
    barAlign: "left",
    /** 指数栏放置：dock（嵌入输入框下方，仅已有对话生效）/ floating（悬浮锚定，新会话页也显示） */
    barPlacement: "floating",
    /** 是否显示指数栏 */
    barVisible: true,
    /** 提醒：预警总开关（关闭后规则保留但不评估；预警功能见 docs/alerts-plan.md） */
    remind: true,
    /** 预警规则（存在即参与评估，要停就删；实际评估还受 cfg.remind 总开关控制） */
    alerts: [],
    /** 持仓页「今日盈亏走势」曲线是否展开（false=收起；用户点按后记住） */
    pnlCurve: true,
    /** 五档盘口布局：cols=左右（左卖右买）/ rows=上下（卖5→卖1 / 现价 / 买1→买5） */
    bookLayout: "cols",
    /** 五档盘口挂单量口径：lots=手数（1手=100股）/ amount=金额（价格×股数） */
    bookUnit: "lots",
    /** K 线图默认显示的均线周期 */
    ma: [5, 10, 20],
    /** 已暂停的市场（多选开关；被暂停的市场不刷新行情、不评估预警、指数栏不因它展开） */
    pausedMarkets: [],
  };
}

/** 配置版本号的内部字段名：每次成功写入 +1，供客户端发现「手上这份已过时」 */
const CFG_REV = "__rev";

function sanitizeCode(v) {
  if (typeof v !== "string") return null;
  const code = normalizeApiCode(v.trim());
  return code && code.length <= 16 ? code : null;
}

function sanitizeItem(raw, withPosition) {
  if (!raw || typeof raw !== "object") return null;
  const code = sanitizeCode(raw.code);
  if (!code) return null;
  const out = { code };
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim().slice(0, 40);
  if (withPosition) {
    const cost = Number(raw.cost);
    const qty = Number(raw.qty);
    out.cost = Number.isFinite(cost) && cost > 0 ? Math.round(cost * 10000) / 10000 : 0;
    out.qty = Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 0;
    if (typeof raw.todayRef === "number" && Number.isFinite(raw.todayRef)) out.todayRef = raw.todayRef;
    // 建仓当天的行情日期（YYYY-MM-DD）：todayPnl 靠它区分「今天刚建的仓」与
    // 「昨天就持有、今天没动」。白名单重建**必须放行**，否则每次保存都被丢掉。
    if (typeof raw.openedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.openedAt)) out.openedAt = raw.openedAt;
    // 期初持仓（开始记流水之前手填的成本/股数）：当前持仓 = 期初 + 流水重算。
    // 同样必须放行，否则「先手填再记账」这条路径的期初会被丢掉、持仓凭空缩水。
    if (raw.baseQty !== undefined) {
      const bq = Number(raw.baseQty);
      out.baseQty = Number.isFinite(bq) && bq > 0 ? Math.round(bq) : 0;
    }
    if (raw.baseCost !== undefined) {
      const bc = Number(raw.baseCost);
      out.baseCost = Number.isFinite(bc) && bc > 0 ? Math.round(bc * 10000) / 10000 : 0;
    }
    // 修正点：这次基准是「什么时候」的。只让此时刻**之后**记的流水参与重算，
    // 更早的视为已被这次修正吸收（否则用户改完成本，老流水又被叠一遍）。
    if (raw.baseAt !== undefined) {
      const ba = Number(raw.baseAt);
      out.baseAt = Number.isFinite(ba) && ba > 0 ? Math.round(ba) : 0;
    }
    // 变动记录（买入 qty>0 / 卖出 qty<0）：今日收益据此计算，可多条
    if (Array.isArray(raw.txns)) {
      const txns = [];
      for (const t of raw.txns) {
        if (!t || typeof t !== "object") continue;
        const price = Number(t.price);
        const tq = Number(t.qty);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (!Number.isFinite(tq) || tq === 0) continue;
        const date = typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : "";
        txns.push({
          id: String(t.id != null ? t.id : date + ":" + tq + ":" + price).slice(0, 48),
          date,
          time: typeof t.time === "string" ? t.time.replace(/[^\d:]/g, "").slice(0, 8) : "",
          price: Math.round(price * 10000) / 10000,
          qty: Math.round(tq),
        });
        // 记账时刻（epoch ms）：replayPosition 用它判断这笔是否晚于「最后一次修正」。
        // 同样必须放行，否则每次保存都被丢掉、修正点之后无法区分新旧流水。
        const at = Number(t.at);
        if (Number.isFinite(at) && at > 0) txns[txns.length - 1].at = Math.round(at);
        if (txns.length >= 200) break;
      }
      if (txns.length > 0) out.txns = txns;
    }
  }
  return out;
}

function sanitizeList(raw, withPosition) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const v = sanitizeItem(item, withPosition);
    if (!v || seen.has(v.code)) continue;
    seen.add(v.code);
    out.push(v);
    if (out.length >= 300) break;
  }
  return out;
}

function sanitizeConfig(raw) {
  const def = defaultConfig();
  if (!raw || typeof raw !== "object") return def;
  const cfg = { ...def };
  cfg.indices = sanitizeList(raw.indices, false);
  if (cfg.indices.length === 0) cfg.indices = def.indices;
  if (Array.isArray(raw.barIndices)) {
    const allowed = new Set(cfg.indices.map((x) => x.code));
    const seen = new Set();
    cfg.barIndices = raw.barIndices
      .map((c) => sanitizeCode(c))
      .filter((c) => c && allowed.has(c) && !seen.has(c) && seen.add(c))
      .slice(0, 8);
  }
  cfg.watchlist = sanitizeList(raw.watchlist, false);
  cfg.positions = sanitizeList(raw.positions, true);
  const poll = Number(raw.pollMs);
  cfg.pollMs = Number.isFinite(poll) ? Math.min(120000, Math.max(2000, Math.round(poll))) : def.pollMs;
  for (const key of ["riseColor", "fallColor"]) {
    const v = raw[key];
    if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) cfg[key] = v.trim();
  }
  if (raw.barStyle === "compact" || raw.barStyle === "full") cfg.barStyle = raw.barStyle;
  if (["left", "center", "right"].includes(raw.barAlign)) cfg.barAlign = raw.barAlign;
  if (raw.barPlacement === "dock" || raw.barPlacement === "floating") cfg.barPlacement = raw.barPlacement;
  if (typeof raw.barVisible === "boolean") cfg.barVisible = raw.barVisible;
  if (typeof raw.remind === "boolean") cfg.remind = raw.remind;
  // 预警规则：白名单清洗（sanitizeAlerts 自带 id 字符集/类型/上限 50/去重）
  cfg.alerts = sanitizeAlerts(raw.alerts);
  // 已暂停的市场：只认 cn/hk/us 三键，去重，空数组=全开。
  // 被暂停的市场：不刷新行情、不评估预警、指数栏不因它展开（用户要求，可多选）。
  if (Array.isArray(raw.pausedMarkets)) {
    const seen = new Set();
    cfg.pausedMarkets = raw.pausedMarkets
      .map(String)
      .filter((k) => MARKET_KEYS.includes(k) && !seen.has(k) && seen.add(k));
  }
  if (typeof raw.pnlCurve === "boolean") cfg.pnlCurve = raw.pnlCurve;
  // 五档盘口的两个展示偏好（布局 / 挂单量口径）。
  // 白名单重建**必须放行**，否则用户切了按钮、下次保存就被丢掉变回默认。
  if (raw.bookLayout === "cols" || raw.bookLayout === "rows") cfg.bookLayout = raw.bookLayout;
  if (raw.bookUnit === "lots" || raw.bookUnit === "amount") cfg.bookUnit = raw.bookUnit;
  // 均线周期：只接受 MA_ALL 中出现的值，去重保序，最多 4 条
  if (Array.isArray(raw.ma)) {
    const seen = new Set();
    const ma = raw.ma.map(Number).filter((p) => MA_ALL.includes(p) && !seen.has(p) && seen.add(p));
    cfg.ma = ma; // 允许空数组（全部关闭）
  }
  // 版本号透传（非用户可配置项，仅用于并发检测）
  if (Number.isFinite(Number(raw[CFG_REV]))) cfg[CFG_REV] = Number(raw[CFG_REV]);
  return cfg;
}

/**
 * 配置读写：带备份与损坏保护。
 *
 * - 写入前把旧文件复制成 .bak（原子：先写 tmp 再 rename），任何时候崩溃都至少留一份上一版
 * - 解析失败时不静默回落默认值（那会吞掉用户持仓）：把损坏原文另存 .corrupt 便于人工找回，
 *   尝试回退 .bak，最后才用默认值，并通过 GET /config 的 warning 字段告知前端
 */
let configCorrupted = false; // 是否发生过解析失败（供 /config 透出告警）

/**
 * 一次性搬迁：插件几经改名，配置落盘位置也跟着变过。启动时若「新位置还没有文件」，
 * 按 LEGACY_CONFIG_PATHS 的顺序（新→旧）找第一个能解析的旧文件搬过来。
 *
 * 只在「新位置无文件」时搬；旧文件保留为 .migrated.bak **不删除**——
 * 万一搬迁过程出问题，用户还能从备份里手工捞回。
 * 仅在用默认路径时才搬（显式设了环境变量说明是测试/自定义目录，不关我们的事）。
 */
function migrateLegacyConfig() {
  if (envConfig()) return; // 显式指定路径 → 不干预
  const cfgPath = configPath();
  if (existsSync(cfgPath)) return; // 新位置已有 → 不动
  for (const legacyPath of legacyConfigPaths()) {
    let text = null;
    try {
      text = readFileSync(legacyPath, "utf8");
    } catch {
      continue; // 这个旧位置没有 → 试下一个
    }
    if (!text.trim()) continue; // 空文件不值得搬
    try {
      JSON.parse(text); // 只搬能解析的
    } catch {
      continue; // 旧文件本身坏了 → 试下一个，全都不行就按首次运行处理
    }
    try {
      mkdirSync(dirname(cfgPath), { recursive: true });
      writeFileSync(cfgPath, text, "utf8");
      // 老文件改名保留，不删：搬迁出问题可以从这里恢复
      copyFileSync(legacyPath, legacyPath + ".migrated.bak");
      return;
    } catch {
      return; // 搬不动就按首次运行处理，用户手动拷文件即可
    }
  }
}

function readConfig() {
  migrateLegacyConfig();
  const cfgPath = configPath();
  let text = null;
  try {
    text = readFileSync(cfgPath, "utf8");
  } catch {
    return defaultConfig(); // 不存在 = 首次运行，正常路径
  }

  // 空文件视为首次运行（健康状态），不算损坏 → 解除告警
  if (!text.trim()) {
    configCorrupted = false;
    return defaultConfig();
  }

  try {
    configCorrupted = false; // 解析成功 → 告警自动解除
    return sanitizeConfig(JSON.parse(text));
  } catch {
    // 走到这里说明文件确实坏了：保留现场 → 尝试备份 → 才用默认值
    configCorrupted = true;
    try {
      writeFileSync(cfgPath + ".corrupt", text, "utf8");
    } catch {
      /* ignore */
    }
    try {
      const bak = readFileSync(cfgPath + ".bak", "utf8");
      if (bak.trim()) return sanitizeConfig(JSON.parse(bak));
    } catch {
      /* 没有备份或备份也坏了 */
    }
    return defaultConfig();
  }
}

function writeConfig(cfg) {
  const cfgPath = configPath();
  const dir = dirname(cfgPath);
  mkdirSync(dir, { recursive: true });
  // 覆盖前先备份上一版（仅当存在）
  try {
    if (existsSync(cfgPath)) copyFileSync(cfgPath, cfgPath + ".bak");
  } catch {
    /* ignore */
  }
  const tmp = cfgPath + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  renameSync(tmp, cfgPath);
}

// ---------------------------------------------------------------------------
// 预警：事件账本（config.json.alerts）+ 编排 + 独立评估循环
//
// 设计依据见 docs/alerts-plan.md：
// - 评估必须在 Host——客户端隐藏即断流（client.js visibilitychange），
//   挂客户端的预警会退化成「盯着看才响」。
// - 事件与配置分文件：config.json 背后是 .bak/`.rev`/`.corrupt` 一整套
//   乐观锁与找回机制，高频追加的流水不该每次重写配置、搅动 `__rev`。
// - 落点派生 configPath()+".alerts"——dirname() 会丢掉 config-guard 的
//   pid 隔离（tmp 根下跨套件共享同一文件），派生让隔离自动继承。
// - 账本坏了不值得抢救（是事件流不是持仓）：静默重建空账本，不阻塞评估。
// ---------------------------------------------------------------------------

const ALERT_BACKOFF_MS = 60000; // 休市/异常/无规则时的低频退避
/** 预警 SSE 订阅者（模块级：/alert-stream 注册与评估广播共用；与行情 sseClients 互不干涉） */
const alertClients = new Set();

function alertsPath() {
  return configPath() + ".alerts";
}

function broadcastAlert(ev) {
  const payload = "data: " + JSON.stringify({ type: "alert", event: ev }) + "\n\n";
  for (const c of [...alertClients]) {
    try {
      c.write(payload);
    } catch {
      /* 交给 close/error 回调清理 */
    }
  }
}

/**
 * 读账本。**只保留 states**（用户要求去掉触发历史）：
 * states 是「每交易日每规则只提示一次」的唯一依据，丢了会在 Host 重启后重复播报。
 * 事件流水不再落盘，也不再从旧文件里读回来（老文件里残留的 events 会被自然丢弃，
 * 下次写入即被清掉）。
 */
function readAlerts() {
  const fresh = { version: 1, states: {} };
  let text = null;
  try {
    text = readFileSync(alertsPath(), "utf8");
  } catch {
    return fresh; // 不存在 = 从未触发过，正常路径
  }
  if (!text || !text.trim()) return fresh;
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object") return fresh;
    return {
      version: 1,
      states: j.states && typeof j.states === "object" ? j.states : {},
    };
  } catch {
    return fresh; // 账本损坏：重建空账本继续工作，绝不让评估循环因此死亡
  }
}

function writeAlerts(data) {
  const p = alertsPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, p);
  } catch {
    /* 写失败只丢事件，不影响下一拍 */
  }
}

/**
 * 需要评估的股票代码集合（评估范围；无规则或总开关关闭时为空 → 循环休眠）。
 *
 * 规则**没有启用/停用之分**：存在即评估，要停就删（sanitizeAlert 不产出 enabled，
 * 旧配置里残留的该字段也不再读取）。唯一的总闸是 cfg.remind。
 */
function activeAlertCodes(cfg) {
  if (!cfg || cfg.remind === false) return []; // 总开关：关了就一条都不评估
  const set = new Set();
  for (const r of (cfg && cfg.alerts) || []) if (r) set.add(r.code);
  return [...set];
}

/**
 * 某市场时区的「当日」YYYYMMDD（交易日判据用，§4.3）。
 * 与 shared 的 quoteDayFor 配对：报价日 === 市场本地当日 才允许触发判定。
 * 用 Intl 取市场时区日期——绝不 new Date(str)，也绝不用主机本地日
 * （凌晨跑 A 股规则时，主机本地日已是新的一天，而市场还没开盘）。
 */
function marketTodayFor(code, now) {
  const c = String(code || "").toLowerCase();
  const tz = /^(sh|sz|bj)/.test(c) ? "Asia/Shanghai"
    : /^hk/.test(c) ? "Asia/Hong_Kong"
      : /^(us|gb_)/.test(c) ? "America/New_York" : null;
  try {
    const s = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now); // en-CA → YYYY-MM-DD
    return s.replace(/-/g, "");
  } catch {
    const p2 = (n) => String(n).padStart(2, "0");
    return now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate());
  }
}

/**
 * 单拍评估（纯编排，Host 循环与 __alertTickWith 测试通道共用同一条路径）。
 * @param {object} cfg 已 sanitize 的配置
 * @param {Map} quotes code → 行情行
 * @param {object} data 账本 { states }（原地更新；触发历史已按要求去掉）
 * @param {Date} now 评估时刻——测试注入固定值；绝不读任何全局时钟钩子
 *   （__sl_now__ 是浏览器全局，Node 里不存在，两条注入路径不混用）
 * @returns {{ fired: object[], skipped: string[] }}
 */
function applyAlertTick(cfg, quotes, data, now) {
  if (!cfg || cfg.remind === false) return { fired: [], skipped: [] }; // 总开关
  const rules = ((cfg && cfg.alerts) || []).filter(Boolean);
  const costBy = new Map();
  for (const p of (cfg && cfg.positions) || []) {
    if (Number.isFinite(p.cost) && p.cost > 0) costBy.set(p.code, p.cost);
  }
  const fired = [];
  const skipped = [];
  for (const rule of rules) {
    const q = quotes.get(rule.code);
    if (!q) { skipped.push(rule.id); continue; } // 停牌/未订阅：状态不动
    const day = quoteDayFor(q);
    if (!day) { skipped.push(rule.id); continue; } // 无日界：宁可不报，不可乱报（§10.7）
    // 交易日判据（§4.3）：报价日必须等于**该市场本地当日**。
    // 报价停在上一交易日 = 该市场今天没开（节假日/未开市/停牌），
    // 此时价格恒定不变，条件可能恒真 → 必须跳过，否则每逢节假日误报一次。
    if (day !== marketTodayFor(rule.code, now)) { skipped.push(rule.id); continue; }
    const r = stepAlert(rule, q, data.states[rule.id], { day, cost: costBy.get(rule.code) });
    data.states[rule.id] = r.state; // 滞回状态跨拍保持；跨日重置同样落账
    if (r.skipped) skipped.push(rule.id); // no-day / no-data（悬空成本、全 -1 哨兵等）
    if (r.fired) {
      fired.push({
        at: now.getTime(),
        ruleId: rule.id,
        code: rule.code,
        name: q.name || rule.name || rule.code,
        type: rule.type,
        value: rule.value,
        price: Number.isFinite(Number(q.price)) ? Number(q.price) : null,
        percent: Number.isFinite(Number(q.percent)) ? Number(q.percent) : null,
      });
    }
  }
  // ⚠️ 不再累积触发历史（用户要求去掉）。
  // 注意区分两件事：
  //   - `fired`（本次返回值）→ 仍要用于 **SSE 实时推送**，弹窗靠它；
  //   - `data.events`（落盘流水）→ 已去掉，账本里只留 `states`。
  // states 必须留：它是「每交易日只提示一次」的唯一依据，
  // 丢了会在 Host 重启后重复播报（每天可以多报几次）。
  return { fired, skipped };
}

/** POST /config 后唤醒评估（新规则尽快生效）；循环未启动时为空操作 */
let alertKick = () => {};
/** 测试专用：停止循环（定时器不 unref，需显式清理，否则挂住进程退出） */
let alertKickReset = null;

/** 评估循环的观测计数：供验收「无规则 → 零上游请求」断言（真实计数，非测试替身） */
const alertStats = { ticks: 0, fetches: 0, sleeps: 0 };

function startAlertLoop(ctx) {
  let stopped = false;
  let timer = null;
  let running = false;
  /**
   * 评估循环用的「当前时间」。
   *
   * 允许测试用 `globalThis.__sl_alert_now__` 钉死它——否则「休市退避 / 盘中快跑」
   * 这类行为完全取决于跑测试时的真实钟点：本项目的 alert-loop-ref 用例就栽过，
   * 它挑了美股规则（假设北京凌晨美股在盘中），白天跑必然看不到第二拍。
   * 与客户端 marketNow()/__sl_now__ 同一套路。
   */
  const alertNow = () => {
    const v = Number(globalThis.__sl_alert_now__);
    return Number.isFinite(v) && v > 0 ? new Date(v) : new Date();
  };
  const schedule = (ms) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
    // ⚠️ 绝不能 unref()：unref 的定时器不阻塞事件循环退出，一旦进程里没有
    // 其它活动句柄，这一拍**可能永远不触发**——表现为「配了规则却永远不评估，
    // 只有改配置（alertKick）时才跑一次」。实测踩过：清空规则让循环进入 60s
    // 退避后，再添加规则等了 25s 毫无动静，POST /config 才踢出第一拍。
    // 测试侧的退出由下面的 dispose 负责（ctx.effect 的清理函数），不靠 unref。
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    alertStats.ticks++;
    try {
      const cfg = readConfig();
      const codes = activeAlertCodes(cfg);
      if (codes.length === 0) {
        alertStats.sleeps++;
        schedule(ALERT_BACKOFF_MS); // 无规则：完全休眠，一次上游都不打
        return;
      }
      const now = alertNow();
      // 市场开关（用户要求，可多选）：被暂停的市场完全不评估——
      // 与「已收盘自动停」同一条链：开关关掉 = 用户明确不要这个市场的数据。
      // 具体过滤在 applyAlertTick 内（测试通道共用该路径）。
      const paused = cfg.pausedMarkets;
      const activeCodes = withoutPausedMarkets(codes, paused);
      if (!activeCodes.some((c) => isMarketOpen(c, now))) {
        alertStats.sleeps++;
        schedule(ALERT_BACKOFF_MS); // 全市场休市（或全被暂停）：不打上游，低频看配置变化
        return;
      }
      // 与行情广播同款护栏：对齐上游批量上限，规则膨胀不放大 URL
      alertStats.fetches++;
      // 按 code 逐个门控：混合市场时（如 A股 + 美股规则并存），美股盘中不能
      // 顺带把休市的 A 股也评估了——报价停在昨收，条件可能恒真而误报。
      // 只对「该市场此刻在交易时段且未被暂停」的 code 取行情与判定。
      const openCodes = activeCodes.filter((c) => isMarketOpen(c, now));
      const map = await fetchQuotes(openCodes.slice(0, 200));
      const data = readAlerts();
      const before = JSON.stringify(data.states);
      const { fired } = applyAlertTick(cfg, map, data, now);
      const live = new Set(((cfg.alerts) || []).map((r) => r.id));
      for (const id of Object.keys(data.states)) if (!live.has(id)) delete data.states[id];
      // 事件与状态变化都要落盘：fired→armed 的滞回重置没有事件，但绝不能丢
      if (fired.length || before !== JSON.stringify(data.states)) writeAlerts(data);
      for (const ev of fired) broadcastAlert(ev);
      const p = Number(cfg.pollMs);
      schedule(Math.min(15000, Math.max(2000, Number.isFinite(p) ? p : 5000)));
    } catch {
      schedule(ALERT_BACKOFF_MS); // 任何异常退避重试；循环绝不静默死亡（SSE finally 的教训）
    } finally {
      running = false;
    }
  };
  alertKick = () => {
    if (!stopped) schedule(200);
  };
  // 供测试显式停止（定时器不 unref 会挂住进程退出）
  alertKickReset = () => {
    stopped = true;
    clearTimeout(timer);
    alertKick = () => {};
    alertKickReset = null;
  };
  void tick();
  ctx.effect(() => () => {
    if (alertKickReset) alertKickReset();
  });
}

/** 测试通道：注入行情直接跑一拍评估（与生产循环共用 applyAlertTick，可落盘可读文件） */
export function __alertTickForTest(cfg, quoteRows, opts = {}) {
  const data = readAlerts();
  const map = new Map((quoteRows || []).map((r) => [r.code, r]));
  const now = opts.now instanceof Date ? opts.now : new Date();
  const out = applyAlertTick(sanitizeConfig(cfg), map, data, now);
  if (opts.write !== false) writeAlerts(data);
  return { ...out, data };
}

/** 测试断言 alerts 落点走隔离路径（派生自 configPath，自动继承守卫的 pid 隔离） */
export function getAlertsPathForTest() {
  return alertsPath();
}

/**
 * 测试观测：评估循环的真实计数。
 * 验收 #5「未启用任何规则 → 评估循环完全休眠、不打接口」需要一个能看见
 * 「循环跑了但没打上游」的窗口——只有 sleeps 增长、fetches 不动才算数。
 */
export function getAlertStatsForTest() {
  return { ...alertStats };
}

/**
 * 测试专用：停止评估循环。
 *
 * 循环的定时器**故意不 unref**（unref 会让它可能永远不触发，见 schedule 注释），
 * 因此测试跑完必须显式停掉，否则进程被定时器挂住不退出。生产由 ctx.effect
 * 的清理函数负责，不走这里。
 */
export function __stopAlertLoopForTest() {
  if (typeof alertKickReset === "function") alertKickReset();
}

// ---------------------------------------------------------------------------
// 代码规范化（接受 sh/sz/hk/usr_/nf_ 等常见习惯写法）
// ---------------------------------------------------------------------------

const US_INDEX_ALIAS = {
  IXIC: "usIXIC",
  DJI: "usDJI",
  INX: "usINX",
  SPX: "usINX",
  NDX: "usNDX",
  HSI: "hkHSI",
  HSCEI: "hkHSCEI",
  HSTECH: "hkHSTECH",
};

/**
 * 用户/上游代码 → 腾讯接口代码。
 * 支持：sh000001 / sz399001 / bj899050 / hk00700 / hkHSI / usAAPL / US.AAPL /
 *      usr_ixic(美股别名写法) / 纯 6 位数字 / 纯字母（美股 ticker）
 */
function normalizeApiCode(input) {
  if (!input) return null;
  let code = String(input).trim();
  if (!code) return null;
  code = code.replace(/[^A-Za-z0-9_.$]/g, "");
  if (!code) return null;

  // 别名归一：usr_xxx → usXXX；us.AAPL → usAAPL；gb_ixic 保留小写
  if (/^usr_/i.test(code)) code = "us" + code.slice(4).toUpperCase();
  if (/^us[._]/i.test(code)) code = "us" + code.slice(3).toUpperCase();

  const lower = code.toLowerCase();
  if (/^(sh|sz|bj)[0-9]{6}$/.test(lower)) return lower;
  if (/^hk/i.test(code)) {
    const rest = code.slice(2);
    if (/^[0-9]+$/.test(rest)) return "hk" + rest.padStart(5, "0");
    const alias = US_INDEX_ALIAS[rest.toUpperCase()];
    if (alias && alias.startsWith("hk")) return alias;
    return "hk" + rest.toUpperCase();
  }
  if (/^us/i.test(code)) {
    let rest = code.slice(2).replace(/\./g, "");
    // ⚠️ 剥掉交易所后缀（实测 smartbox 搜索返回的美股代码自带）：
    //   OQ=纳斯达克、AM=NYSE American。不剥的话：行情接口碰巧容忍
    //   （usAAPLOQ 也能出价），但分时/K线接口**不认这种代码**，全部返回空
    //   → 详情页「无分时/无K线」（用户实测）。
    // 刻意**不剥 N**（纽交所后缀）：单字母 N 误伤率太高（如真实代码 AON、
    // TSM 结尾的会被剥坏），且实测搜索结果里未见 N 结尾的条目。
    // 剥完若剩空串则保留原样（上层会因接口无效而优雅报错）。
    const stripped = rest.replace(/(OQ|AM)$/, "");
    if (stripped) rest = stripped;
    const alias = US_INDEX_ALIAS[rest.toUpperCase()];
    if (alias) return alias;
    return "us" + rest.toUpperCase();
  }
  if (/^(gb_)/i.test(code)) return lower;

  // 纯数字：按前缀猜市场
  if (/^[0-9]{6}$/.test(code)) {
    if (/^(60|68|75|78|51|56|58|50|0009|900)/.test(code)) return "sh" + code;
    if (/^(4|8|92)/.test(code)) return "bj" + code;
    if (/^(688)/.test(code)) return "sh" + code;
    return "sz" + code;
  }
  if (/^[0-9]{5}$/.test(code)) return "hk" + code;
  // 纯字母 → 美股
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(code)) {
    const up = code.toUpperCase();
    const alias = US_INDEX_ALIAS[up];
    if (alias) return alias;
    return "us" + up;
  }
  return code;
}

/** 接口代码 → 展示代码（剥掉市场前缀） */
function displayCode(code) {
  return String(code || "").replace(/^(sh|sz|bj|gb_)/i, "").replace(/^hk(?=[0-9])/, "").replace(/^us/i, "");
}

/** 接口代码 → 市场标签 */
function marketLabel(code) {
  const c = String(code || "");
  if (/^sh/i.test(c)) return "沪";
  if (/^sz/i.test(c)) return "深";
  if (/^bj/i.test(c)) return "北";
  if (/^hk/i.test(c)) return "港";
  if (/^us|^gb_/i.test(c)) return "美";
  return "";
}

// ---------------------------------------------------------------------------
// HTTP 抓取工具
// ---------------------------------------------------------------------------

async function fetchGbk(url, headers) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://gu.qq.com/", ...(headers || {}) },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, referer: "https://gu.qq.com/" },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function num(v) {
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : v;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// 行情解析（腾讯 qt.gtimg.cn，响应以 ~ 分隔的定长字段）
// ---------------------------------------------------------------------------

/**
 * 解析一行 `v_sh600519="1~贵州茅台~600519~1274.89~…";`
 * A股/ETF/指数 len≈88，港股 len≈78，美股 len≈73；取用字段位置一致：
 *   1 名称 2 代码 3 现价 4 昨收 5 今开 30 时间 31 涨跌 32 涨跌% 33 高 34 低
 *   36 成交量 37 成交额 38 换手 39 市盈率 43 振幅 44 流通市值 45 总市值 46 市净率 47 涨停 48 跌停
 */
function parseQuoteLine(key, raw) {
  const f = String(raw).split("~");
  if (f.length < 35) return null;
  const code = key.replace(/^v_/, "");
  const price = num(f[3]);
  const yestclose = num(f[4]);
  if (price === null || yestclose === null) return null;
  // 盘前/停牌兜底：现价为 0 时退回昨收
  const live = price > 0 ? price : yestclose;
  const change = num(f[31]) ?? round(live - yestclose, 4);
  let percent = num(f[32]);
  if (percent === null && yestclose !== 0) percent = round(((live - yestclose) / yestclose) * 100, 2);
  const volume = num(f[36]) ?? num(f[6]) ?? 0;
  const amount = num(f[37]) ?? 0;
  return {
    code,
    name: (f[1] || "").trim() || displayCode(code),
    market: marketLabel(code),
    price: live,
    yestclose,
    open: num(f[5]) ?? 0,
    high: num(f[33]) ?? 0,
    low: num(f[34]) ?? 0,
    change,
    percent: percent ?? 0,
    volume,
    amount,
    turnover: num(f[38]) ?? null,
    pe: num(f[39]) ?? null,
    pb: num(f[46]) ?? null,
    amplitude: num(f[43]) ?? null,
    floatCap: num(f[44]) ?? null,
    totalCap: num(f[45]) ?? null,
    limitUp: num(f[47]) ?? null,
    limitDown: num(f[48]) ?? null,
    time: String(f[30] || "").trim(),
    // 五档买卖盘：买一~买五在 f[9..18]，卖一~卖五在 f[19..28]，price/qty 交替。
    // 量的单位是**手**（1 手 = 100 股），这里 ×100 换成「股」，与持仓口径一致，
    // 否则界面上"挂 9 手"会被误读成 9 股。
    // 停牌/无挂单时该档可能是 0 或空 → 过滤掉，避免渲染出一排 0.00。
    book: parseOrderBook(f),
    live: true,
  };
}

/**
 * 解析腾讯的五档买卖盘。
 *
 * 字段布局（price, qty 交替，共 20 个）：
 *   [9]/[10]  买一价/量   [11]/[12] 买二 … [17]/[18] 买五
 *   [19]/[20] 卖一价/量  [21]/[22] 卖二 … [27]/[28] 卖五
 *
 * 量的单位是手 → 统一换成股（×100），与持仓/成交口径一致。
 * 价格为 0 或量缺失的档位直接丢掉：停牌、集合竞价前、港美部分标的会给出 0。
 */
function parseOrderBook(f) {
  const side = (start) => {
    const out = [];
    for (let i = 0; i < 5; i++) {
      const price = num(f[start + i * 2]);
      const lots = num(f[start + i * 2 + 1]);
      if (price === null || price <= 0 || lots === null || lots <= 0) continue;
      out.push({ price: round(price, 4), qty: Math.round(lots * 100) });
    }
    return out;
  };
  const bids = side(9);
  const asks = side(19);
  if (bids.length === 0 && asks.length === 0) return null;
  return { bids, asks };
}

function round(v, d) {
  if (!Number.isFinite(v)) return null;
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

// ---------------------------------------------------------------------------
// 涨速（5分钟涨速）：东财 push2 ulist 的 f22 字段。成交额/换手由腾讯提供，
// 仅涨速腾讯无独立字段，故补充东财。best-effort：取不到就不展示。
// ---------------------------------------------------------------------------

const SPEED_API = "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids={secids}&fields=f12,f13,f22";

/** 接口代码 → 东财 secid（market.code）。无法映射返回 null。 */
function toSecid(code) {
  const c = String(code || "").toLowerCase();
  if (/^sh[a-z0-9.]+$/.test(c)) return "1." + c.slice(2);
  if (/^sz[a-z0-9.]+$/.test(c)) return "0." + c.slice(2);
  if (/^bj[0-9]+$/.test(c)) return "0." + c.slice(2);
  if (/^hk/.test(c)) {
    const rest = c.slice(2);
    if (/^[0-9]+$/.test(rest)) return "116." + rest; // 港股正股
    return "100." + rest.toUpperCase(); // 恒指 HSI / HSCEI / HSTECH
  }
  if (/^us/.test(c)) return "105." + c.slice(2).toUpperCase(); // 美股（NASDAQ 优先，取不到即无）
  return null;
}

const speedCache = new Map(); // code -> { at, speed }
const SPEED_TTL = 4000;

/** 批量取涨速，返回 code→speed（number）；失败/无数据的 code 不入表。 */
async function fetchSpeedMap(codes) {
  const now = Date.now();
  const out = new Map();
  const need = [];
  for (const code of codes) {
    const hit = speedCache.get(code);
    if (hit && now - hit.at < SPEED_TTL) {
      if (hit.speed !== null) out.set(code, hit.speed);
    } else if (!need.includes(code)) {
      need.push(code);
    }
  }
  if (need.length === 0) return out;
  const secidToCode = new Map();
  for (const code of need) {
    const secid = toSecid(code);
    if (secid) secidToCode.set(secid, code);
    else speedCache.set(code, { at: now, speed: null }); // 无法映射：负缓存，避免每次重试
  }
  const secids = [...secidToCode.keys()];
  for (let i = 0; i < secids.length; i += 60) {
    const batch = secids.slice(i, i + 60);
    try {
      const json = await fetchJson(SPEED_API.replace("{secids}", batch.join(",")));
      const diff = (json && json.data && json.data.diff) || [];
      for (const it of diff) {
        const code = secidToCode.get(it.f13 + "." + it.f12);
        if (!code) continue;
        const sp = num(it.f22);
        speedCache.set(code, { at: Date.now(), speed: sp });
        if (sp !== null) out.set(code, sp);
      }
    } catch {
      /* 东财不可达：本轮无涨速，不影响行情主体 */
    }
  }
  return out;
}

/** 把涨速合并进行情行（就地写 row.speed）；best-effort，失败静默。 */
async function attachSpeed(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    const codes = rows.map((r) => r.code).filter(Boolean);
    const speedMap = await fetchSpeedMap(codes);
    for (const r of rows) {
      const sp = speedMap.get(r.code);
      if (sp !== undefined && sp !== null) r.speed = sp;
    }
  } catch {
    /* 涨速不影响行情主体 */
  }
}

// 缓存 + 单飞（同一 code 并发请求只打一次上游）
const quoteCache = new Map(); // code -> { at, data }
const quoteFlight = new Map(); // code -> Promise

async function fetchQuotes(codes) {
  const now = Date.now();
  const out = new Map();
  const missing = [];
  for (const code of codes) {
    const hit = quoteCache.get(code);
    if (hit && now - hit.at < QUOTE_TTL) out.set(code, hit.data);
    else if (!missing.includes(code)) missing.push(code);
  }
  if (missing.length > 0) {
    // 已在请求中的 code 复用 promise，避免指数栏与悬浮窗同时轮询打两次
    const pending = [];
    const toFetch = [];
    for (const code of missing) {
      const fl = quoteFlight.get(code);
      if (fl) pending.push(fl.then((rows) => rows.forEach((r, k) => out.set(k, r))));
      else toFetch.push(code);
    }
    if (toFetch.length > 0) {
      const p = (async () => {
        const rows = await requestQuotes(toFetch);
        for (const code of toFetch) {
          const data = rows.get(code) || null;
          quoteCache.set(code, { at: Date.now(), data });
          quoteFlight.delete(code);
          out.set(code, data);
        }
        return rows;
      })().catch((e) => {
        for (const code of toFetch) quoteFlight.delete(code);
        throw e;
      });
      for (const code of toFetch) quoteFlight.set(code, p);
      pending.push(p);
    }
    await Promise.allSettled(pending);
  }
  return out;
}

async function requestQuotes(codes) {
  const rows = new Map();
  // 分批（URL 长度限制）
  for (let i = 0; i < codes.length; i += 60) {
    const batch = codes.slice(i, i + 60);
    const text = await fetchGbk(QUOTE_API + batch.join(","));
    for (const chunk of text.split(";")) {
      const line = chunk.trim();
      if (!line) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key.startsWith("v_")) continue;
      const raw = line.slice(eq + 1).replace(/^\s*"/, "").replace(/"\s*$/, "");
      const parsed = parseQuoteLine(key, raw);
      if (parsed) rows.set(parsed.code, parsed);
    }
    for (const code of batch) if (!rows.has(code)) rows.set(code, null);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 分时 / K线
// ---------------------------------------------------------------------------

const minuteCache = new Map(); // code -> { at, data }

async function fetchMinute(code) {
  const hit = minuteCache.get(code);
  if (hit && Date.now() - hit.at < MINUTE_TTL) return hit.data;
  const url = MINUTE_API.replace("{code}", code).replace("{r}", String(Math.random().toFixed(6)));
  const empty = { date: null, prevClose: null, points: [], error: null };
  let data;
  try {
    const json = await fetchJson(url);
    if (!json || json.code !== 0) throw new Error("接口返回异常");
    const sd = json.data && json.data[code];
    const inner = sd && sd.data;
    const raw = inner && inner.data;
    const date = typeof inner?.date === "string" ? inner.date : "";
    const iso = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
    const points = [];
    if (Array.isArray(raw)) {
      for (const line of raw) {
        const parts = String(line).split(" ");
        if (parts.length < 2) continue;
        const hm = parts[0];
        const p = num(parts[1]);
        const v = num(parts[2]) ?? 0;
        if (!/^\d{4}$/.test(hm) || p === null) continue;
        points.push({ t: hm, p, v });
      }
    }
    let prevClose = null;
    const qt = sd && sd.qt && sd.qt[code];
    if (Array.isArray(qt)) prevClose = num(qt[4]);
    if (prevClose === null && points.length > 0) {
      // 用昨收 = 现价/(1+涨跌%) 反推
      const price = points[points.length - 1].p;
      const pct = num(qt && qt[32]);
      if (pct !== null && pct !== -100) prevClose = round(price / (1 + pct / 100), 4);
    }
    data = {
      date: iso,
      prevClose,
      points,
      error: points.length === 0 ? "无分时数据（该市场不支持分时接口）" : null,
    };
  } catch (e) {
    data = { ...empty, error: String((e && e.message) || e) };
  }
  minuteCache.set(code, { at: Date.now(), data });
  return data;
}

const klineCache = new Map(); // key -> { at, data }

/**
 * K 线缓存有效期。
 *
 * 日/周/月K 的**最后一根盘中一直在变**（今日那根跟着现价走），所以不能照抄
 * 历史数据那种 60s 缓存——那会让"今天这根"半分钟才动一次。
 * 但也不能完全不用缓存：切股票来回切会连打上游。
 * 折中：盘中 10s（跟得上分钟级变化），非盘中退回 60s（收盘后数据是死的）。
 * 这里用报价时间判断是否盘中由调用方决定不了，简单起见统一取较短值。
 */
const KLINE_LIVE_TTL = 10000;

async function fetchKline(code, period, count, end) {
  const key = `${code}:${period}:${count}:${end || ""}`;
  const hit = klineCache.get(key);
  // 用较短 TTL：日/周/月K 的末根在盘中持续变化，60s 会让"今日那根"明显滞后
  const ttl = Math.min(KLINE_TTL, KLINE_LIVE_TTL);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  // 美股必须走专用端点 usfqkline：通用 fqkline 对美股**只回当天 1 根**，
  // 实测 usIXIC 在 fqkline 仅 1 根、usfqkline 21 根（用户反馈「美股没有K线」的根因）。
  const isUs = /^(us|gb_)/i.test(code);
  const api = isUs ? US_KLINE_API : KLINE_API;
  const url = api.replace("{code}", code)
    .replace("{period}", period)
    .replace("{end}", end || "")
    .replace("{count}", String(count));
  let data;
  try {
    const json = await fetchJson(url);
    if (!json || json.code !== 0) throw new Error("接口返回异常");
    const sd = json.data && json.data[code];
    if (!sd) throw new Error("无K线数据");
    // 兼容不同市场返回的键：day/qfqday/hfqday/week/month/hk_day/us_day…
    let rows = null;
    const wanted = [
      "qfq" + period,
      period,
      "hfq" + period,
      sd[period + "_json"] && period + "_json",
    ];
    for (const k of wanted) {
      if (k && Array.isArray(sd[k])) { rows = sd[k]; break; }
    }
    if (!rows) {
      for (const v of Object.values(sd)) {
        if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && v[0].length >= 5) { rows = v; break; }
      }
    }
    if (!rows) throw new Error("无K线数据");
    const candles = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const o = num(row[1]);
      const c = num(row[2]);
      const h = num(row[3]);
      const l = num(row[4]);
      if (o === null || c === null || h === null || l === null) continue;
      candles.push({ time: String(row[0]), open: o, close: c, high: h, low: l, volume: num(row[5]) ?? 0 });
    }
    data = { candles, error: candles.length === 0 ? "无K线数据" : null };
  } catch (e) {
    data = { candles: [], error: String((e && e.message) || e) };
  }
  klineCache.set(key, { at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------------------
// 搜索（腾讯 smartbox，覆盖 A/北/港/美 + 指数 + ETF）
// ---------------------------------------------------------------------------

const searchCache = new Map(); // q -> { at, rows }

const TYPE_LABEL = {
  "GP-A": "A股",
  "GP-A-CYB": "创业板",
  "GP-A-KCB": "科创板",
  "GP-A-BJ": "北交所",
  ETF: "ETF",
  ZS: "指数",
  GP: "正股",
  "GP-ETF": "ETF",
  "GP-ADR": "ADR",
  CS: "指数",
  LOF: "LOF",
  FF: "场外基金",
};

async function searchStocks(needle) {
  const now = Date.now();
  const hit = searchCache.get(needle);
  if (hit && now - hit.at < 300000) return hit.rows;
  const url = SEARCH_API.replace("{q}", encodeURIComponent(needle));
  let rows = [];
  try {
    const json = await fetchJson(url);
    const list = (json && json.data && json.data.stock) || [];
    const seen = new Set();
    for (const arr of list) {
      if (!Array.isArray(arr) || arr.length < 5) continue;
      const market = String(arr[0] || "").toLowerCase();
      const rawCode = String(arr[1] || "");
      const type = String(arr[4] || "");
      if (!["sh", "sz", "bj", "hk", "us", "gb"].includes(market)) continue;
      // 过滤衍生品（窝轮/牛熊/期货/债券等），保留正股 / ETF / 指数
      if (/^(QZ|KJ|NX|B|QB|QQ)/.test(type)) continue;
      const code = normalizeApiCode(market + rawCode);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      rows.push({ code, name: String(arr[2] || "").trim(), type, label: TYPE_LABEL[type] || type, market: marketLabel(code) });
      if (rows.length >= 40) break;
    }
  } catch {
    rows = [];
  }
  searchCache.set(needle, { at: now, rows });
  return rows;
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function queryOf(req) {
  return new URL(req.url || "/", "http://dsh.local").searchParams;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** 汇总当前配置需要抓取的所有代码（供 /config 附带快照，客户端首屏零等待）。
 *  ⚠️ 排除「被暂停的市场」——用户关掉的市场连首屏快照也不给（开关语义要一致） */
function configuredCodes(cfg) {
  const set = new Set();
  for (const x of cfg.indices) set.add(x.code);
  for (const x of cfg.watchlist) set.add(x.code);
  for (const x of cfg.positions) set.add(x.code);
  return withoutPausedMarkets([...set], cfg.pausedMarkets);
}

/**
 * 插件主体：注册 /dsh-stock-leek/* 路由。
 * @param {import("cordis").Context} ctx
 */
function apply(ctx) {
  // SSE 订阅者集合（模块级：/stream 注册与广播循环共用）
  const sseClients = new Set();
  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), `${name}: ${path}`);

  // 配置（含首屏行情快照）
  register(PREFIX + "/config", async (req, res) => {
    try {
      if (req.method === "POST") {
        const body = await readBody(req);
        const incoming = body && body.config ? body.config : body;
        const cur = readConfig();
        // 客户端带上 baseRev：若与当前不一致说明别处已改过
        const baseRev = Number(incoming && incoming[CFG_REV]);
        const curRev = Number(cur[CFG_REV]) || 0;
        const conflict = Number.isFinite(baseRev) && baseRev > 0 && baseRev !== curRev;
        const cfg = sanitizeConfig(incoming);
        cfg[CFG_REV] = curRev + 1; // 乐观递增（不做 CAS：单机单人场景下足够）
        writeConfig(cfg);
        alertKick(); // 新规则/改规则尽快生效（循环在休眠时低频，这里踢它一拍）
        // 配置成功落盘 → 清除此前的损坏告警
        const wasCorrupt = configCorrupted;
        configCorrupted = false;
        sendJson(res, 200, {
          ok: true,
          config: cfg,
          path: configPath(),
          rev: cfg[CFG_REV],
          conflict, // true = 保存期间配置已被其他标签页改动过
          recoveredFromCorruption: wasCorrupt,
        });
        return;
      }
      const cfg = readConfig();
      const withQuotes = queryOf(req).get("quotes") !== "0";
      let quotes = null;
      let error = null;
      if (withQuotes) {
        try {
          const rows = await fetchQuotes(configuredCodes(cfg));
          quotes = [];
          for (const [code, row] of rows) if (row) quotes.push(row);
          await attachSpeed(quotes);
        } catch (e) {
          error = String((e && e.message) || e);
        }
      }
      sendJson(res, 200, {
        ok: true,
        config: cfg,
        path: configPath(),
        quotes,
        error,
        updatedAt: Date.now(),
        // 配置损坏告警：原文已另存 config.json.corrupt 供人工找回
        warning: configCorrupted ? "配置文件解析失败，已回退备份或默认配置；损坏原文见 " + configPath() + ".corrupt" : null,
        rev: Number(cfg[CFG_REV]) || 0,
      });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
  });

  // 批量实时行情：/quotes?codes=sh000001,sz399001
  register(PREFIX + "/quotes", async (req, res) => {
    try {
      const q = queryOf(req);
      const raw = (q.get("codes") || q.get("code") || "").trim();
      const cfg = readConfig();
      let codes = raw
        ? raw
            .split(/[,，\s]+/)
            .map((c) => normalizeApiCode(c))
            .filter(Boolean)
        : configuredCodes(cfg);
      codes = [...new Set(codes)].slice(0, 200);
      if (codes.length === 0) {
        sendJson(res, 200, { ok: true, rows: [], updatedAt: Date.now() });
        return;
      }
      const rows = [];
      let error = null;
      try {
        const map = await fetchQuotes(codes);
        for (const code of codes) {
          const row = map.get(code);
          if (row) rows.push(row);
        }
        await attachSpeed(rows);
        if (rows.length === 0) error = "行情为空（代码可能不受支持或已退市）";
      } catch (e) {
        error = String((e && e.message) || e);
      }
      sendJson(res, 200, { ok: !error || rows.length > 0, rows, error, updatedAt: Date.now() });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e), rows: [] });
    }
  });

  /**
   * SSE 行情推送：/stream
   *
   * 动机：多标签页各自轮询会重复打腾讯接口（Host 有 1.5s TTL 缓存，但仍是 N 倍请求）。
   * 这里改为「一个 Host 定时拉一次，推给所有订阅的标签页」。
   * 语义保持向后兼容：浏览器 EventSource 断开时客户端自动回落到轮询。
   */
  register(PREFIX + "/stream", (req, res) => {
    const cfg = readConfig();
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // 反向代理下不缓冲
    });
    res.write("retry: 3000\n\n");

    // 订阅集合：优先 URL 上的 ?codes=（EventSource 只能 GET，无法发 body），
    // 缺省则用配置文件里的自选+持仓+指数。
    const qCodes = queryOf(req)
      .get("codes")
      .split(/[,，\s]+/)
      .map((c) => normalizeApiCode(c))
      .filter(Boolean);
    const client = { res, codes: new Set(qCodes.length ? qCodes : configuredCodes(cfg)) };
    sseClients.add(client);
    scheduleSse(); // 新订阅者进来后唤醒广播循环

    const send = (payload) => {
      try {
        res.write("data: " + JSON.stringify(payload) + "\n\n");
      } catch {
        cleanup();
      }
    };
    // 立即推一次，避免首屏空白
    const codes0 = [...client.codes];
    if (codes0.length) {
      fetchQuotes(codes0)
        .then((map) => {
          const rows = [];
          for (const c of codes0) { const row = map.get(c); if (row) rows.push(row); }
          return attachSpeed(rows).then(() => send({ rows, updatedAt: Date.now() }));
        })
        .catch(() => {});
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n"); // 保活，防止中间层掐断
      } catch {
        cleanup();
      }
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      sseClients.delete(client);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    // 兜底：超过上限时间未显式关闭（如代理掐断）也要清掉，避免泄漏
    const guard = setTimeout(cleanup, 6 * 60 * 60 * 1000);
    guard.unref?.();
  });

  // SSE 广播循环：所有订阅者共用一次拉取
  let sseTimer = null;
  const sseTick = async () => {
    try {
      if (sseClients.size === 0) return;
      const codes = new Set();
      for (const c of sseClients) for (const code of c.codes) codes.add(code);
      if (codes.size === 0) return;
      const map = await fetchQuotes([...codes].slice(0, 200));
      const rows = [];
      for (const [code, row] of map) if (row) rows.push(row);
      if (rows.length === 0) return;
      await attachSpeed(rows);
      const payload = "data: " + JSON.stringify({ rows, updatedAt: Date.now() }) + "\n\n";
      for (const c of [...sseClients]) {
        try {
          c.res.write(payload);
        } catch {
          /* 交给 close/error 回调清理 */
        }
      }
    } catch {
      /* 单次失败不影响下一轮 */
    } finally {
      // 关键：所有出口（成功/失败/早退）都必须排下一轮，否则广播链断掉只推一次
      scheduleSse();
    }
  };
  /** 按配置的轮询间隔调度下一轮 SSE 广播（无订阅者时不排程） */
  const scheduleSse = () => {
    if (sseTimer) clearTimeout(sseTimer);
    if (sseClients.size === 0) return;
    const ms = readConfig().pollMs || 5000;
    sseTimer = setTimeout(sseTick, Math.min(120000, Math.max(2000, ms)));
  };

  // 预警规则状态（只读；客户端连 /alert-stream 后拉一次，用于展示「已触发/待命」。
  // 触发历史已按要求去掉，这里不再返回 events）
  register(PREFIX + "/alerts", async (_req, res) => {
    try {
      const data = readAlerts();
      sendJson(res, 200, { ok: true, states: data.states, at: Date.now() });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String((e && e.message) || e), states: {} });
    }
  });

  /**
   * 预警 SSE 推送：/alert-stream
   *
   * 这是对「隐藏即断流」策略的有意破例（docs/alerts-plan.md §7.1）：这条流
   * 只在触发时才有数据（一天几条），不产生任何上游请求，与断流策略原本要对齐的
   * 「连接数」目标不冲突；行情流照旧隐藏即断。订阅集合独立于 sseClients，
   * 不参与 sseTick 的 size===0 开关——预警评估循环在 Host，与谁在看无关。
   */
  register(PREFIX + "/alert-stream", (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");
    alertClients.add(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 25000);

    function cleanup() {
      clearInterval(heartbeat);
      alertClients.delete(res);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    req.on("close", cleanup);
    req.on("error", cleanup);
    const guard = setTimeout(cleanup, 6 * 60 * 60 * 1000);
    guard.unref?.();
  });

  // 预警独立评估循环：无启用规则 / 休市 → 休眠；与 sseClients 订阅无关。
  startAlertLoop(ctx);

  register(PREFIX + "/minute", async (req, res) => {
    const q = queryOf(req);
    const code = normalizeApiCode(q.get("code") || "");
    if (!code) {
      sendJson(res, 400, { code: null, points: [], error: "缺少股票代码" });
      return;
    }
    const data = await fetchMinute(code);
    sendJson(res, 200, Object.assign({ code, updatedAt: Date.now() }, data));
  });

  register(PREFIX + "/kline", async (req, res) => {
    const q = queryOf(req);
    const code = normalizeApiCode(q.get("code") || "");
    const period = ["day", "week", "month", "minute5", "minute15", "minute30", "minute60"].includes(q.get("period"))
      ? q.get("period")
      : "day";
    let count = parseInt(q.get("count") || "160", 10);
    if (!Number.isFinite(count)) count = 160;
    count = Math.min(600, Math.max(20, count));
    const end = (q.get("end") || "").replace(/[^0-9\-]/g, "").slice(0, 10);
    if (!code) {
      sendJson(res, 400, { code: null, period, candles: [], error: "缺少股票代码" });
      return;
    }
    const data = await fetchKline(code, period, count, end);
    sendJson(res, 200, Object.assign({ code, period, count, updatedAt: Date.now() }, data));
  });

  register(PREFIX + "/search", async (req, res) => {
    const needle = (queryOf(req).get("q") || "").trim().slice(0, 40);
    if (!needle) {
      sendJson(res, 200, { ok: true, rows: [] });
      return;
    }
    let rows = [];
    let error = null;
    try {
      rows = await searchStocks(needle);
      // 本地配置里已有的代码优先命中（支持拼音首字母搜索自选股名称）
      const cfg = readConfig();
      const lower = needle.toLowerCase();
      const local = [...cfg.indices, ...cfg.watchlist, ...cfg.positions];
      const seen = new Set(rows.map((r) => r.code));
      for (const item of local) {
        if (seen.has(item.code)) continue;
        const nm = String(item.name || "").toLowerCase();
        if (item.code.toLowerCase().includes(lower) || (nm && nm.includes(lower))) {
          seen.add(item.code);
          rows.unshift({ code: item.code, name: item.name, type: "LOCAL", label: "自选", market: marketLabel(item.code) });
        }
      }
    } catch (e) {
      error = String((e && e.message) || e);
    }
    sendJson(res, 200, { ok: !error, rows, error, updatedAt: Date.now() });
  });

  // 诊断：数据源连通性自检（设置页「测试数据源」按钮）
  register(PREFIX + "/probe", async (_req, res) => {
    const checks = [];
    const probe = async (label, fn) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        checks.push({ label, ok: true, ms: Date.now() - t0, detail });
      } catch (e) {
        checks.push({ label, ok: false, ms: Date.now() - t0, detail: String((e && e.message) || e) });
      }
    };
    await probe("行情快照 qt.gtimg.cn", async () => {
      const map = await requestQuotes(["sh000001"]);
      const row = map.get("sh000001");
      if (!row) throw new Error("无数据");
      return `${row.name} ${row.price} ${row.percent}%`;
    });
    await probe("分时 web.ifzq.gtimg.cn", async () => {
      const d = await fetchMinute("sh000001");
      if (d.error) throw new Error(d.error);
      return `${d.points.length} 个分钟点`;
    });
    await probe("K线 fqkline", async () => {
      const d = await fetchKline("sh600519", "day", 30, "");
      if (d.error) throw new Error(d.error);
      return `${d.candles.length} 根K线`;
    });
    await probe("搜索 smartbox", async () => {
      const rows = await searchStocks("茅台");
      if (rows.length === 0) throw new Error("无结果");
      return rows
        .slice(0, 2)
        .map((r) => `${r.code}(${r.label})`)
        .join(", ");
    });
    sendJson(res, 200, { ok: checks.every((c) => c.ok), checks, configPath: configPath(), at: Date.now() });
  });
}

export { apply, inject, name, normalizeApiCode, sanitizeConfig, defaultConfig, readConfig, writeConfig };
