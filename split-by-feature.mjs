#!/usr/bin/env node
/**
 * 一次性迁移工具：把 client.js.orig-bak 按**功能**切成 src/client/ 下的片段。
 *
 * 粒度原则：一个文件 = 一个能一句话说清的职责领域（14 个）。
 * 再细就会碎到「改个功能要跳 5 个文件」，再粗就回到单文件难读。
 *
 * 正确性由 verify-split.mjs 逐字节比对保证 —— 任何错切都会立刻暴露。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "client.js.orig-bak");
const OUT = join(ROOT, "src", "client");

if (!existsSync(SRC)) {
  console.error(`✗ 找不到拆分基准：${SRC}`);
  process.exit(1);
}

const all = readFileSync(SRC, "utf8").split("\n");
let n = all.length;
while (n > 0 && all[n - 1] === "") n--;
const lines = all.slice(0, n);

/**
 * 切片表。行号基于拆分前的 client.js（1 起），切点都落在顶层语句之间。
 *
 * 顺序即依赖顺序（拼接是纯文本，`const` 不提升），详见 build.mjs 的 ORDER。
 */
const CUTS = [
  // 入口外壳：__ModuleLoader__ + require('react') + 错误边界
  { from: 1, to: 51, file: "boot.js", what: "入口外壳、ErrorBoundary" },
  // 全部 CSS（裸字符串 + 注入 <style>）
  { from: 52, to: 383, file: "styles.js", what: "样式表" },
  // 纯函数与常量：本地存储键、格式化、市场时段、预警类型清洗、指数栏展开判断
  { from: 384, to: 702, file: "core.js", what: "常量 / 格式化 / 市场时段 / 预警模型" },
  // 状态层：全局 store、吐司、右键菜单、配置持久化与多标签页同步
  { from: 703, to: 950, file: "store.js", what: "store / 吐司 / 菜单 / 配置同步" },
  // 网络通道：行情（SSE/轮询）与预警（alert-stream）
  { from: 951, to: 1287, file: "streams.js", what: "行情通道 / 预警通道" },
  // 动作层：初始化、拖拽排序、列表容量、自选/持仓/预警增删改
  { from: 1288, to: 1698, file: "actions.js", what: "初始化 / 拖拽 / 增删改" },
  // 领域计算：成本与盈亏、交易流水重算、清仓判定
  { from: 1699, to: 1931, file: "pnl.js", what: "成本与盈亏 / 交易流水" },
  // 取数组件：悬浮窗入口、搜索框与建议、分时图、K线图
  { from: 1932, to: 2464, file: "charts.js", what: "搜索 / 分时图 / K线图" },
  // UI 基础设施：菜单图标、右键菜单、面板测量、编辑框、提示层
  { from: 2465, to: 2658, file: "parts.js", what: "图标 / 右键菜单 / 提示层" },
  // 列表类视图：大盘、自选（含行情行）、持仓
  { from: 2659, to: 3042, file: "views-list.js", what: "大盘 / 自选 / 持仓" },
  // 配置类视图：交易记录、设置、预警（含加预警对话框）
  { from: 3043, to: 3473, file: "views-config.js", what: "交易记录 / 设置 / 预警" },
  // 单个标的：预警弹窗、个股详情页、五档盘口
  { from: 3474, to: 3916, file: "detail.js", what: "预警弹窗 / 详情页 / 五档" },
  // 悬浮窗与收益：新鲜度徽标、悬浮窗主体、收益胶囊、标题彩蛋
  { from: 3917, to: 4338, file: "floating.js", what: "悬浮窗 / 收益胶囊 / 标题彩蛋" },
  // 指数栏：dock 与 floating 两种放置、锚定测量
  { from: 4339, to: 4550, file: "index-bar.js", what: "指数栏（dock / floating）" },
  // 插件主体：inject / apply / exports
  { from: 4551, to: n, file: "app.js", what: "inject / apply / exports" },
];

function main() {
  let expect = 1;
  for (const c of CUTS) {
    if (c.from !== expect) {
      console.error(`✗ 切片不连续：${c.file} 从 ${c.from} 开始，但上一片到 ${expect - 1}`);
      process.exit(1);
    }
    expect = c.to + 1;
  }
  if (expect !== lines.length + 1) {
    console.error(`✗ 切片未覆盖末尾：覆盖到 ${expect - 1}，实际 ${lines.length} 行`);
    process.exit(1);
  }
  if (existsSync(OUT)) {
    console.error(`✗ ${OUT} 已存在，先删掉`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  for (const c of CUTS) {
    const text = lines.slice(c.from - 1, c.to).join("\n");
    writeFileSync(join(OUT, c.file), text + "\n");
    console.log(`  ${c.file.padEnd(16)} ${String(c.to - c.from + 1).padStart(4)} 行  ${c.what}`);
  }
  console.log(`\n✓ ${CUTS.length} 个功能块，原文件 ${lines.length} 行`);
}

main();
