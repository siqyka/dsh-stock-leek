# 股票预警功能 · 实施计划

> 状态：**计划已确认，尚未动工**。本文档是唯一的实施依据，动代码前先看这份。
> 确认于 2026-10-15。范围：Phase 1 + 2 一次做完；配置落点复用 `cfg.remind` 作总开关 + 新增 `cfg.alerts`；评估范围仅「已启用规则」涉及的股票；评估节奏 `clamp(pollMs, 2s, 15s)`；`armed/fired` 状态随历史一起落盘。

---

## 1. 核心矛盾：为什么评估必须放 Host

现有架构有一条硬约束——**客户端在标签页隐藏时就断开 SSE 并停掉轮询**：

```js
// client.js:866-875
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
    closeStream();          // 隐藏时断开 SSE（与服务端连接数对齐）
  } else if (pollActive) { ... }
});
```

而 Host 的 SSE 广播循环**没有订阅者就不跑**：

```js
// index.js:1046
if (sseClients.size === 0) return;
```

结论：**把预警评估挂在客户端、或挂在现有 `sseTick` 上，都会退化成「只在你盯着看的时候才预警」**——那正是预警最没用的时候。所以评估必须是 Host 侧一条与「谁在看」完全无关的独立循环。

这也决定了功能的定位：**历史与角标是主体，桌面通知是增强**。功能不能依赖通知成立。

---

## 2. 目标架构

```
Host 独立评估循环（ctx.effect 管生命周期，与 sseClients 无关）
  ├─ 无启用规则            → 完全休眠，一次上游请求都不打（零成本）
  ├─ 有规则 && 市场在交易时段 → 按 clamp(pollMs,2s,15s) 评估
  ├─ 有规则但全市场休市     → 退避 60s 探一次，开盘自动恢复
  ├─ fetchQuotes(规则涉及的 code) + attachSpeed
  ├─ stepAlert() 状态机判定 → 触发则追加到 alerts 历史并落盘
  └─ 推给 /alert-stream 的在线订阅者（没人连着也照样记录）
         │
         ├─ GET  /alerts        触发历史（回来能看到「错过了哪些」）
         └─ GET  /alert-stream  SSE 实时推送（Phase 2）
```

复用现成能力，不重复造：

| 复用 | 出处 |
|---|---|
| `fetchQuotes` 的 1.5s TTL + 单飞去重 | [index.js:598-613](../index.js#L598-L613) |
| `attachSpeed` 涨速 | [index.js:584](../index.js#L584) |
| `quoteCache` / `QUOTE_TTL` | [index.js:43-45](../index.js#L43-L45) |
| 配置原子写盘 + `.bak` 备份 | [index.js:331-344](../index.js#L331-L344) |
| 路由注册 `register()` | [index.js:875-876](../index.js#L875-L876) |

**评估循环不能复用 `sseTick`**——它 `size === 0` 就早退，且推的是「所有订阅者的 code 并集」，与「仅已启用规则的 code」不是一回事。

---

## 3. 数据模型

`cfg.remind` 一直是预留死字段（[index.js:140-141](../index.js#L140-L141) 注释：「突破成本价/盈亏阈值时高亮」），正好接住它原本的含义作**全局总开关**；规则本身进新数组 `cfg.alerts`。

```js
// cfg.alerts 里的一条规则
{
  id: "a1",              // 稳定 id：去重、多标签页认领、状态机 key 都靠它
  code: "sh600519",
  name: "贵州茅台",
  type: "price_above",   // 见下表
  value: 1500,           // 阈值（pct_* / speed_up 的单位是 %）
  enabled: true,
  createdAt: 1760000000000,
}
```

### 首发 8 种规则（全部基于现有行情字段，零额外接口）

| type | 判据 | 依赖字段 |
|---|---|---|
| `price_above` | 现价上穿阈值 | `price` |
| `price_below` | 现价下穿阈值 | `price` |
| `cost_above` | 突破**成本价** | 持仓 `cost` |
| `cost_below` | 跌破**成本价** | 持仓 `cost` |
| `pct_up` | 当日涨幅 ≥ N% | `percent` |
| `pct_down` | 当日跌幅 ≥ N% | `percent` |
| `limit_near` | 距涨/跌停 < N% | `limitUp` / `limitDown` |
| `speed_up` | 涨速 ≥ N%（急拉） | `speed` |

行情字段见 [index.js:486-508](../index.js#L486-L508)：`price / yestclose / percent / high / low / limitUp / limitDown / amplitude / turnover`，涨速由 `attachSpeed` 补。

**后续再考虑**（首发不做，避免规则类型膨胀）：放量（需引入 5 日均量基线）、止损/止盈线联动持仓、大盘跳水联动、跌破 N 日均线。

---

## 4. 三个必须做对的细节（没做对就是垃圾功能）

### 4.1 穿越语义 + 滞回带宽

朴素的 `price >= 1500` 会在价格停在 1500 上方时**每 3 秒报一次**，几分钟内刷屏。必须做成状态机：

```
   armed ────────价格上穿阈值────────▶ fired（只报这一次）
     ▲                                      │
     └────价格回落到 阈值×(1-HYSTERESIS)─────┘
```

滞回带宽 `HYSTERESIS = 0.5%`（可配）。下穿型规则镜像处理。

### 4.2 每日重置

预警是**当日事件**。昨天触发过，今天必须重新生效。`stepAlert` 接收 `dateStr`，跨日强制回 `armed`。

### 4.3 休市不评估

收盘后现价恒定不变，会立刻满足某个「跌破」条件并疯狂补报。靠时段判断门控（见 §5）。

---

## 5. 时段判断：从 client.js 提到 shared.js

⚠️ **注意：`marketWindows` 目前只存在于 client.js**，`lib/shared.js` 里没有：

```
client.js:403  function marketWindows(code)      ← 唯一的一份
client.js:411  function marketMinutes(code, now)
client.js:436  function isMarketOpen(code, now)
client.js:452  function shouldExpandBar(code, now)
```

Host 侧评估要用时段判断，只有两条路：

- **提到 `lib/shared.js`**（推荐）：`marketWindows` / `marketMinutes` / `isMarketOpen` 三个纯函数进 shared，client.js 保留内联副本，纳入 `shared-drift` 对拍清单。
- Host 自己再写一份：两份时段表必然漂移，且没有测试会报警。**不要选这条**。

`shouldExpandBar` 是纯 UI 逻辑（指数栏展开时机），**不要**搬到 shared.js，留在 client.js。

---

## 6. 触发历史落盘

### 6.1 为什么不塞进 config.json

`config.json` 背后是一整套机制：`.bak` 轮换备份、`__rev` 乐观锁、`.corrupt` 损坏找回（[index.js:248-344](../index.js#L248-L344)）。预警事件是**高频追加的流水**，每次触发都重写配置既浪费，又会搅乱 `__rev` 并发检测（[index.js:886-890](../index.js#L886-L890)）。事件流与配置分开。

### 6.2 ★ 路径命名：用 `config.json.alerts`，不要用 `dirname()/alerts.json`

这是计划阶段发现的一个坑，值得单独写清楚。

现有测试隔离机制是这样工作的：`config-guard` 把配置路径设成 `tmpdir()/dsh-stock-leek-<tag>-<pid>.json`（[test/config-guard.mjs:105](../test/config-guard.mjs#L105)），并靠**环境变量**让 index.js 惰性解析到它。

如果按直觉写成 `join(dirname(configPath()), "alerts.json")`：

| 环境 | `configPath()` | alerts 落到 | 后果 |
|---|---|---|---|
| 生产 | `~/.dsh/dsh-stock-leek/config.json` | `~/.dsh/dsh-stock-leek/alerts.json` | ✅ 正确 |
| e2e 测试 | `%TEMP%/dsh-stock-leek-e2e-123.json` | `%TEMP%/alerts.json` | ❌ **落在临时目录根，跨测试套件共享、且不会被清理** |

`dirname` 把 pid 隔离信息丢掉了。两个套件并发跑会互相写坏同一个文件。

**改用 `configPath() + ".alerts"`**：

| 环境 | alerts 落到 |
|---|---|
| 生产 | `~/.dsh/dsh-stock-leek/config.json.alerts` |
| e2e 测试 | `%TEMP%/dsh-stock-leek-e2e-123.json.alerts` |

于是：

1. **隔离自动继承**——路径从 `configPath()` 派生，环境变量指到哪它跟到哪，不需要新写一套守卫。
2. **符合既有同级文件约定**——目录里已经有 `config.json.bak`、`config.json.corrupt`（见 [docs/configuration.md:69-76](configuration.md#L69-L76)），`config.json.alerts` 是同一族的命名，不是新发明。
3. **清理只需追加一项**——`config-guard` 的清理列表 [test/config-guard.mjs:110](../test/config-guard.mjs#L110) 从 `[p, p+".bak", p+".corrupt"]` 加个 `p+".alerts"` 即可。

> 派生规则必须走 `configPath()`，**绝对不能在模块顶层固化**——ESM 静态 import 提升会让守卫来不及生效，这是本项目出过的最严重事故（真实用户持仓被测试覆盖）。详见 [test/config-guard.mjs:30-64](../test/config-guard.mjs#L30-L64) 与 [docs/architecture.md](architecture.md) 的惰性解析说明。

### 6.3 文件结构

```json
{
  "version": 1,
  "day": "2026-10-15",
  "events": [
    { "at": 1760000000000, "ruleId": "a1", "code": "sh600519", "name": "贵州茅台",
      "type": "price_above", "value": 1500, "price": 1501.2, "percent": 2.31 }
  ],
  "states": { "a1": { "phase": "fired", "day": "2026-10-15" } }
}
```

- 环形缓冲：`events` 保留最近 200 条
- 跨日：`day` 与今天不符时清空 `events`、`states` 全部回 `armed`（对应 §4.2）
- `states` 落盘 = 已确认的「Host 重启不会把报过的再报一遍」
- 客户端**永不 POST** 这个文件，只有 Host 写

---

## 7. Phase 2：后台通知

### 7.1 隐藏时保留 `/alert-stream`（显式例外）

这是对 §1 那条「隐藏即断流」策略的**有意破例**，理由必须写进代码注释：

> 这条流只在**触发时**才有数据（一天几条），不产生任何上游请求，与断流策略原本要对齐的「连接数」目标不冲突。行情流照旧隐藏即断。

Host 侧：`/alert-stream` 用**独立的订阅集合**，不参与 `sseTick` 的 `size === 0` 判断（那是行情广播的开关）。

### 7.2 通知权限绝不在加载时申请

只在用户点「开启桌面通知」按钮时申请。两个原因：浏览器要求用户手势，否则直接拒绝；开局弹权限框体验很差。

### 7.3 三级降级

| 条件 | 行为 |
|---|---|
| 页面可见 | toast + 铃铛角标 |
| 隐藏 + `Notification` 已授权 | 系统通知，点击回到页面 |
| 隐藏 + 未授权 / `Notification` 不可用 | `document.title` 加 ⚠ 前缀闪烁 |
| 以上全不可用 | 历史 + 角标仍在，回来能看到 |

DSH 宿主可能是 webview，`Notification` 未必存在——**降级链必须有兜底，不能假设通知可用**。

### 7.4 多标签页去重

三个标签页都隐藏 → 三条重复系统通知。用 `navigator.locks` 按事件 id 认领，抢到的才弹；`navigator.locks` 不可用时退回「照弹」并注释说明。

---

## 8. UI

| 位置 | 改动 |
|---|---|
| 新增第 5 个 tab「**预警**」 | 规则列表（增删改 / 启停）、桌面通知开关、触发历史 |
| 自选 / 持仓行右键 | 「设为预警」，预填现价或成本价（复用 [client.js:579 `openMenu`](../client.js#L579)） |
| 指数栏 | **常驻铃铛 + 未读角标** |

tab 定义在 [client.js:2657](../client.js#L2657)，分发在 [client.js:2667](../client.js#L2667)。

> 角标在指数栏**收起状态下也要显示**。你 20:00 回来时栏是收着的（见 `shouldExpandBar`），而那恰恰是你最想知道「错过了什么」的时刻。

---

## 9. 涉及文件与量级

| 文件 | 改动 | 量级 |
|---|---|---|
| `lib/shared.js` | `stepAlert` 状态机、`sanitizeAlert`；`marketWindows`/`marketMinutes`/`isMarketOpen` 从 client.js 提上来 | +110 |
| `index.js` | `cfg.alerts` + sanitize 白名单、独立评估循环、`config.json.alerts` 读写、`/alerts` + `/alert-stream` | +190 |
| `client.js` | 预警 tab、铃铛角标、右键项、alert-stream 订阅、三级降级、多标签去重；时段函数改引用内联副本 | +290 |
| `test/config-guard.mjs` | 清理列表加 `p+".alerts"`；断言 alerts 走隔离路径 | +25 |
| `test/shared-drift.mjs` | 状态机对拍 + 滞回/跨日语义；新迁入的时段函数纳入对拍 | +70 |
| `test/test-routes.mjs` | sanitize 不吃 `alerts`、两个新端点、脏值回落 | +50 |
| `test/e2e-render.mjs` | UI 全流程、通知降级（stub `Notification`）、老 Host 吃字段回归 | +100 |
| `docs/*.md`、`README.md` | 架构决策、配置项、功能说明 | — |

---

## 10. 已知的坑（写在这里就是为了别再踩）

1. **`sanitizeConfig` 是白名单重建，未知字段静默丢弃**（[index.js:209](../index.js#L209)）。老 Host 进程不认识 `alerts` 会把它吃掉——和当年 `ma` 字段被吃是**同一个坑**。客户端侧要照 [client.js:689](../client.js#L689) / [client.js:908](../client.js#L908) 那样加本地值回填保护，**并且这条必须有 e2e 断言**（当年就是靠断言才发现的）。

2. **`client.js` 无法 import `lib/shared.js`**。DSH 的 `exactPackageSpecifier` 只接受无 `/` 无 `:` 的裸包名，详见 [docs/architecture.md](architecture.md) 「client.js 的两处不得不重复」。所有进 shared.js 的预警函数**必须同时写内联副本**，并加进 `shared-drift` 的对拍清单。

3. **加配置字段的完整清单**在 [docs/development.md:136-145](development.md#L136-L145)，共 6 环，漏任何一环都静默失效。`alerts` 要走完这 6 环。

4. **浏览器里没有 `process`**。给 client.js 加测试开关要用 `globalThis.__SL_*__`，写 `process.env` 会抛 `ReferenceError` 并被 `try/catch` 吞掉，表现为「开关生效了但分支根本没跑到」。见 [docs/development.md](development.md)。

5. **时段相关的测试要留时间注入点**。指数栏那轮已经建了 `globalThis.__sl_now__` 机制，预警的「休市不评估」「跨日重置」用例必须复用它，否则断言只在作者写代码的那几分钟成立。

6. **Host 重启后状态机是冷的**——已通过 §6.3 的 `states` 落盘解决。

---

## 11. 实施顺序（4 个提交，每步可独立验证）

| # | 内容 | 完成判据 |
|---|---|---|
| 1 | **地基**：shared.js 状态机 + 时段函数上提 + drift 对拍 | `npm test` 全绿；drift 覆盖新函数；时段函数上提后 client.js 行为无变化 |
| 2 | **Host**：`cfg.alerts` + sanitize + 独立评估循环 + `config.json.alerts` + `/alerts`、`/alert-stream` | config-guard 断言 alerts 走隔离路径；test-routes 覆盖新端点；无规则时零上游请求 |
| 3 | **UI**：预警 tab + 铃铛角标 + 右键「设为预警」+ 吃字段回填保护 | e2e 覆盖建规则→触发→角标；老 Host 模拟下 `alerts` 不丢 |
| 4 | **通知**：alert-stream 订阅 + 隐藏保留该流 + 三级降级 + 多标签去重 | e2e stub `Notification` 三种权限状态各一条断言 |

**先写失败测试再改实现**，每个断言都要做一次非空洞验证（把实现改坏，确认该断言变红）。项目已有大量「看着绿其实空转」的教训记录在 [docs/development.md](development.md)。

---

## 12. 验收标准

1. 关掉所有标签页（隐藏），触发一条预警 → 回来能看到历史与角标；开了通知则系统通知已弹
2. 价格停在阈值上方 10 分钟 → **只报 1 次**（滞回）
3. 次日同样条件 → 重新生效（跨日重置）
4. 休市期间 → 零上游请求、零误报
5. 未启用任何规则 → 评估循环完全休眠，不打接口
6. 老版本 Host 进程下新建规则并重载 → 规则不丢（回填保护）
7. `npm test` 全绿，且新增断言逐条通过非空洞验证
