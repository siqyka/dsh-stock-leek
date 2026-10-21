import { readFileSync } from "node:fs";
const s = readFileSync("D:\\Software\\DSH\\resources\\app.asar", "utf8");
// _switch_1ik0f_5 的所有相关规则（含状态与子元素）
const re = /[^{}]*_switch_1ik0f_5[^{]{0,120}\{[^}]{0,300}\}/g;
[...s.matchAll(re)].forEach(m => console.log(m[0].replace(/\s+/g," ").trim().slice(0,300) + "\n"));
console.log("=== 该开关的 JSX（找 aria-checked / data-on）===");
const i = s.indexOf("_switch_1ik0f_5");
if (i >= 0) console.log(s.slice(Math.max(0,i-800), i+400).replace(/\s+/g," ").slice(0,1100));
