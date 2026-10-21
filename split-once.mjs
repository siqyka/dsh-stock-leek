#!/usr/bin/env node
/**
 * 一次性拆分脚本：把现有 client.js 按已勘定的边界切成 src/client/*.js 片段。
 *
 * 这是**迁移工具**，跑一次就够（拆完可以删掉，或留作参考）。
 * 目标：切出来的片段经 build.mjs 拼回去后，与原始 client.js **逐字节等价**
 * （除 build.mjs 加的两行 banner）。等价性由 verify-split.mjs 校验。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
// ⚠️ 必须读**拆分前的备份**，不能读 client.js ——
// client.js 一旦被 build.mjs 生成过就是"产物"了，再拿它当输入会越拆越乱
// （第一次就跑成了 4579 行，把生成物的 banner 和错位一起切进去）。
const SRC = join(ROOT, "client.js.orig-bak");
const OUT = join(ROOT, "src", "client");

if (!existsSync(SRC)) {
  console.error(`✗ 找不到拆分基准：${SRC}`);
  console.error("  它应该是拆分前的 client.js 备份。若已丢失，用 git 取回：");
  console.error("    git show main:client.js > client.js.orig-bak");
  process.exit(1);
}

const lines = readFileSync(SRC, "utf8").split("\n");
// 去掉末尾可能的空行，避免行号偏移
while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

/**
 * 切片表：[起始行, 结束行(含), 文件名]
 * 行号从 1 开始，基于拆分前的 client.js。
 *
 * 切点都选在**顶层语句之间**（4 空格缩进的 function/const/let 开头之前），
 * 绝不切进函数体中间。
 */
const CUTS = [
  // 文件头 + __ModuleLoader__.load + factory 开头 + require('react') + h
  [1, 51, "00-boot.js"],
  // CSS 样式表（329 行裸字符串）+ 注入 style 标签
  [52, 383, "10-css.js"],
  // 常量、本地存储键搬迁、格式化工具、市场时段判定
  [384, 555, "20-format.js"],
  // 预警类型定义与清洗
  [556, 635, "25-alert-model.js"],
  // 指数栏展开/收起、状态管理（store）
  [636, 821, "30-store.js"],
  // 配置持久化、多标签页同步
  [822, 950, "35-config.js"],
  // 行情通道（SSE / 轮询）
  [951, 1074, "40-stream.js"],
  // 预警通知、弹窗、alert-stream
  [1075, 1287, "45-alerts.js"],
  // 初始化、拖拽排序、列表容量
  [1288, 1512, "50-ui-utils.js"],
  // 自选/持仓/预警的增删改
  [1513, 1698, "55-crud.js"],
  // 成本与盈亏（todayPnl / costBasis / replay / txn）
  [1699, 1931, "60-pnl.js"],
  // 悬浮窗开关与搜索
  [1932, 2131, "65-search.js"],
  // 图表：分时 / 盈亏曲线 / K线
  [2132, 2464, "70-charts.js"],
  // 菜单图标、右键菜单、面板测量、编辑框、提示层
  [2465, 2658, "75-overlay-parts.js"],
  // 各视图：大盘 / 自选 / 行情行 / 持仓
  [2659, 3042, "80-views-market.js"],
  // 交易记录面板与二级页
  [3043, 3137, "82-views-txn.js"],
  // 设置页 / 预警页 / 添加预警对话框
  [3138, 3526, "84-views-settings.js"],
  // 对话区测量、预警弹窗
  [3527, 3634, "86-alert-popup.js"],
  // 详情页 + 五档盘口
  [3635, 3916, "88-detail.js"],
  // 新鲜度徽标、悬浮窗主体
  [3917, 4102, "90-overlay.js"],
  // 收益胶囊、盈亏计算、标题彩蛋
  [4103, 4338, "92-earnings.js"],
  // 指数栏（dock + floating）与测量
  [4339, 4550, "94-bar.js"],
  // 插件主体：inject / apply / exports
  [4551, lines.length, "99-tail.js"],
];

function main() {
  // 校验切片表是否完整覆盖、无重叠
  let expect = 1;
  for (const [from, to, name] of CUTS) {
    if (from !== expect) {
      console.error(`✗ 切片不连续：${name} 从 ${from} 开始，但上一片到 ${expect - 1}`);
      process.exit(1);
    }
    if (to < from) {
      console.error(`✗ 切片 ${name} 起止颠倒：${from}..${to}`);
      process.exit(1);
    }
    expect = to + 1;
  }
  if (expect !== lines.length + 1) {
    console.error(`✗ 切片未覆盖末尾：覆盖到 ${expect - 1}，实际共 ${lines.length} 行`);
    process.exit(1);
  }

  if (existsSync(OUT)) {
    console.error(`✗ 目标目录已存在：${OUT}（先删掉再跑，避免混入旧片段）`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  for (const [from, to, name] of CUTS) {
    // 原样保留切片内容 + 一个换行（行与行之间的分隔符）。
    // 不能在末尾额外补空行，否则拼回去会比原件多；verify-split 会因此失败。
    const text = lines.slice(from - 1, to).join("\n");
    writeFileSync(join(OUT, name), text + "\n");
    console.log(`  ${name.padEnd(24)} ${String(to - from + 1).padStart(4)} 行  (L${from}..L${to})`);
  }

  const total = lines.length;
  console.log(`\n✓ 已拆成 ${CUTS.length} 个片段，原文件共 ${total} 行`);
  console.log("  下一步：node build.mjs && node verify-split.mjs");
}

main();
