#!/usr/bin/env node
/**
 * 拆分等价性校验：`src/client/` 拼回来的产物，必须与拆分前的 client.js **逐字节等价**。
 *
 * 这是方案 A 的**唯一正确性依据**。拼接线是纯文本的，任何一处多/少一个空行
 * 都不会报错，只会在浏览器里以"某个函数少了个括号"的面目出现 —— 那时离根因
 * 已经很远了。所以拆完必须立刻用这个脚本证明：产物 == 原件。
 *
 * 比对时忽略 build.mjs 加的两行 banner（它本来就是新增的）。
 *
 * 用法：node verify-split.mjs [基准文件]
 *   默认基准是 client.js.orig-bak（拆分前备份）。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2]
  ? resolve(process.argv[2])
  : join(ROOT, "client.js.orig-bak");
const BUILT = join(ROOT, "client.js");

if (!existsSync(BASE)) {
  console.error(`✗ 找不到基准文件：${BASE}`);
  process.exit(1);
}
if (!existsSync(BUILT)) {
  console.error(`✗ 找不到 ${BUILT}，先运行 node build.mjs`);
  process.exit(1);
}

/** 去掉 build.mjs 生成的 banner 与首尾空白，只比内容。 */
function normalize(text) {
  return text
    .split("\n")
    .filter((l) => !/^\/\* 此文件由 build\.mjs 从 src\/client\/ 生成，请勿直接编辑。 \*\/$/.test(l))
    .filter((l) => !/^\/\* 修改源码后运行：npm run build（校验用 npm run build:check） \*\/$/.test(l))
    .join("\n")
    .replace(/\s+$/, "");
}

const baseText = normalize(readFileSync(BASE, "utf8"));
const builtText = normalize(readFileSync(BUILT, "utf8"));

if (baseText === builtText) {
  const n = builtText.split("\n").length;
  console.log(`✓ 拆分等价：产物与原件逐字节一致（${n} 行）`);
  process.exit(0);
}

// 不等价：指出首个差异，并给出上下文
const a = baseText.split("\n");
const b = builtText.split("\n");
console.error("✗ 拆分产物与原件不一致");
console.error(`  原件 ${a.length} 行 / 产物 ${b.length} 行`);
const max = Math.max(a.length, b.length);
let shown = 0;
for (let i = 0; i < max && shown < 3; i++) {
  if (a[i] !== b[i]) {
    console.error(`\n  差异 #${shown + 1} 在第 ${i + 1} 行：`);
    console.error(`    原件: ${JSON.stringify(a[i] ?? "<无>")}`);
    console.error(`    产物: ${JSON.stringify(b[i] ?? "<无>")}`);
    // 上下文
    for (let k = Math.max(0, i - 2); k <= Math.min(max - 1, i + 2); k++) {
      const tag = k === i ? ">>" : "  ";
      console.error(`    ${tag} ${String(k + 1).padStart(5)} | 原件 ${JSON.stringify((a[k] ?? "").slice(0, 90))}`);
      console.error(`    ${tag} ${String(k + 1).padStart(5)} | 产物 ${JSON.stringify((b[k] ?? "").slice(0, 90))}`);
    }
    shown++;
    // 跳过一小段，避免同一处差异刷屏
    i += 3;
  }
}
process.exit(1);
