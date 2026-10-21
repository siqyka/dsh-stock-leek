#!/usr/bin/env node
/**
 * 构建：把 src/client/ 下的片段按文件名顺序拼回单文件 client.js。
 *
 * ## 为什么需要这个脚本
 *
 * DSH 的客户端加载器（宿主 `exactPackageSpecifier`）规定：factory 内的 `require`
 * **只接受无 `/` 无 `:` 的裸包名**（作用域包必须正好 `@scope/name` 两段）。
 * 于是 `require("./charts.js")`、`require("@shiqyka/dsh-stock-leek/charts")`
 * 全部会被拒 —— client 半体**不能拆成多个文件互相 require**，产物必须是单文件。
 *
 * 但"产物是单文件"不等于"源码必须是单文件"：本脚本在构建期把多个源片段
 * 按序拼接，产出与手写等价的单文件。平台限制因此完全不触发。
 *
 * ## 拼接规则（务必遵守，否则产物会静默错误）
 *
 * - 文件名前缀数字决定顺序（`00-` < `10-` < `90-`），同序按名字典序。
 * - 每个片段是**纯文本片段**，不是独立模块：不写 `require` / `export`，
 *   直接写处在同一作用域里的语句（函数、常量），就像它们本来就在一个文件里。
 * - 片段之间共享 `factory` 作用域，所以后面的片段可以直接用前面的常量/函数。
 * - 唯一例外是 `00-boot.js`：它含文件头注释、`__ModuleLoader__.load({`、
 *   `factory` 开头与 `require('react')`；`99-tail.js` 是收尾（exports + 闭合）。
 *
 * ## 用法
 *
 *   node build.mjs            生成 client.js
 *   node build.mjs --check    只校验（产物与源码一致？退出码非 0 表示不一致）
 *
 * `--check` 供 `npm test` 与 CI 用：改了 src 忘了 build 会直接失败，
 * 而不是等到浏览器里才暴露。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(ROOT, "src", "client");
const OUT_FILE = join(ROOT, "client.js");

/** 生成 banner：提醒这是生成物，不要直接改。 */
const GENERATED_NOTE = `/* 此文件由 build.mjs 从 src/client/ 生成，请勿直接编辑。 */
/* 修改源码后运行：npm run build（校验用 npm run build:check） */
`;

/**
 * 片段加载顺序（**唯一权威**）。
 *
 * 文件名只描述功能、不带序号，顺序完全由这张表决定。改顺序 = 改这里。
 * 为什么必须有这张表：拼接是**纯文本**的，所有片段共享同一个 factory 作用域，
 * 函数声明会提升但 `const`/`let` 不会 —— 所以「先定义后使用」只能靠顺序保证，
 * 不能让文件系统按字典序猜。
 *
 * 分组顺序：外壳 → core 纯函数 → 状态与网络 → 领域动作 → 组件 → 视图 → 插件主体。
 */
const ORDER = [
  "boot.js",        // 入口外壳、ErrorBoundary
  "styles.js",      // 样式表
  "core.js",        // 常量 / 格式化 / 市场时段 / 预警模型
  "store.js",       // store / 吐司 / 菜单 / 配置同步
  "streams.js",     // 行情通道 / 预警通道
  "actions.js",     // 初始化 / 拖拽 / 增删改
  "pnl.js",         // 成本与盈亏 / 交易流水
  "charts.js",      // 搜索 / 分时图 / K线图
  "parts.js",       // 图标 / 右键菜单 / 提示层
  "views-list.js",  // 大盘 / 自选 / 持仓
  "views-config.js",// 交易记录 / 设置 / 预警
  "detail.js",      // 预警弹窗 / 详情页 / 五档
  "floating.js",    // 悬浮窗 / 收益胶囊 / 标题彩蛋
  "index-bar.js",   // 指数栏（dock / floating）
  "plugin-page.js", // 插件详情页的指数栏开关（兜底入口）
  "app.js",         // inject / apply / exports
];

/**
 * 按 ORDER 读出所有片段，并双向校验：
 * - ORDER 里列的文件必须都存在
 * - 目录里不能有 ORDER 没列的文件（防止新增片段忘了登记、静默没进产物）
 */
function collectParts() {
  if (!existsSync(SRC_DIR)) {
    console.error(`✗ 找不到源码目录：${SRC_DIR}`);
    process.exit(1);
  }
  const onDisk = readdirSync(SRC_DIR).filter((f) => f.endsWith(".js"));

  const missing = ORDER.filter((f) => onDisk.indexOf(f) < 0);
  if (missing.length > 0) {
    console.error("✗ ORDER 里列了但文件不存在：");
    for (const f of missing) console.error(`    ${f}`);
    process.exit(1);
  }
  const unlisted = onDisk.filter((f) => ORDER.indexOf(f) < 0);
  if (unlisted.length > 0) {
    console.error("✗ src/client/ 里有文件没登记进 build.mjs 的 ORDER：");
    for (const f of unlisted) console.error(`    ${f}`);
    console.error("  （新增片段必须在 ORDER 里指定位置，否则不会被打进产物）");
    process.exit(1);
  }

  return ORDER.map((f) => ({ name: f, text: readFileSync(join(SRC_DIR, f), "utf8") }));
}

/** 拼出完整的 client.js 文本。 */
function render() {
  const parts = collectParts();
  // 片段之间**不做任何裁剪或补空行**：每个片段原样保留它在那段行区间里的
  // 全部内容（包括开头/结尾的空行——空行本身是有意义的排版，吃了会让
  // 后续整体错位）。verify-split.mjs 会逐字节比对，任何自作聪明都会被抓到。
  const body = parts.map((p) => p.text).join("");
  return GENERATED_NOTE + body;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const want = render();

  if (checkOnly) {
    if (!existsSync(OUT_FILE)) {
      console.error("✗ client.js 不存在，请先运行 npm run build");
      process.exit(1);
    }
    const have = readFileSync(OUT_FILE, "utf8");
    if (have !== want) {
      const hLines = have.split("\n").length;
      const wLines = want.split("\n").length;
      console.error("✗ client.js 与 src/client/ 不一致（改了源码忘了 build？）");
      console.error(`  现有 ${hLines} 行 / 应为 ${wLines} 行`);
      // 指出第一处差异，便于定位
      const hArr = have.split("\n");
      const wArr = want.split("\n");
      for (let i = 0; i < Math.max(hArr.length, wArr.length); i++) {
        if (hArr[i] !== wArr[i]) {
          console.error(`  首个差异在第 ${i + 1} 行：`);
          console.error(`    现有: ${JSON.stringify((hArr[i] ?? "").slice(0, 120))}`);
          console.error(`    应为: ${JSON.stringify((wArr[i] ?? "").slice(0, 120))}`);
          break;
        }
      }
      process.exit(1);
    }
    console.log(`✓ client.js 与源码一致（${want.split("\n").length - 1} 行）`);
    return;
  }

  writeFileSync(OUT_FILE, want);
  const n = want.split("\n").length - 1;
  console.log(`✓ 已生成 client.js（${n} 行，来自 ${collectParts().length} 个片段）`);
}

main();
