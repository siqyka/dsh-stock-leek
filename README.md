<h1 align="center">dsh-stock-leek 📈</h1>
<p align="center">
  <img src="https://img.shields.io/badge/DSH-plugin-4cc2ff?style=flat-square" alt="dsh plugin">
  <img src="https://img.shields.io/badge/data-tencent-f5455c?style=flat-square" alt="tencent data">
  <img src="https://img.shields.io/badge/license-MIT-1eb980?style=flat-square" alt="MIT">
</p>

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 端的股票行情插件：

- **对话左下角常驻大盘指数栏**（上证 / 深证 / 创业板 / 恒生 / 纳斯达克…，自选要显示哪几个）
- **可拖动行情悬浮窗**：大盘 · 自选 · 持仓 · 设置 四页 + 个股分时 / K 线详情
- **自选股**：搜索（代码 / 名称 / 拼音首字母）添加，A 股 · 北交所 · 港股 · 美股 · ETF · 指数全覆盖
- **持仓股**：填成本价 + 股数，并可逐笔记录**买卖变动**（买入 / 卖出，支持当日多次），实时算市值 / 累计盈亏 / **今日盈亏（按当日变动现金流计算）** / 总盈亏汇总

数据源为腾讯财经公开行情接口（`qt.gtimg.cn` / `web.ifzq.gtimg.cn` / `smartbox`），红涨绿跌。

## 安装

```bash
# 本地目录（把 <path> 换成你自己 clone 的位置）
dsh plugin --profile desktop add file:<path>/dsh-stock-leek
# 或发布后按包名
dsh plugin add dsh-stock-leek
```

安装后**刷新页面**生效。对话输入框下方出现指数栏，点任意指数胶囊打开悬浮窗，点 `⚙` 直达设置。

## 功能

| 位置 | 能力 |
|---|---|
| 对话左下角 | 大盘指数胶囊：简称 + 点位 + 涨跌幅，价格变动红/绿闪烁；盘中状态点；点胶囊开悬浮窗、`⚙` 直达设置。有持仓时显示 **💰收益** 胶囊（今日盈亏），**鼠标悬停弹出浮层**：市值 / 累计收益（额+率）/ 今日收益（额+当日涨幅%）+ 每只持仓的**今日盈亏与当日涨幅**（累计、成本、市值等明细在行悬浮提示）。样式（点位+涨跌 / 仅涨跌）、对齐（左/中/右）、显隐均可配。**放置方式二选一**：① 悬浮锚定（默认）——自动跟随对话输入区左下角、可拖动，新会话页与已有对话都显示；② 嵌入输入框——作为平台 `conversation.composer.dock` 槽位内容，仅「已有对话」显示（新会话页该槽位宿主按平台源码不渲染，属平台限制） |
| 悬浮窗·大盘 | 候选指数列表：**按住行首 ⠿ 左键拖动排序**（实时落点指示线），勾选是否显示到左下角、删除、搜索添加新指数（含港/美/北指数） |
| 悬浮窗·标题 | **彩蛋**：标题随今日盈亏「变脸」——无持仓/持平 → 📈 观望中 · 盈利 → 🍗 加鸡腿（≥3% 🚀 起飞了）· 亏损 → 🍜 关灯吃面（≤−3% 🧘 天台吹风）。鼠标悬停标题可查看今日实际盈亏额 |
| 悬浮窗·自选 | 实时列表（现价 / 涨跌幅 / 成交额，价格变动闪烁），**⠿ 拖动排序**，点击进详情，搜索添加，删除 |
| 悬浮窗·持仓 | 每只填 **成本价 + 股数**（**⠿ 拖动排序**），点 **⇅** 展开**变动记录**：逐笔记买入/卖出（价格+股数+日期，当日可多笔，卖出自动减持仓）；实时显示现价/涨跌、**累计盈亏（额+率）**、**今日盈亏**；顶部汇总市值 / 今日 / 累计，**下方可展开「今日盈亏走势」曲线**（把每只持仓的今日盈亏按分钟展开，零轴=不赚不亏，能看出今天几点开始赚/亏；**收起/展开状态记在配置里**，切标签页、切股票、重启浏览器都保持）。**今日收益按当日买卖现金流计算**：`当前持仓×现价 + 今日卖出额 − 今日买入额 − 昨日持仓×昨收`（无当日变动时退化为 `(现价−昨收)×股数`） |
| 悬浮窗·详情 | 分时折线（昨收基准线）/ 日K·周K·月K 蜡烛（MA5/10/20/60 可切，**左上角显示对应 MA 数值并跟随选中 K 线变化**；**MA 选择存于全局配置，跨股票/周期/会话保持**（host 回填配置时若丢失该字段会保留本地值，避免选择弹回默认），MA5 用主题色随昼夜切换）/ 关键指标；**持仓股额外画出成本线**（虚线 + 右侧「成本 x」标签，跌破成本转红，成本价会被纳入价格范围因此远在区间外也可见，详情头部同步显示成本徽标）/ **K 线支持滚轮缩放 + 拖动平移 + 底栏复位**（以鼠标位置为锚点，底部显示可视区间与根数，换股票/周期自动复位）；**悬浮预览、点击钉住单根 K 线**（带十字光标与右侧价格标签），**顶部指标区随之切换**：选中时显示该根的日期/开高低收/涨跌/量/振幅，不选中则显示当日行情；双击图表或点空白处取消钉住；**钉住后可用 ← / → 逐根切换**（到数据边界不越界，切出可视窗口时图表自动跟随，输入框内不抢按键） |
| 悬浮窗·设置 | 指数栏显隐/样式/位置、刷新间隔（3~60s）、涨跌配色、**测试数据源**、恢复默认；**配置损坏告警常驻条**（见「配置安全」） |

## 配置

配置以 **Host 文件为准**（`~/.dsh/dsh-stock-leek/config.json`），浏览器 `localStorage` 仅作首屏缓存。写入前自动备份 `.bak`；解析失败时保留 `.corrupt` 现场并回退备份，**不会静默吞掉持仓**；多标签页通过 `BroadcastChannel` 同步并用版本号检测冲突。

字段清单、旧路径搬迁、持仓数据结构、代码归一化规则 → **[docs/configuration.md](docs/configuration.md)**

## 文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 全局架构、目录职责、SSE 行情通道、`client.js` 为何无法 import 共享模块、盈亏口径 |
| [docs/configuration.md](docs/configuration.md) | 配置字段表、持仓结构、配置安全机制、代码归一化 |
| [docs/development.md](docs/development.md) | 跑测试、套件分工、写测试的硬规矩、加配置字段的检查清单 |

## 架构

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

## 目录

```
dsh-stock-leek/
├── index.js          # Host：webServer 路由 + 腾讯行情解析 + 配置持久化 + SSE 推送
├── client.js         # Client：__ModuleLoader__，左下角指数栏 + 悬浮窗
├── cordis.patch.yml  # bundle patch（插入 host 插件行）
├── package.json      # dsh.bundle + dsh.client 声明
├── lib/              # 可复用代码
│   └── shared.js     #   纯函数：格式化 + 盈亏口径（Host/测试共用）
├── docs/             # 详细文档
│   ├── architecture.md
│   ├── configuration.md
│   └── development.md
├── test/             # 集成测试（零外部依赖，直接跑）
│   ├── config-guard.mjs    # 测试配置路径隔离守卫（共用）
│   ├── shared-drift.mjs    # shared.js ↔ client.js 纯函数对拍
│   ├── config-path.mjs     # 默认配置路径 + 旧路径搬迁（子进程 + 假 HOME）
│   ├── test-routes.mjs     # Host 路由层
│   └── e2e-render.mjs      # Client 渲染层（mini-React + 真实路由）
└── README.md
```

> `index.js` 与 `client.js` 刻意留在根目录：`package.json` 的 `exports` 与 `dsh.client` 声明按路径引用它们，DSH 打包依赖这个约定。
>
> `lib/shared.js` 在 `client.js` 里有一份内联副本——平台限制导致 client 侧无法 import 共享模块，由 `test/shared-drift.mjs` 对拍防漂移，详见 [docs/architecture.md](docs/architecture.md)。

## 测试

```bash
npm test                      # 四个套件全跑
node test/shared-drift.mjs    # 纯函数一致性（17 项）
node test/config-path.mjs     # 配置路径与旧路径搬迁（11 项）
node test/test-routes.mjs     # 路由层（50 项：备份/损坏/冲突/pnlCurve/SSE）
node test/e2e-render.mjs      # 渲染层（148 项：指数栏/悬浮窗/详情/持仓/成本线/盈亏曲线/拖动排序）
```

四个测试都用 `node` 直接跑，零 npm 依赖。配置路径由 `config-guard` 强制隔离（默认写系统临时目录并自动清理；指向真实配置会拒绝启动）。测试会请求腾讯/东财真实行情接口，需联网。详见 [docs/development.md](docs/development.md)。

## 说明

- 仅只读行情 + 本地配置，不接任何交易/账户，不构成投资建议。
- 分时接口对部分市场（如美股指数）可能无分钟点，会提示"该市场不支持分时"，K 线仍可用。
- 休市时段行情为最近一次收盘快照，`⏱` 与更新时间如实反映。

## License

MIT
