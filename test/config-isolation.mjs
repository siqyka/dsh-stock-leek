/**
 * 配置隔离回归测试：node test/config-isolation.mjs
 *
 * 背景（真实事故）：test/security.mjs 曾用静态 import 导入 index.js，
 * 而 ESM 静态 import 会提升到 useTestConfigPath() 之前执行；index.js 当时又在
 * 模块顶层固化 CONFIG_PATH → 守卫设的环境变量来不及生效 → 测试把用户的
 * 真实配置（~/.dsh/dsh-stock-leek/config.json）覆盖成了默认值，持仓数据全丢。
 *
 * 本测试用子进程复现两种导入顺序，验证：
 *   A. 静态 import（错误顺序）→ 守卫必须抛错拒绝运行，绝不静默写坏真实配置
 *   B. 动态 import（正确顺序）→ 生效路径是隔离路径，且真实配置分毫未动
 *   C. 惰性解析：即使先 import 再设 env，路径也跟随 env（纵深防御的第二层）
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const INDEX_URL = new URL("../index.js", import.meta.url).href;

const REAL_CONFIG = join(homedir(), ".dsh", "dsh-stock-leek", "config.json");
// 真实配置存在时才校验"未被改动"；不存在则造一个带标记的假文件来检测
let realExisted = existsSync(REAL_CONFIG);
let realBackup = null;
if (realExisted) {
  realBackup = readFileSync(REAL_CONFIG, "utf8");
} else {
  mkdirSync(dirname(REAL_CONFIG), { recursive: true });
  writeFileSync(REAL_CONFIG, JSON.stringify({ __canary: "do-not-touch" }), "utf8");
}

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
    fails++;
  }
}

function run(script) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env },
  });
}

try {
  console.log("== A. 静态 import（错误顺序）必须被守卫拒绝 ==");
  {
    const out = run(`
      import { useTestConfigPath } from ${JSON.stringify(new URL("./config-guard.mjs", import.meta.url).href)};
      import { apply } from ${JSON.stringify(INDEX_URL)};
      useTestConfigPath("bad-order");
      console.log("REACHED_END");
    `);
    const combined = (out.stdout || "") + (out.stderr || "");
    check("守卫抛错（提到 index.js 在之前被 import）", /index\.js 在 useTestConfigPath/.test(combined), combined.slice(0, 200));
    check("没有继续执行到末尾", !/REACHED_END/.test(out.stdout || ""), out.stdout);
  }

  console.log("\n== B. 动态 import（正确顺序）→ 隔离路径生效，真实配置未动 ==");
  {
    const tmp = mkdtempSync(join(tmpdir(), "sl-iso-"));
    const out = run(`
      const { useTestConfigPath, verifyConfigPathIsolation } = await import(${JSON.stringify(new URL("./config-guard.mjs", import.meta.url).href)});
      useTestConfigPath("good-order");
      const { apply, getConfigPathForTest } = await import(${JSON.stringify(INDEX_URL)});
      await verifyConfigPathIsolation();
      const routes = new Map();
      apply({ effect: (fn) => fn(), webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {}; } } });
      // 写一次配置，确认落在隔离路径
      const http = await import("node:http");
      const server = http.createServer((req, res) => { const h = routes.get(new URL(req.url, "http://x").pathname); h ? h(req, res) : (res.writeHead(404), res.end("{}")); });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      await fetch("http://127.0.0.1:" + port + "/dsh-stock-leek/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: { pollMs: 12345 } }) });
      server.close();
      // 退出前把隔离文件内容打出来（config-guard 会在进程退出时删掉临时文件）
      const { readFileSync } = await import("node:fs");
      let written = null;
      try { written = JSON.parse(readFileSync(process.env.DSH_STOCK_LEEK_CONFIG, "utf8")); } catch (e) { written = { __err: String(e && e.message) }; }
      console.log(JSON.stringify({ effective: getConfigPathForTest(), want: process.env.DSH_STOCK_LEEK_CONFIG, written }));
    `);
    let j = null;
    try { j = JSON.parse((out.stdout || "").trim().split("\n").pop()); } catch { /* ignore */ }
    check("生效路径 = 隔离路径", !!j && j.effective === j.want, { j, stderr: (out.stderr || "").slice(0, 200) });
    check("隔离文件真的被写了", !!j && j.written && j.written.pollMs === 12345, j && j.written);
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n== C. 惰性解析：先 import 再改 env，路径跟随 env ==");
  {
    const tmp = mkdtempSync(join(tmpdir(), "sl-lazy-"));
    const lazyPath = join(tmp, "lazy.json");
    const out = run(`
      const mod = await import(${JSON.stringify(INDEX_URL)});
      const before = mod.getConfigPathForTest();
      process.env.DSH_STOCK_LEEK_CONFIG = ${JSON.stringify(lazyPath)};
      mod.__resetConfigPathCache();
      const after = mod.getConfigPathForTest();
      console.log(JSON.stringify({ before, after, want: ${JSON.stringify(lazyPath)} }));
    `);
    let j = null;
    try { j = JSON.parse((out.stdout || "").trim().split("\n").pop()); } catch { /* ignore */ }
    check("改 env + 清缓存后路径立即跟随", !!j && j.after === j.want, j);
    check("改之前用的是默认路径（真实目录）", !!j && j.before === REAL_CONFIG, j && j.before);
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("\n== D. 真实配置在整个测试过程中分毫未动 ==");
  {
    const now = readFileSync(REAL_CONFIG, "utf8");
    check("真实配置内容与进入测试前完全一致", now === realBackup, { changed: now.slice(0, 80) });
  }
} finally {
  // 恢复现场：我们造的假文件删掉；真实存在的文件绝不动
  if (!realExisted) {
    try { rmSync(REAL_CONFIG, { force: true }); } catch { /* ignore */ }
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
