# 架构

## 全局

```
浏览器（client.js）
  ├─ conversation.composer.dock → 左下角指数栏（IndexBar）
  ├─ shell.overlay              → 悬浮窗（大盘/自选/持仓/设置/详情）
  ├─ 共享 store：配置 + 行情快照 + SSE/轮询双通道（页面隐藏自动暂停）
  └─ 自绘 SVG 分时 / K线 / 盈亏曲线（零 CDN 依赖）
        │ fetch 同源 /dsh-stock-leek/*
        ▼
Host（index.js，cordis 插件，依赖 webServer）
  ├─ /config  GET/POST  读写配置（含首屏行情快照、版本号、损坏告警）
  ├─ /stream  SSE 行情推送（多标签页共用一次拉取）
  ├─ /quotes  批量实时行情（qt.gtimg.cn，GBK，1.5s TTL + 单飞去重）
  ├─ /minute  分时   /kline 日/周/月K(前复权)   /search 全市场搜索
  └─ /probe   数据源连通性自检
        ▼
  ~/.dsh/dsh-stock-leek/config.json  ← 自选/持仓/指数栏持久化（换浏览器不丢）

lib/shared.js（纯函数，Host 与测试共用）
  格式化（价格/百分比/金额/成交量/时间/代码）+ 盈亏口径（todayPnl 等）
```

## 目录职责

| 路径 | 用途 |
|---|---|
| `index.js` | Host 插件主体：webServer 路由、腾讯行情解析与编码、配置持久化、SSE 广播 |
| `client.js` | Client 插件主体：`__ModuleLoader__` 工厂，挂载两个槽位并实现全部 UI |
| `lib/shared.js` | 无副作用纯函数：格式化、代码显示、盈亏口径、常量。Host 与测试直接 import |
| `test/` | 四个套件，全部 `node` 直接跑，零 npm 依赖 |
| `docs/` | 本目录：架构、配置、行情通道等细节文档 |

**两个入口文件刻意留在根目录**：`package.json` 的 `exports` 与 `dsh.client` 声明按路径引用它们，DSH 打包时也依赖这个约定。

## 标识符命名

| 类别 | 值 |
|---|---|
| 包名 / 插件名 / `ModuleLoader` id | `dsh-stock-leek` |
| 路由前缀 | `/dsh-stock-leek/*` |
| 槽位 id | `dsh-stock-leek`、`.bar`、`.floating-bar`、`.tip-layer` |
| 配置广播频道 | `dsh-stock-leek.config`（BroadcastChannel） |
| 配置目录 | `~/.dsh/dsh-stock-leek/` |
| 环境变量 | `DSH_STOCK_LEEK_CONFIG`（旧名 `DSH_LEEK_FUND_CONFIG` 仍兼容） |
| CSS 类 / 自定义属性前缀 | `sl-` / `--sl-` |

插件改名时**只改标识符、不动用户数据**是两件必须分开做的事：

- 配置落盘位置变了 → 靠 `migrateLegacyConfig()` 自动搬迁（旧文件留 `.migrated.bak`）
- 浏览器 localStorage 键变了 → 靠 `migrateLocalStorageKeys()` 一次性搬家

两者都遵循同一条原则：**只在新键/新位置不存在时才搬，搬完不删源**。

## 行情通道

默认走 **SSE 推送**（`/dsh-stock-leek/stream`）：Host 按 `pollMs` 拉一次行情，推给所有订阅的标签页，避免多标签页各打各的接口。

几个关键约束：

- **订阅集合走 URL `?codes=`**。`EventSource` 只能 GET、无法发送请求体（`es.send()` 是 WebSocket 的 API，不存在），所以集合变化时只能「关掉再按新 URL 重开」——一次握手代价，可接受。
- **断流自动回落轮询**。`onerror` 关闭流并恢复 `setTimeout` 轮询链；页面恢复可见再重连。代理不支持 SSE 时用户完全无感。
- **页面隐藏时断开**。隐藏时关流 + 清轮询定时器，可见时立即刷一次并重连。
- 心跳每 25s 发一次注释帧（`: ping`），避免中间层掐断长连接。

## client.js 的两处「不得不重复」

> 这里说的「重复」指**代码上的复制**，不是功能上的重做。

### 1. 无法 import 共享模块

`client.js` 由 DSH 的 ModuleLoader 以「惰性 CJS 表」加载。宿主源码里 `exactPackageSpecifier` 规定，factory 内的 `require` **只接受无 `/` 无 `:` 的裸包名**：

```js
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith("@")) { /* 作用域包 */ }
  return specifier.length > 0 && !specifier.includes("/") && !specifier.includes(":") ? specifier : void 0
}
```

因此 `./shared.js` 解析失败，client.js **无法 import `lib/shared.js`**，只能保留一份内联副本。

代价是「改了 shared.js 忘了改 client.js」的风险。对策是 `test/shared-drift.mjs`：它从 client.js 的**真实源码**里用花括号配平抠出函数体、`new Function` 求值后与 `lib/shared.js` 逐输入对拍。测的是线上真正执行的那份代码，而不是测试里重写的替身。

### 2. 配置字段的旧版兼容

`sanitizeConfig` 是**白名单重建**——未知字段一律丢弃。这曾导致一个真实 bug：运行中的 Host 是旧进程，它的 `sanitizeConfig` 不认识 `ma` 字段，于是每次勾选 MA 后 500ms 都被回填成默认，表现为「点取消又立刻选上」。

修法是客户端在 host 回填配置时，若发现本地有的字段被丢掉，**保留本地值**：

```js
if (!Array.isArray(merged.ma) && Array.isArray(cfg.ma)) merged.ma = cfg.ma;
```

这提醒一件事：**配置新增字段时，必须同时更新 Host 与客户端的兼容处理**，否则老 Host 进程会静默吃掉新字段。

## 盈亏口径

`todayPnl` 用现金流口径而非简单涨跌乘股数，这样盘中加仓/减仓不会被算成盈亏：

```
有当日变动：qty×现价 + 今日卖出额 − 今日买入额 − 昨仓×昨收
无当日变动：(现价 − 昨收) × qty
其中 昨仓 = 当前持仓 − 当日净买入
```

无昨收数据时返回 `0`（而非 NaN 或猜测值）。跨日自动失效：次日没有当日 `txns`，公式自然退回第二条。

同一口径被三处复用——持仓列表每行的「今日」、顶部汇总、以及当日盈亏曲线（把公式里的 `now` 换成该分钟的价格再逐分钟求和，各市场交易时段不同时按时间并集对齐）。`test/shared-drift.mjs` 里有一条专门的自检断言防止口径被改坏。