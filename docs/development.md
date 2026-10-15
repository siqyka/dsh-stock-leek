# 开发指南

## 跑测试

```bash
npm test                      # 六个套件全跑
node test/shared-drift.mjs    # 纯函数一致性 + 关键函数性质对拍
node test/config-isolation.mjs# 配置路径隔离守卫自检
node test/config-path.mjs     # 配置路径与旧路径搬迁
node test/test-routes.mjs     # 路由层（备份/损坏/冲突/pnlCurve/SSE）
node test/security.mjs        # 安全层（URL 注入 / 配置净化 / SSE 注入）
node test/e2e-render.mjs      # 渲染层（指数栏/悬浮窗/详情/持仓/成本线/盈亏曲线/时段收展/拖动排序）
```

零 npm 依赖，直接 `node` 跑。测试会请求腾讯/东财真实行情接口，**需联网**。

## 套件分工

| 套件 | 测什么 | 关键手法 |
|---|---|---|
| `shared-drift.mjs` | `lib/shared.js` ↔ `client.js` 内联副本是否漂移 | 花括号配平抠函数体 → `new Function` 求值 → 逐输入对拍 |
| `config-isolation.mjs` | 守卫自身是否真的拦得住（防止守卫失效后误伤用户配置） | 故意指向真实配置路径，确认**拒绝启动**；确认临时目录被清理 |
| `config-path.mjs` | 默认路径、迁移链、兼容环境变量 | **子进程 + 假 HOME**（`HOME`/`USERPROFILE` 都改），因为默认路径分支只有不设 `DSH_STOCK_LEEK_CONFIG` 时才走得到 |
| `test-routes.mjs` | Host 路由响应结构 | mock 一个最小 cordis ctx，起本地 http server 逐个请求 |
| `security.mjs` | 四处攻击面回归：URL 拼接 / 配置 POST / XSS / SSE 注入 | 18 组恶意 code 对拍 `normalizeApiCode`；原型污染与超长 body 打 `/config`；断言无 `innerHTML` 等危险 API；端到端验证 SSE 首推恰 1 帧 |
| `e2e-render.mjs` | Client 渲染与交互 | `test/e2e-render.mjs` 内置的 mini-React + 真实路由；预警部分用 `__alertTickForTest` 真写账本、`__docDispatch` 真派发 visibilitychange、EventSource 替身验证生命周期 |

## 写测试的几条硬规矩

### 1. 不许碰用户真实配置

`config-guard.mjs` 强制隔离：默认写系统临时目录并在退出时清理；若 `DSH_STOCK_LEEK_CONFIG` 指向真实配置路径则**拒绝启动**（除非显式 `SL_ALLOW_REAL_CONFIG=1`）。守卫认识**改名前后的全部三代默认路径**——那些文件同样装着用户的真实持仓。

### 2. 断言不许空转

新增断言后**必须验证它在功能被破坏时会失败**。做法是临时改坏实现、确认目标断言变红、然后改回来。

已经这么验证过的例子：

| 断言 | 改坏后 |
|---|---|
| `切换标签页后仍保持收起`（盈亏曲线状态持久化） | 把配置态改回 `useState` → 3 项失败 |
| `host 回填丢 ma 时不弹回默认` | 删掉兼容合并 → 5 项失败 |
| `fmtSigned 与 shared.js 行为一致` | 改坏 client.js 副本 → 报出 `client:"DRIFTED"` vs `shared:"+1234"` |
| `旧键 lf.* 的值搬到新键`（改名后的本地偏好搬迁） | `SL_NO_LS_MIGRATE=1` 跑一次 → 自检断言改判，验证搬迁确实在工作 |
| `超 10 行时列表加滚动类` / `滚动上限按实测行高算` | 把 `useListCap(...)` 换成 `null` → 2 项失败 |
| `跨过 3s tick 后曲线重新拉分时（跟随设置的刷新间隔）` | 把 `curveKey` 还原成只含 `posKey` → 红；把 `curveRefreshTick` 窗口写死 `60000` → 红 |
| `窗口取自 pollMs 而非固定值` / `pollMs 越细、tick 越密` | `lib/shared.js` 里窗口写死 `60000` → 2 项红 |
| `同一窗口内：不同时间戳映射到同一 tick` | 去掉 `Math.floor(t / win)` 的分桶 → 红 |
| `清仓后今日收益仍非零（已实现部分继续计入）` 等 4 项 | 把 `computeEarnings`/`earningsDetail` 还原成 `if (!q \|\| !qty) continue` → 4 项红 |
| `行情日期跨到下一交易日后，已清仓持仓被自动移除` | 注释掉 `purgeStaleClosedPositions()` 调用 → 2 项红 |
| `isStaleClosedPosition 与 shared.js 行为一致` | `>` 改成 `>=`（当日就删）/ 改用本地日期 → 红 |
| `9:00 起展开（8:59 收起 / 9:00 展开）` / `15:06 仍展开` | `BAR_LEAD_MIN`/`BAR_LAG_MIN` 改回 5/5 → 2 项红 |
| `点●后收起` / `再点●展开` | 点上的 onClick 换成打开大盘页 → 4 项红 |
| `跨交易日后手动态失效` | 去掉 `barForceDay === day` 判断 → 红 |
| `午休 12:00 仍然展开` | 改成逐时段 `windows.some(...)` 匹配 → 红 |
| `同一分钟内不重复拉分时（避免打爆上游）` | 把 `quoteTick` 改成裸 `s.updatedAt` → 1 项失败 |
| `curveRefreshTick 与 shared.js 行为一致` | 只改 client.js 一侧的窗口（`5000`→`30000`）→ 报出 client/shared 取值不同 |

> **对拍只能证明"两边一样"，证明不了"两边都对"**。`curveRefreshTick` 的两端对拍在「窗口被写死 60s」时照样全绿，因为两边一起错。所以另加了一组**性质断言**（同一窗口内 tick 相同、跨窗口推进、窗口随 pollMs 变），直接钉住它应满足的语义。对拍器还必须喂足参数：只喂单参的话 `pollMs` 全是 `undefined` → 永远走兜底 5s，原始 bug 测不出来。多参函数的样本要成对给；对拍器靠 `clientFn.length` 区分（单参函数的数组入参不能误拆——`displayCode("sh600519")` 拆开就成两个字符了）。

> **计数型断言会受后台轮询干扰，别硬凑**。原本想断言"同一 tick 内刷新不该重拉 /minute"，结果它隔几次就红一次：之前发起、还在途的 `/quotes` 会带着真实时间戳落地，正好落进采样窗口就凭空改了 tick。静置、加 drain 都不根治——**这条最后删了**，因为它没有验证价值：真正守节流的是 shared-drift 里那组性质断言（纯函数、确定性）。真退回"不节流"，实际影响也有限——`/minute` 在 host 侧有 5s 缓存，客户端就算每 3s 打一次，上游也最多 5s 才被打一次。

> **测试用例会改全局配置，必须复位**。为了区分 3s 与 60s，断言里把 `pollMs` 改成了 3000。不复位的话同一条测试连跑两次，第二次起点已经是 3s，**顺序依赖**——单跑绿、连跑红，非常难查。测完用 `restorePoll(pollMsBefore)` 还原。

> **窗口要和 pollMs 对齐，否则测不出 bug**。断言若沿用默认 5s，"跨一个 tick"和"跨一分钟"同时发生，窗口写成 60s 照样通过。必须先把刷新间隔设成 **3s**，再让 pastAt/futureAt 落在**同一分钟内**（锚在该分钟的第 30 秒，往回退 30s）——3s 窗口认为变了、60s 窗口认为没变，这才区分得开。

> **别用 `process.env` 给 client.js 加测试开关**。`client.js` 跑在浏览器里，没有 `process`；写 `process.env.X` 会抛 `ReferenceError`，而外层 `try/catch` 会把它吞掉——开关看着"生效"了，其实代码根本没跑到你验证的那条分支。要用 `globalThis.__SOME_FLAG__`。这个坑真的踩过一次。

> **"渲染没炸"不是有效的断言**。给盈亏曲线写回归时，我先断言了「行情刷新后曲线仍能渲染」——把依赖还原成修复前的样子，这条照样绿，因为它对空渲染也成立。真正的判据必须盯住**依赖是否随行情推进**。同理，「收起→展开会重新拉数据」也测不出这个 bug：`curveOn` 本来就在依赖里，修复前后行为一致。想验证 `curveKey` 里那个 tick，得点 ⟳ 触发一次真实 `refreshQuotes()`，并让 `/quotes` 返回**跨过 tick 边界**的 `updatedAt`——只有这条路径才区分得了修复前后。

> **断言必须打在"被修的那条路径"上**。清仓丢收益这个 bug，我第一版断言读的是**持仓页表头**的「今日/累计」——那条路径历史上本来就对（逐行算，从不跳过 qty=0），所以还原修复后断言照样绿，纯属自欺。真正坏的是 `computeEarnings`（决定胶囊显不显示）和 `earningsDetail`（胶囊 + 悬浮浮层），断言必须从**指数栏悬浮浮层**里读。换断言源后，4 项全部变红。

> **判"下一个交易日"要用行情日期，不能用本地日期**。本地日期是连续的天——周五收盘后清仓，周六打开插件就会删掉它，可周一才是本该删的时候；节假日更长。行情日期天然跳过周末与节假日（休市日停在前一交易日），所以 `purgeStaleClosedPositions` 挂在 `applyQuotes` 之后：只有行情日期前进才可能判定过期。顺带白拿一个好处——盘前时段行情日期还停在前一天，当天清仓的票不会被"提前"清掉。断言里也踩过这个：改 `row.date` 无效，行情日期藏在 **14 位的 `row.time`** 里。

> **"过期/恢复自动"这类断言，必须让两种状态结论相反**。测"手动选择跨交易日失效"时，我先设成「手动展开 + 次日盘中（自动=展开）」——两边都是展开，过期与否观测不到，断言永远绿。改成「**手动收起 + 次日盘中（自动=展开）**」才真正区分得开。**设计断言前先问：如果这行代码写错了，这条断言会红吗？**不会就是废的。

> **测试里伪造的数据要记得拨回来**。为测"跨交易日"把行情日期改成次日之后，后面的清仓用例全炸——`purgeStaleClosedPositions` 判的正是「行情日期 > 最后一笔成交日」，留着次日的假行情，持仓会在卖完的同一刻就被清掉。伪造全局状态的东西，用完必须还原，否则后面每一段都可能是下一个受害者。

> **改 store 快照 ≠ 驱动 UI**。预警角标的第一版断言直接写 `globalThis.__sl_test_state__ = {...alertEvents}`，看着数据进去了，角标却始终不出现——那只是 `setState` 留下的**快照副本**，不是组件读取的模块级 `state`，改了不会触发重渲染。要么走真实交互（点击/输入），要么让客户端自己通过**真实 HTTP** 重新拉一次。判断标准很简单：**断言的驱动路径，和线上那条路径是同一个吗？**

> **有"只跑一次"守卫的初始化，不能靠反复 render 重放**。`initStore` 里有 `inited` 守卫（一页只跑一次），所以"老 Host 吃掉 `alerts` → 本地回填"的断言，无论 render 多少次都不会再走一遍初始合并分支——第一版断言因此完全空转。发现后改走 `persistConfig` 的回包合并：那条分支**每次保存都会跑**，把 `POST /config` 的 mock 回包去掉 `alerts` 字段即可命中。找承重分支时先问：**这段逻辑在生命周期里跑几次？**

> **配对断言才好用**。只断言"无规则时不打上游"是危险的——如果循环压根没工作，它也绿。所以同时断言 `ticks` 在涨（循环确实在跑）；再补一条反向对照：把 `isMarketOpen` 临时钉成 `true`，`fetches` 必须立刻从 0 变 1（实测通过，且此时"休市不打上游"那条如期变红）。**一条断言防不住"功能整体没运行"这种失败模式。**

> **Node 24 的 `global.navigator` 是只读 getter**。为测多标签去重写 `global.navigator.locks = ...`，会抛 `TypeError: Cannot set property navigator`，而且它发生在断言之后——**打印全是 ok、退出码却是 1**。用 `Object.getOwnPropertyDescriptor` 存原描述符、`defineProperty` 覆盖、用完还原。

> **不要给 toggle 加"再点一下退回自动"**。第一版写成三态（自动 → 反向 → 自动），结果从自动出发只能观测到两种状态，"自动"这个静止态永远摸不着，测试直接绕晕。纯 toggle 更好预期：**当前什么就切成什么**，手动选择持续到下一个交易日自动失效。

> **`String(new Date()).slice(0,10)` 不是日期**，是 `"Thu Oct 15"`。要拿 YYYYMMDD 得自己拼 `getFullYear()/getMonth()+1/getDate()`。

> **别让功能"只在真收盘时才成立"**。指数栏改成按时段自动展开/收起后，原来的「指数栏出现收益胶囊」断言就变成了隐雷——白天跑绿，晚上跑必挂。解法是把 client.js 的时段判断抽到 `marketNow()`，测试用 `globalThis.__sl_now__` 钉死时间（e2e 顶部钉在 2026-10-15 周四 14:45 北京），再逐个边界点切换验证 8:59/9:00/15:06/15:07。**时间相关的 UI 逻辑一定要留注入点**，否则测试只在作者写代码的那几分钟成立。

> **"该不该显示"要按整天算，不是按每个时段逐个匹配**。第一版用 `windows.some(([a,b]) => t >= a-5 && t <= b+5)`，看着合理，结果 A 股每天 **11:30–13:00 午休时指数栏消失两个半小时**。改成取整日跨度：`首个开盘 − 缓冲 ~ 最后收盘 + 缓冲`。断言里专门留了一条 12:00 必须展开，把这个坑钉死。

> **按时段变化的状态不能只靠数据推送驱动**。收起/展开原本搭车在每次 `/quotes` 重渲染上——断网或 SSE 一停，收盘后栏就一直挂着昨天的数字。加了 `useClockTick(30000)` 强制重渲染。展开/收起是分钟级的需求，30s 一跳绰绰有余。

> **收起之后要留出路**。非交易时段只剩「点 + ⚙」，指数胶囊和收益胶囊都没了，如果那个点不可点，收起就成了死路。让状态点点击进大盘页。

> **清理只在真有得删时才写配置**。`purgeStaleClosedPositions` 每轮行情都调用（pollMs 可到 3s），但没得删时直接返回、不碰 `updateConfig`。否则每 3 秒一次 POST /config，光是防抖就够呛。

> **破坏性的用例要放最后**。清仓测试一开始放在买/卖用例后面，直接把后面 3 条 hover 浮层断言弄红了（它们依赖"有持仓"）。像"清仓""清空列表"这类会改变全局状态的操作，只能排在末尾。

> **清仓卖出要卖"恰好"持仓数**。`addTxn` 有「卖出超过持仓」拦截，写 99999 会被静默拒绝、`qty` 根本不归零——症状看起来像"修复没生效"，其实是测试没走到。正确做法是从 store 读当前持股数再原样卖出。

> **别让"高频数据"被"低频数据"绑住**。曲线原本把实时价烤进了 `curve` state，于是它只能等 `/minute` 重拉才更新——`/minute` 有 5s 服务端缓存 + 分钟粒度，末端就跟不上刷新间隔。修法是：`curve` state 只存 `/minute` 的**形状**（很少变），实时价由 `PnlCurve` 渲染时从 `quotes` 现取。这样末端每次行情推送都动，而重拉分时仍按 tick 节流。**两个节奏要分开**：数据形状按低频拉，末端价格按高频取。

> **`!qty` 这类"没仓位就跳过"的早退，要先问一句：清仓的钱去哪了**。持仓 qty 归零不代表该股今天的盈亏不存在——卖出所得就是已实现盈亏。汇总层用 `if (!q || !qty) continue` 把它整只抹掉，于是清仓瞬间今日收益凭空少一块、累计盈亏直接归零，用户只能理解成"数据丢了"。持仓页逐行算所以躲过了这一劫，于是同一份数据在两个界面给出两个答案——**口径分裂比单个 bug 更难查**。

> **mini-React 的 effect 执行时机曾与真实 React 不一致**。原来 `useEffect` 的函数体在 `walk` 期间就地执行，早于 `attachRefs` 挂 ref——于是任何「读 `ref.current` 量 DOM」的 effect 都拿到 `null`，而代码在浏览器里是好的，**测试却会把好代码判成坏的**（或反过来掩盖真问题）。真实 React 是 commit 阶段先挂 ref、passive effect 后跑。现在 effect 体排队，等 `attachRefs` 之后再执行。加新断言若涉及 DOM 量测，务必先确认这个顺序对不对。

### 3. mini-React 的手工遍历必须跟 `__rendered`

`test/e2e-render.mjs` 里 `renderTree(node)` 会调用函数组件，组件的渲染产物挂在 `node.__rendered` 上。手工走树时忘了跟这一层就**什么都找不到**：

```js
if (typeof n.type === "function") { walk(n.__rendered); return; }
```

另外两个踩过的坑：

- 正确属性名是 `"data-lftip"`（不是 `data_lftip`）
- 异步加载的 K 线/分时要**等就绪**，否则断言会在数据到达前就执行。但**别用固定 sleep**——见下一节

### 4b. 别用固定 sleep，用 `until()` 轮询

e2e-render 一度要 **25 秒**，其中约 23 秒是 32 处 `await wait(...)` 在睡觉——占 93%。慢的根本不是测试逻辑，而是「不敢赌已经好了，于是每次都把上限睡满」。

两条改法，套件降到 **~14.6s**：

1. **配置落库的 500ms 防抖 → 测试里置 0。** `persistConfig` 的防抖是为了合并连续改动（拖排序等），代价是每次改配置后都有 500ms 不一致窗口，几十条「等落库」的用例各睡 700ms。延迟已抽成 `saveDebounceMs()`，测试用 `globalThis.__SL_SAVE_DEBOUNCE__ = 0` 覆盖。生产仍是 500ms。
2. **网络等待 → `until(条件, 超时)`**，返回即走，不用时轮询 20ms。K 线/分时/搜索都改成「等 `svg` 或 `sl-sug` 真的出现」。

> **`until()` 的判据要挑对**。这里踩过：`/MA5|MA10/.test(text)` 会命中**常驻的切换按钮**，条件立刻成立，可 K 线数据其实还没到——后面的 MA 数值断言直接红。判据得用「MA5 `<数字>`」这种带数值的形状，或者等 `svg` 节点。**判据太松 = 提前返回 = 假绿或后续红。**

> **别用「等 N 次 POST」式的 helper**。曾写过 `waitConfigSave()`：进入函数时读 `configPostCount` 当基线。但防抖置 0 后 POST 几乎同步发出，基线在点击**之后**才取 → 永远等不到下一笔 → 每次白等 3 秒超时。配置落库打的是本机 Host，`await wait(150)` 就够了，别过度设计。

### 4c. Windows 下 ESM 的 specifier

子进程测试里 `import("E:\\path\\index.js")` 会失败——Windows 绝对路径不是合法 ESM specifier，要用 `pathToFileURL(...).href`。

### 5. 编码陷阱

`Get-Content` 的行号和 read 工具对 UTF-8 文件会差十几行。**以 read 工具为准**；行看着对但解析失败时，用 `node -e` 配 `JSON.stringify` 看确切字节。

## 加配置字段的检查清单

`sanitizeConfig` 是白名单重建，新字段漏改任何一环都会静默失效：

1. `index.js` 的 `defaultConfig()` 加默认值
2. `index.js` 的 `sanitizeConfig()` 加类型校验（非法值回落默认，别让它把 UI 卡在错误状态）
3. `client.js` 的「恢复默认」字面量同步加字段
4. 若字段可能被旧版 Host 丢弃，在 `client.js` 的 `persistConfig` 与初始加载处加**本地值保留**（见 `docs/architecture.md`）
5. `test/test-routes.mjs` 补：默认值、可写、可持久化、脏值回落
6. `docs/configuration.md` 的字段表更新

## 改动后必跑

```bash
node --check client.js
node --check index.js
npm test
```

六个套件全绿才算完成。若改了 `client.js` 的内联纯函数，记得 `lib/shared.js` 也要同步——`shared-drift` 会拦住你。

> **文档里刻意不写断言条数。** 断言数随改动频繁增减，写死必然过期（此前已连续三次对不上）。要看当前数量直接跑一遍即可。

改 `index.js` 的 SSE 广播时留意：`sseTick()` 必须在 `finally` 里调 `scheduleSse()` 续排下一轮，漏掉会导致某次拉取失败后广播链静默终止、永不再推（见 [architecture.md](architecture.md) 的「行情通道」）。