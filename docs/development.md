# 开发指南

## 跑测试

```bash
npm test                      # 五个套件全跑
node test/shared-drift.mjs    # 纯函数一致性（17 项）
node test/config-path.mjs     # 配置路径与旧路径搬迁（14 项）
node test/test-routes.mjs     # 路由层（49 项：备份/损坏/冲突/pnlCurve/SSE）
node test/security.mjs        # 安全层（19 项：URL 注入 / 配置净化 / SSE 注入）
node test/e2e-render.mjs      # 渲染层（162 项：指数栏/悬浮窗/详情/持仓/成本线/盈亏曲线/拖动排序）
```

零 npm 依赖，直接 `node` 跑。测试会请求腾讯/东财真实行情接口，**需联网**。

## 套件分工

| 套件 | 测什么 | 关键手法 |
|---|---|---|
| `shared-drift.mjs` | `lib/shared.js` ↔ `client.js` 内联副本是否漂移 | 花括号配平抠函数体 → `new Function` 求值 → 逐输入对拍 |
| `config-path.mjs` | 默认路径、迁移链、兼容环境变量 | **子进程 + 假 HOME**（`HOME`/`USERPROFILE` 都改），因为默认路径分支只有不设 `DSH_STOCK_LEEK_CONFIG` 时才走得到 |
| `test-routes.mjs` | Host 路由响应结构 | mock 一个最小 cordis ctx，起本地 http server 逐个请求 |
| `security.mjs` | 四处攻击面回归：URL 拼接 / 配置 POST / XSS / SSE 注入 | 18 组恶意 code 对拍 `normalizeApiCode`；原型污染与超长 body 打 `/config`；断言无 `innerHTML` 等危险 API；端到端验证 SSE 首推恰 1 帧 |
| `e2e-render.mjs` | Client 渲染与交互 | `test/e2e-render.mjs` 内置的 mini-React + 真实路由 |

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

> **别用 `process.env` 给 client.js 加测试开关**。`client.js` 跑在浏览器里，没有 `process`；写 `process.env.X` 会抛 `ReferenceError`，而外层 `try/catch` 会把它吞掉——开关看着"生效"了，其实代码根本没跑到你验证的那条分支。要用 `globalThis.__SOME_FLAG__`。这个坑真的踩过一次。

### 3. mini-React 的手工遍历必须跟 `__rendered`

`test/e2e-render.mjs` 里 `renderTree(node)` 会调用函数组件，组件的渲染产物挂在 `node.__rendered` 上。手工走树时忘了跟这一层就**什么都找不到**：

```js
if (typeof n.type === "function") { walk(n.__rendered); return; }
```

另外两个踩过的坑：

- 正确属性名是 `"data-lftip"`（不是 `data_lftip`）
- 异步加载的 K 线/分时要 `await wait(1800)` 之类，否则断言会在数据到达前就执行

### 4. Windows 下 ESM 的 specifier

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

五个套件全绿才算完成（共 261 项）。若改了 `client.js` 的内联纯函数，记得 `lib/shared.js` 也要同步——`shared-drift` 会拦住你。

改 `index.js` 的 SSE 广播时留意：`sseTick()` 必须在 `finally` 里调 `scheduleSse()` 续排下一轮，漏掉会导致某次拉取失败后广播链静默终止、永不再推（见 [architecture.md](architecture.md) 的「行情通道」）。