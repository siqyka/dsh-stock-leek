# 股票预警功能 · 实施计划

> 状态：**已实施完成**（4 个提交：地基 → Host → UI → 通知）。
> 本文档同时是该功能的**设计与决策依据**，含 8 处实施前评估修正（交易日判据、日界时区、limit_near 市场限制、alerts 上限、marketNow 上提、Host 时间注入、未读语义、cost 悬空、重连补齐）。
> 确认于 2026-10-15；范围：Phase 1 + 2 一次做完；配置落点复用 `cfg.remind` 作总开关 + 新增 `cfg.alerts`；评估范围仅「已启用规则」涉及的股票；评估节奏 `clamp(pollMs, 2s, 15s)`；`armed/fired` 状态随历史一起落盘。

---

## 0. ⚠️ 最终形态（实施后按用户反馈调整，与下文原始设计有出入处以本节为准）

下文保留**原始设计与决策过程**（含评估修正、踩坑记录），但落地形态有四处按用户要求改过：

| 项 | 原始设计（下文） | **最终形态** |
|---|---|---|
| 触发历史 | `config.json.alerts` 存 `{events, states}`，预警页展示历史 | **去掉历史**：只存 `states`；`/alerts` 不返回 events；预警页无历史区块 |
| 预警入口 | 新增第 5 个 tab「预警」 | **设置页内的二级页**，不占 tab |
| 提醒图标 | 指数栏常驻铃铛 + 未读角标 | **完全去掉**：左下角无任何提醒图标；未读概念随之取消 |
| 触发提示 | 可见→toast / 隐藏→系统通知 的互斥降级链 | **应用内弹窗为唯一保证通道**（可见与否都弹）+ 系统通知叠加；**不弹 toast** |

补充落地细节（下文未覆盖）：

- 弹窗位置：**对话区顶部居中**（探测不到对话区时视口居中），坐标**钳进视口** —— 否则窗口缩小时会跑到可视区外。
- 弹窗容量：**同时最多 3 条**，溢出的叠加到最早那条并显示 `+N`；「全部关闭（N）」的 N 含叠加数。
- 弹窗生命周期：**10 秒自动消失**，可点 `✕`/`Escape`/「全部关闭」；倒计时**只在页面可见时走**（隐藏时冻结），否则你不在时它会悄悄过期。
- **弹窗注册为独立 slot**，与悬浮窗开关解耦 —— 曾经挂在 `Overlay` 内部，而它有 `if (!s.open) return null`，导致「不打开悬浮窗就收不到预警」。
- `states` **必须保留**：它是「每交易日只提示一次」的唯一依据，丢了会在 Host 重启后重复播报。

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
  ├─ stepAlert() 状态机判定 → 触发则落盘 states（**当日不再重复**）并推送
  └─ 推给 /alert-stream 的在线订阅者（没人连着也照常评估）
         │
         ├─ GET  /alerts        规则状态（客户端重连后取回；不返回触发历史）
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

⚠️ 修订（`limit_near` 市场限制）：只有 A 股/北交所行情有有效涨跌停价，**港股、美股以及指数字段返回 `-1` 哨兵**（实测 sh000001 即 `limitUp:-1`）。若对它建 `limit_near`，阈值会算成 ≈ `-1×(1−N%)` 的负数，armed 立刻穿越、必然误触发。防护两道：**UI 侧仅 sh/sz/bj 前缀的 code 提供该类型选项；Host sanitize 对非 A 股 code 拒收**（与 `price_below` 不同，这里是"市场不存在该概念"而非"参数非法"）。

⚠️ 修订（`cost_above`/`cost_below` 悬空语义）：持仓会在「上一交易日清仓」后被自动移除（`purgeStaleClosedPositions`），届时规则的成本价不复存在。行为定义为：**规则保留、Host 找不到持仓或持仓无成本价时跳过该规则，不触发也不删除**（删用户的东西不是我们的权力）；UI 上该行给一个「成本已失效」灰标。

### 规则上限

⚠️ 修订：`cfg.alerts` 数组 **≤ 50 条**，单条规则字段长度对齐现有白名单清洗。列表类字段在安全清洗里已有 `≤300` 先例，预警是高频评估路径，必须更严：没有上限，规则膨胀后评估循环的批量 fetch 会失控（现有广播循环有 `slice(0, 200)` 护栏，新循环对齐同样的上限并注释说明原因）。

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

### 4.2 每日重置（日界=市场本地交易日，不是本地墙上时钟）

预警是**当日事件**。昨天触发过，今天必须重新生效。

⚠️ 修订：**不能用浏览器/主机本地日期当 `dateStr`**。美股 21:30–04:00（北京时间）正在盘中，本地 00:00 一到就强制回 `armed`，已 fired 的规则当晚能再报一次，滞回与跨日语义全部失真。

正确做法：`stepAlert` 接收的 `dateStr` 由**行情自带时间戳**（`quote.time`，如 `20261014161401`）取 `YYYYMMDD` 推导——它是报价源所在市场的交易日，美股报价时间戳天然按美东走。§6.3 的 `states` 按规则存 `day`，判据是 `state.day !== quoteDay` 才重置。

### 4.3 交易日判定（修订：时段判断挡不住节假日）

收盘后现价恒定不变，会立刻满足某个「跌破」条件并疯狂补报。必须门控。

⚠️ 修订：**`isMarketOpen` 只有「周末 + 分钟窗口」，没有交易日历**。工作日撞上国庆/春节，窗口照样命中 → 节假日每 2~15s 打一次上游（违反验收 #4），且现价恒定于旧收盘，若恰满足某条 armed 规则会**误触发一次**（滞回挡不住"从未越过"的初始态）。

双判据缺一不可：

1. **时段门控**（省 token）：所有规则 code 的市场都 `isMarketOpen=false` → 退避 60s，不打接口。
2. **交易日判据**（防误报，主判据）：取 `quote.time` 的市场本地日；**若该 code 全部规则的 codeDay 都等于当日、且报价时间戳落在收盘后区间，跳过触发**——实施上以 `quoteDay !== state.day` 为"新交易日"唯一信号，报价陈旧时 `quoteDay` 不变，规则停留在原 phase，既不误报也不重复推。

验收 #4 相应改为：**休市/节假日 → 零上游请求（时段门控）、零误报（交易日判据）**。

---

## 5. 时段判断：从 client.js 提到 shared.js

⚠️ **注意：`marketWindows` 目前只存在于 client.js**，`lib/shared.js` 里没有：

```
client.js:403  function marketWindows(code)      ← 唯一的一份
client.js:411  function marketMinutes(code, now)
client.js:430  function marketNow()              ← 读 globalThis.__sl_now__
client.js:436  function isMarketOpen(code, now)
client.js:452  function shouldExpandBar(code, now)
```

Host 侧评估要用时段判断，只有两条路：

- **提到 `lib/shared.js`**（推荐）：`marketWindows` / `marketMinutes` / `isMarketOpen` 三个纯函数进 shared，client.js 保留内联副本，纳入 `shared-drift` 对拍清单。
- Host 自己再写一份：两份时段表必然漂移，且没有测试会报警。**不要选这条**。

⚠️ 修订（`marketNow` 与注入点边界）：`isMarketOpen` 的默认参数走 `marketNow()`，而它读的是**浏览器全局** `globalThis.__sl_now__`。上提时：

1. **shared.js 版把 `now` 改成必填**（Host 侧调用方自己传 `new Date()`），内联副本保留 `marketNow()` 默认。否则 Host 的 Node 进程里 `__sl_now__` 永远不存在，测试无法稳定构造「节假日/盘中」时刻。
2. **`marketMinutes` 依赖 `Intl.DateTimeFormat` 的 timeZone**，Node 18+ 带完整 ICU 没问题，但要写进对拍输入（同一时刻、A股/港/美三个时区各一组），验证浏览器与 Node 结果一致。
3. **`marketNow()` 不上提**——它是客户端测试钩子，Host 用自己的 `Date.now()`，两者混进同一份共享代码反而让对拍失真。`isMarketOpen` 上提版不引用它。

`shouldExpandBar` 是纯 UI 逻辑（指数栏展开时机），**不要**搬到 shared.js，留在 client.js。

---

## 6. 状态落盘（原始设计为"触发历史落盘"，已按用户要求去掉历史）

> ⚠️ **本节原始设计存 `{events, states}`**。最终只存 `states`（判断"今日是否已提示"），
> `events` 触发历史已按要求去掉 —— 详见开头的「最终形态」。下面关于"事件流"的论证
> 仍然适用于 `states`（它同样是评估循环高频读写的东西，不该搅动 `__rev`）。

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
  "events": [
    { "at": 1760000000000, "ruleId": "a1", "code": "sh600519", "name": "贵州茅台",
      "type": "price_above", "value": 1500, "price": 1501.2, "percent": 2.31 }
  ],
  "states": { "a1": { "phase": "fired", "day": "20261014" } }
}
```

- 环形缓冲：`events` 保留最近 200 条
- 跨日：`states[id].day !== quoteDay` 强制回 `armed`（对应 §4.2，日 key 来自行情时间戳的市场本地日，**不是本地墙上时钟**）。⚠️ 修订：不再用全局单一 `day` 字段——多市场并存时（A 股已收盘、美股正盘中）一个"今天"无法同时表达两个市场的交易日，per-rule `day` 才是正确粒度。
- `states` 落盘 = 已确认的「Host 重启不会把报过的再报一遍」
- ⚠️ 修订（ruleId 安全）：`states` 以 ruleId 为键。id 虽由 Host 自己写，但**源自客户端提交**，sanitize 必须把 `id` 限为 `[A-Za-z0-9_-]{1,32}`——配置 POST 已有 `__proto__`/`constructor` 守卫，这里是同一威胁面进入第二个文件的通道，别复用"那是 config 的事"的假设。
- 客户端**永不 POST** 这个文件，只有 Host 写

---

## 7. Phase 2：后台通知

### 7.1 隐藏时保留 `/alert-stream`（显式例外）

这是对 §1 那条「隐藏即断流」策略的**有意破例**，理由必须写进代码注释：

> 这条流只在**触发时**才有数据（一天几条），不产生任何上游请求，与断流策略原本要对齐的「连接数」目标不冲突。行情流照旧隐藏即断。

Host 侧：`/alert-stream` 用**独立的订阅集合**，不参与 `sseTick` 的 `size === 0` 判断（那是行情广播的开关）。

⚠️ 修订（重连补齐）：保留这条流挡不住 Chrome **标签页冻结（freeze）**——冻结时 EventSource 一样断。兜底策略：客户端每次（重）连 `/alert-stream` 成功后，**先 `GET /alerts` 拉一次全量历史做对账**（按 `at` 时间戳补角标未读数），再进入增量推送。不假设流不断，只假设历史文件完整。

### 7.2 通知权限绝不在加载时申请

只在用户点「开启桌面通知」按钮时申请。两个原因：浏览器要求用户手势，否则直接拒绝；开局弹权限框体验很差。

### 7.3 通知通道：应用内弹窗保底，其余叠加

⚠️ 实施后修订（用户要求）：原设计是「可见→toast / 隐藏→系统通知」的**互斥降级链**。问题在于 DSH 是 Electron webview，两个致命点：

- 隐藏/最小化时 `document.title` **根本看不见**（webview 未必有标签栏）
- `Notification` 在 webview 里**未必存在**，也不是所有用户会去点授权

于是「隐藏时」很可能**一条都收不到**——而隐藏恰恰是最需要预警的时刻。改为：

| 通道 | 条件 | 说明 |
|---|---|---|
| **应用内弹窗** | **无条件，可见与隐藏都弹** | **唯一保证通道**。挂 `shell.overlay` 顶层，窗口恢复时一定在；不被忽略 |
| toast | 仅页面可见 | 轻提示，弹窗已更醒目，隐藏时没必要 |
| 系统通知 | `Notification` 已授权 | 叠加增强，可见时**也发**（不再互斥）；隐藏时用 `navigator.locks` 去重防三连弹 |
| `document.title` ⚠ 前缀 | 隐藏且无通知能力 | 额外锦上添花，不再是唯一兜底 |

弹窗行为（用户要求）：

- **10 秒后自动消失**，也可点 `✕` / `Escape` / 点主体立即关（点主体进预警二级页并标记已读）
- 带倒计时进度条，让"还剩多久"可见
- 多条堆叠，队列上限 5；超过 1 条时给「全部关闭」按钮
- ⚠️ **倒计时只在页面可见时走，隐藏时冻结**（`shownAt=0`），恢复可见才补上起点。
  否则弹窗会在用户看不见的时候悄悄过期——那正好违背「隐藏也要能收到预警」这条要求本身。

### 7.4 多标签页去重

三个标签页都隐藏 → 三条重复系统通知。用 `navigator.locks` 按事件 id 认领，抢到的才弹；`navigator.locks` 不可用时退回「照弹」并注释说明。

---

## 8. UI

| 位置 | 改动 |
|---|---|
| 设置页 | 「🔔 预警」按钮 → **二级页**（规则列表增删改 / 启停、桌面通知开关、触发历史）。⚠️ 修订：预警**不占 tab**——它不常驻查看，占一个 tab 会让标题栏变挤；改为从设置进入的二级页，返回头复用详情页样式 |
| 自选 / 持仓行右键 | 「设为预警」，预填现价或成本价（复用 [client.js:579 `openMenu`](../client.js#L579)） |
| 指数栏 | ⚠️ 修订：**不放铃铛/角标**——左下角是常驻区域，提醒图标长期占位是噪音；未读数改在设置页入口按钮上以「🔔 预警（N 条未读）」呈现 |

tab 定义在 [client.js:2657](../client.js#L2657)，分发在 [client.js:2667](../client.js#L2667)。

⚠️ 修订（未读语义）：「未读」的计数与已读状态定义如下，不另发明：
- 未读数 = `events` 中 `at > lastSeenAt` 的条数（客户端算）
- `lastSeenAt` 存 **localStorage**（`sl.alert.seen.v1`），打开预警二级页即更新为当前时间
- **不进 config**：否则"看一眼"也要 POST 配置、搅动 `__rev` 乐观锁——§6.1 论证过的边界别在 UI 层自己破坏。它是设备偏好（每台设备各看各的），不是持仓数据。

⚠️ 修订（二级页的进入/退出）：预警面板挂在设置 tab 下，`s.alertPanel` 为真时替代设置页渲染。
**点任何 tab、进个股详情、关闭悬浮窗都必须复位 `alertPanel`**——否则会出现「点了设置却还停在预警页」。这条有 e2e 断言锁定。

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

5. **时段相关的测试要留时间注入点**。指数栏那轮已经建了 `globalThis.__sl_now__` 机制，预警的「交易日判定」「跨日重置」用例必须复用它，否则断言只在作者写代码的那几分钟成立。⚠️ 修订：`__sl_now__` 是**浏览器全局**，test-routes（Node 进程）里不存在——Host 侧函数的时间必须做成**参数注入**（`stepAlert(rule, quote, now)`、评估循环可注入 `readConfig`/`fetchQuotes` 替身），测试直接传固定时刻。两条注入路径别混用。

6. **Host 重启后状态机是冷的**——已通过 §6.3 的 `states` 落盘解决。

7. ⚠️ 修订（新增）：**行情 `time` 字段是字符串 `YYYYMMDDHHMMSS`，不是 epoch**。从它推 `quoteDay` 用 `String(q.time).slice(0, 8)`，**不要 `new Date(q.time)`**（会按本地时区误解析且部分市场时间戳格式可能不一致）。缺字段/脏值时跳过该 code 的触发判定（宁可不报，不可乱报），并在评估循环日志里计数，方便发现上游字段漂移。

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
3. 次日同样条件 → 重新生效（跨日重置；日界按 §4.2 的行情时间戳日，美股规则在北京时间 00:00 **不得**重置）
4. 休市/节假日 → 零上游请求（时段门控）、零误报（交易日判据，§4.3）
5. 未启用任何规则 → 评估循环完全休眠，不打接口
6. 老版本 Host 进程下新建规则并重载 → 规则不丢（回填保护）
7. `limit_near` 规则：港股/美股 code 被 UI 禁选、Host sanitize 拒收；A 股 code 正常生效
8. 持仓清仓移除后，其 `cost_*` 规则保留、评估时静默跳过，不触发、不删除
9. 重开 `/alert-stream`（含重连）先 `GET /alerts` 对账，冻结期间的事件能补进角标
10. `npm test` 全绿，且新增断言逐条通过非空洞验证

---

## 13. 实施结果（2026-10-15）

四个提交，每个都独立可验证：

| # | 提交 | 内容 |
|---|---|---|
| 1 | `feat(alerts): 地基` | `lib/shared.js` 上提时段三函数（共享版 `now` 必填）+ `quoteDayFor` + `sanitizeAlert(s)` + `stepAlert` 状态机；client.js 内联副本；drift 对拍大幅扩充 |
| 2 | `feat(alerts): Host` | `cfg.alerts` 接入清洗、独立评估循环（零规则休眠）、`config.json.alerts`、`/alerts` + `/alert-stream` |
| 3 | `feat(alerts): UI` | 预警二级页（设置内入口，**不占 tab**）、右键「设为预警」、吃字段回填保护 |
| 4 | `feat(alerts): 通知层` | 隐藏不断流的破例、三级降级、权限手势申请、`navigator.locks` 去重 |
| 5+ | 上线联调修复 | §13.2 三个真 bug（美股永不触发 / 休市误报 / 缺交易日判据）、§13.3 两个真 bug（unref 不评估 / 悬浮窗关着不弹）+ UI 打磨（居中定位、视口钳制、最多 3 条叠加、去掉 toast 与触发历史） |
| — | 测试基建 | 新增 `test/alert-loop-ref.mjs`（独立子进程验证定时器自触发）；`package.json` 的 `test` 链纳入 |

验收对照（每条都有承重断言，且做过非空洞验证）：

| # | 验收 | 实现位置 | 承重断言 |
|---|---|---|---|
| 1 | 隐藏触发→回来可见 | `notifyAlert` + `pushAlertPopup` | e2e：可见/隐藏都弹（弹出句柄为独立 slot）；隐藏+已授权弹系统通知 |
| 2 | 同一交易日只提示一次 | `stepAlert`（fired 当日不可逆） | routes：当日深度回落/重新上穿均不报；跨日才再报 |
| 3 | 次日重新生效 | `quoteDayFor` + `state.day` | routes：D15 fired → D16 仍上穿→再触发（两步非空洞） |
| 4 | 休市零请求/零误报 | `isMarketOpen` 门控 + 交易日判据 | routes：`alertStats` 断言 sleeps 增而 fetches 不动 |
| 5 | 无规则完全休眠 | `activeAlertCodes` 空 → 退避 | routes：ticks 增 + fetches 不动；**对照**：钉 `isMarketOpen=true` 后 fetches 立刻 0→1 |
| 6 | 老 Host 不丢规则 | `persistConfig`/`initStore` 回填 | e2e：丢字段→保留；回空数组→以回包为准（正反两条） |
| 7 | `limit_near` 市场限制 | `sanitizeAlert` + UI option disabled | drift：港美股拒收；routes：POST 清洗后仅留合法条 |
| 8 | 清仓后 cost 规则跳过 | `costBy` 查不到则 `skipped` | routes：无成本价 → `skipped` 含该 id 且 fired 为空 |
| 9 | 重连先对账 | `alertEs.onopen → refreshAlerts()` | e2e：隐藏时预警流保持、行情流断开（含对照断言） |
| 10 | 测试全绿 | — | 七个套件（drift / isolation / config-path / routes / security / alert-loop-ref / e2e）全绿；跑 `npm test` 看当前数量（文档刻意不写死条数） |

实施中修正的两处**测试方法错误**（都会让断言空转，记录备查）：

1. 直接改 `globalThis.__sl_test_state__` 快照**不会**触发 store 更新 —— 必须走真实交互或真实 HTTP。
2. `initStore` 有 `inited` 守卫（一页只跑一次），反复 render **不能**重放初始合并分支 —— 回填保护要改走 `persistConfig` 的回包合并（每次保存都跑）。

另有一处环境兼容：Node 24 的 `global.navigator` 是只读 getter，直接赋值会抛 `TypeError` 并让测试进程非零退出，需用 `defineProperty`。

### 13.1 实施后的 UI 调整（用户要求）

1. **左下角不放提醒图标**：删掉 `AlertBell` 与其 CSS（`sl-bell*`）。左下角是常驻区域，提醒图标长期占位是噪音；未读数改在**设置页入口按钮**上以「🔔 预警（N 条未读）」呈现。评估与账本链路完全不受影响（有断言锁定：无图标时账本照常记录）。
2. **预警不占 tab**：改为**设置页内的二级页**（`s.alertPanel`），返回头复用详情页的 `sl-dhead`/`sl-back` 样式。

这两处调整暴露了一个实现缺陷并已修复：预警面板挂在设置 tab 下时，**点 tab / 进详情 / 关悬浮窗都必须复位 `alertPanel`**，否则出现「点了设置却还停在预警页」。已补 e2e 断言（点 tab 退出、点「← 返回」退出、可再次进入）。

顺带修掉一条**写法不够严的断言**：「标题栏仍是四个 tab」原本只检查四个 tab 都在，把预警 tab 加回去照样绿。改为**断言数量恰好为 4**，非空洞验证确认此时 2 条变红。

### 13.2 实机模拟挖出的三个真 bug（单元测试没覆盖到）

上线跑**真实行情**后才发现——测试用的都是自造行情对象，绕过了真实数据的格式差异。三个 bug 全属这类：

**① 美股/港股规则永远不触发（严重）**
`quoteDayFor` 原本只认 14 位纯数字时间戳（腾讯 A 股格式）。实测三个市场格式**各不相同**：

| 市场 | 实测 `time` 字段 |
|---|---|
| A 股 sh600519 | `"20261015161456"` |
| 美股 usAAPL | `"2026-10-15 12:14:40"` |
| 港股 hk00700 | `"2026/10/15 16:08:42"` |

美股/港股 → 返回 `null` → 规则被判 `no-day` **静默跳过、永不触发**。修法：容忍分隔符后取前 8 位；drift 对拍补三市场格式用例。

**② 混合市场时，休市的规则被顺带评估并误报**
门控原本是 `if (!codes.some(isMarketOpen)) return` ——「任一市场开盘就**全部**评估」。A 股 + 美股规则并存时，美股盘中会让循环放行，而 A 股规则拿到的报价停在昨收、条件可能恒真 → 半夜误报一条（本次实测真的误报了一条茅台）。修法：`codes.filter(isMarketOpen)` **按 code 逐个门控**。

**③ 交易日判据根本没实现**
§4.3 承诺「报价日 != 市场本地当日 → 跳过」，但代码里只有状态机的日界，没有这道比对 —— 节假日里「价格恒定满足条件」会误报。补 `marketTodayFor(code, now)`（Intl 按市场时区取当日）+ 判定，并加正反两条断言（报价日落后 → 跳过；同报价在当日 → 正常触发）。

另有一处**认知修正**：港美股的 `limitUp`/`limitDown` **不是 -1 哨兵**，实测 `usAAPL.limitUp=8.72`、`hk00700.limitUp=1.27`（无意义值）。原先"按哨兵值设防"的思路不成立；好在实现是按**市场前缀**拒收 `limit_near`，无意中挡住了这个坑。

> **教训：自造数据的单元测试证明不了真实适配。** 预警这类依赖外部数据格式的功能，必须有一轮「拿真实行情跑一遍」的验证 —— 本次三个 bug 全部由实机模拟暴露，其中一个（美股永不触发）会让功能对港美股用户完全不可用。

### 13.3 上线联调又挖出两个 bug（都是"测试覆盖不到"的类型）

**④ 配了规则却永远不评估**
`sseTick` 的教训换了个位置重现：`startAlertLoop` 的 `schedule()` 里调了 `timer.unref()`。unref 的定时器**不阻塞事件循环退出** —— 进程里一旦没有其它活动句柄，这一拍**可能永远不触发**。表现：清空规则使循环进入 60s 退避后，再加规则等了 25 秒毫无动静，只有 `POST /config`（`alertKick`）才踢出第一拍。
（当初加 unref 是为了让测试进程能退出，代价却是生产功能失效。）

修法：去掉 unref；测试侧改用显式清理 `__stopAlertLoopForTest()`（`ctx.effect` 的清理函数也走同一条路）。
回归测试必须用**独立子进程**：主测试进程跑着 http server（活动句柄），unref 的定时器照样触发，**完全区分不出来**。子进程里除被测定时器外不留其它句柄，观察 `ticks` 是否推进。

**⑤ 悬浮窗关着就收不到预警**
`AlertPopup` 挂在 `Overlay` 内部，而 `Overlay` 开头是 `if (!s.open) return null` —— 悬浮窗没打开时整棵子树不渲染，弹窗一起被吞掉。
讽刺的是我在那行加的注释写着「与悬浮窗开关无关」，**注释与事实相反**，这就是踩坑的根源。
修法：注册为**独立 slot**（`dsh-stock-leek.alert-popup`，`order: 1000`），与悬浮窗开关彻底解耦。

**附带修掉的 UI 问题**（均有断言锁定 + 非空洞验证）：

- 坐标未钳制 → 窗口缩小时弹窗跑到可视区外（「全屏可见、缩小就消失」）
- 改回居中时**漏改回退分支**（残留贴左值 `left: 24`）→ 宿主探测不到对话区时弹窗偏到屏幕左边
- 爬父容器 3 层过深 → 可能越过对话面板拿到侧边栏几何，居中基准就偏了（改为 2 层 + 合理性检查）
- 成本类规则文案重复：「突破成本 **成本价**」（类型标签已含"成本"）

> **两条测试经验（都已写进 development.md 的陷阱清单）**：
> 1. **"断言能区分两种实现"必须实测**。这轮有 4 条断言是空转的：查 `hasRef()` 时 unref 的定时器**不在** `_getActiveHandles()` 列表里；「`left` < 视口中线」在居中和贴左下**都成立**；e2e 的 composer-seat mock 缺 `parentElement` 链导致永远走回退分支、钳制与否无区别；直接改 store 快照不触发重渲染。
> 2. **弹窗挪了位置，测试的前提就变了**。弹窗从 `Overlay` 移到独立 slot 后，`ov.render()` 的树里再也找不到它 —— 必须改成从 slot 渲染，并加一条**前置断言**（slot 已注册），否则 slot 缺失时内部抛错被吞、后续断言全返回 null，失败信息误导且掩盖真正原因。
