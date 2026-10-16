/**
 * 回归测试（子进程）：评估循环的定时器必须**自行触发**，即不能被 unref。
 *   node test/alert-loop-ref.mjs
 *
 * 为什么必须用独立子进程：unref 的定时器在**有其它活动句柄**时照样会触发
 * （主测试进程跑着 http server，根本区分不出来）。只有让子进程在启动循环后
 * **不保留任何其它句柄**，差别才可见：
 *   - 定时器 ref'd   → 进程被它撑着不退出，ticks 持续推进
 *   - 定时器 unref'd → 事件循环无事可做，进程立即退出，ticks 停在 1
 *
 * 守的真实事故：schedule() 里调 timer.unref() → 「配了预警规则却永远不评估，
 * 只有改配置（alertKick）时才跑一次」。实测清空规则使循环进入 60s 退避后，
 * 再添加规则等了 25 秒毫无动静，POST /config 才踢出第一拍。
 *
 * 实现要点：子进程里**不能有任何其它定时器**（哪怕 console 用的采样 interval
 * 都会变成活动句柄，让 unref 的定时器也能触发 → 断言失真）。所以子进程只在
 * 循环每次 tick 后由 Host 自己打印，父进程按输出判断。
 */
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Windows 下 import 必须用 file:// URL（直接用 E:\... 会 ERR_UNSUPPORTED_ESM_URL_SCHEME）
const guardUrl = pathToFileURL(join(here, "config-guard.mjs")).href;
const indexUrl = pathToFileURL(join(root, "index.js")).href;

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    fails++;
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
  }
}

// 子进程：起 Host → 写入一条规则，并把「当前时间」钉死在**盘中**。
//
// 时间必须钉死：循环只有在「某条规则的市场此刻在交易时段」时才按 pollMs 快跑，
// 否则退避 60s——7 秒的观测窗里只能看到首拍，断言必然假红。
// 原先用美股规则赌「北京凌晨美股在盘中」，白天跑就挂（已实测）。
// 现在用 __sl_alert_now__ 注入一个 A 股盘中的时刻，任何钟点跑都成立。
const childSrc = `
import { useTestConfigPath } from ${JSON.stringify(guardUrl)};
useTestConfigPath("loopref");
// 2026-10-15（周四）14:45 北京 = 06:45 UTC —— A 股盘中
globalThis.__sl_alert_now__ = Date.parse("2026-10-15T06:45:00Z");
const mod = await import(${JSON.stringify(indexUrl)});
const cfg = mod.readConfig();
cfg.remind = true;
cfg.alerts = [{ id: "ref1", code: "sh600519", type: "price_above", value: 1, enabled: true, createdAt: Date.now() }];
cfg.pollMs = 2000; // 最快节奏，便于短时间观测多拍
mod.writeConfig(cfg);
mod.apply({ effect: (fn) => { fn(); return () => {}; }, webServer: { register: () => () => {} } });
let last = -1;
const hb = setInterval(() => {
  const s = mod.getAlertStatsForTest();
  if (s.ticks !== last) { last = s.ticks; process.stdout.write("TICKS " + s.ticks + "\\n"); }
}, 300);
hb.unref(); // 关键：心跳不撑事件循环，否则会掩盖被测问题
setTimeout(() => { mod.__stopAlertLoopForTest(); process.exit(0); }, 7000).unref();
`;

const child = spawn(process.execPath, ["--input-type=module", "-e", childSrc], {
  cwd: root,
  env: { ...process.env, DSH_STOCK_LEEK_CONFIG: "" },
});

const out = [];
child.stdout.on("data", (d) => out.push(String(d)));
child.stderr.on("data", (d) => out.push("[err] " + String(d)));

// 父进程兜底：子进程若被 unref 定时器留在挂起态，最多等 8 秒后杀掉
const killer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 8000);
await new Promise((r) => child.on("exit", r));
clearTimeout(killer);

const text = out.join("");
const ticks = [...text.matchAll(/TICKS (\d+)/g)].map((m) => Number(m[1]));
console.log("  子进程 ticks 采样:", JSON.stringify(ticks));
if (text.includes("[err]")) console.log("  子进程 stderr:", text.split("[err]").slice(1).join(" | ").slice(0, 400));

// 判据：循环的 ticks 必须随静置时间推进，且**不是只跑了首拍**。
// 首拍是 void tick() 直接调的（不经过定时器）——只有第 2 拍及以后才证明定时器在工作。
check("循环跑过首拍之外的拍（ticks ≥ 2）", ticks.length > 0 && ticks[ticks.length - 1] >= 2, ticks);
check("ticks 随时间推进（定时器自行触发，未被 unref）",
  ticks.length >= 2 && ticks[ticks.length - 1] > ticks[0], { first: ticks[0], last: ticks[ticks.length - 1] });
check("ticks 单调不减", ticks.every((v, i) => i === 0 || v >= ticks[i - 1]), ticks);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
