/**
 * 配置路径与旧路径搬迁测试：node test/config-path.mjs
 *
 * 为什么单独一个套件：默认路径只有在**不设 DSH_STOCK_LEEK_CONFIG** 时才生效，
 * 而另外两个测试都被 config-guard 强制指向临时目录，永远走不到默认分支。
 * 所以这里用子进程 + 假 HOME 来验证真实的落盘位置与搬迁行为。
 *
 * 插件改过名，落盘位置也改过两次，因此搬迁是一条**链**：
 *   ~/.dsh-leek-fund/config.json  →  ~/.dsh/dsh-leek-fund/config.json  →  ~/.dsh/dsh-stock-leek/config.json
 * 每一步都要保证不丢数据。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const INDEX_URL = pathToFileURL(join(root, "index.js")).href;

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
    fails++;
  }
}

/** 解析子进程 stdout；失败时把 stderr 一并带出来，避免"断言失败但看不到原因" */
function parseOut(out, label) {
  try {
    return JSON.parse(out.stdout || "{}");
  } catch {
    check(label + "（子进程未产出可解析输出）", false, { stdout: out.stdout, stderr: out.stderr, status: out.status });
    return {};
  }
}

/**
 * 在给定 HOME 下跑一次 host：应用插件 → 读一次配置 → 打印落盘路径。
 * 显式清掉 DSH_STOCK_LEEK_CONFIG，确保走默认路径分支。
 */
function runWithHome(home, body) {
  // 注意：Windows 的绝对路径（E:\...）不是合法 ESM specifier，必须用 file:// URL
  const script = `
    import http from "node:http";
    const { apply } = await import(${JSON.stringify(INDEX_URL)});
    const routes = new Map();
    apply({
      effect: (fn) => fn(),
      webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {}; } },
    });
    const server = http.createServer((req, res) => {
      const h = routes.get(new URL(req.url, "http://x").pathname);
      if (h) h(req, res);
      else { res.writeHead(404); res.end(); }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    ${body}
    server.close();
    process.exit(0);
  `;
  const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, HOME: home, USERPROFILE: home, DSH_STOCK_LEEK_CONFIG: "", DSH_LEEK_FUND_CONFIG: "" },
    encoding: "utf8",
    timeout: 60000,
  });
  return { stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim(), status: res.status };
}

/** 读一次 /config 并把 path 打出来 */
const READ_CONFIG = `
  const r = await fetch("http://127.0.0.1:" + port + "/dsh-stock-leek/config?quotes=0");
  const j = await r.json();
  console.log(JSON.stringify({ path: j.path, pollMs: j.config.pollMs }));
`;

const home = mkdtempSync(join(tmpdir(), "sl-home-"));
try {
  console.log("== 配置默认路径 ==");
  const expected = join(home, ".dsh", "dsh-stock-leek", "config.json");

  // 1. 全新安装（无任何历史文件）
  {
    const out = runWithHome(home, READ_CONFIG);
    const j = parseOut(out, "首次安装");
    check("默认落到 ~/.dsh/dsh-stock-leek/config.json", j.path === expected, { got: j.path, want: expected });
    check("首次运行不产生任何文件（尚未写入）", !existsSync(expected), existsSync(expected));
  }

  // 2. 从中间那代旧位置 ~/.dsh/dsh-leek-fund/ 搬迁（最近的一次改名）
  {
    const legacyDir = join(home, ".dsh", "dsh-leek-fund");
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, "config.json");
    writeFileSync(legacyFile, JSON.stringify({ pollMs: 6666, barIndices: ["sh000001"], ma: [5, 60] }), "utf8");

    const out = runWithHome(home, READ_CONFIG);
    const j = parseOut(out, "搬迁中间代旧路径");
    check("中间代旧配置被读到（pollMs 6666）", j.pollMs === 6666, j.pollMs);
    check("搬迁后落在新位置", j.path === expected, j.path);
    check("新位置确实生成了文件", existsSync(expected), existsSync(expected));
    const moved = JSON.parse(readFileSync(expected, "utf8"));
    check("搬迁内容完整（含 ma）", moved.pollMs === 6666 && JSON.stringify(moved.ma) === "[5,60]", moved.ma);
    check("旧文件保留为 .migrated.bak 而非删除", existsSync(legacyFile + ".migrated.bak"), false);
    check("旧文件本体仍在（不擅自删除）", existsSync(legacyFile), false);

    // 3. 新位置已有文件时，不再被旧文件覆盖
    writeFileSync(expected, JSON.stringify({ pollMs: 8888 }), "utf8");
    const out2 = runWithHome(home, READ_CONFIG);
    const j2 = parseOut(out2, "新位置优先");
    check("新位置已有配置时不被旧文件覆盖", j2.pollMs === 8888, j2.pollMs);
  }

  // 4. 只有最早那代旧位置 ~/.dsh-leek-fund/ 存在时，也能搬过来
  {
    const older = mkdtempSync(join(tmpdir(), "sl-home-old-"));
    const legacyDir = join(older, ".dsh-leek-fund");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "config.json"), JSON.stringify({ pollMs: 5555 }), "utf8");

    const out = runWithHome(older, READ_CONFIG);
    const j = parseOut(out, "搬迁最早代旧路径");
    const expectedOlder = join(older, ".dsh", "dsh-stock-leek", "config.json");
    check("两代旧路径都没有时，从最早那代搬过来", j.pollMs === 5555 && j.path === expectedOlder, { pollMs: j.pollMs, path: j.path });
    rmSync(older, { recursive: true, force: true });
  }

  // 5. 两代旧位置都在时，优先搬较新的那一代
  {
    const both = mkdtempSync(join(tmpdir(), "sl-home-both-"));
    mkdirSync(join(both, ".dsh", "dsh-leek-fund"), { recursive: true });
    mkdirSync(join(both, ".dsh-leek-fund"), { recursive: true });
    writeFileSync(join(both, ".dsh", "dsh-leek-fund", "config.json"), JSON.stringify({ pollMs: 2222 }), "utf8");
    writeFileSync(join(both, ".dsh-leek-fund", "config.json"), JSON.stringify({ pollMs: 1111 }), "utf8");

    const out = runWithHome(both, READ_CONFIG);
    const j = parseOut(out, "两代旧路径并存");
    check("两代旧路径并存时取较新的一代", j.pollMs === 2222, j.pollMs);
    rmSync(both, { recursive: true, force: true });
  }

  // 6. 旧文件本身是坏的 → 不搬迁，按首次运行处理（不当成损坏告警）
  {
    const fresh = mkdtempSync(join(tmpdir(), "sl-home-bad-"));
    const legacyDir = join(fresh, ".dsh", "dsh-leek-fund");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "config.json"), "{ this is not json", "utf8");
    const out = runWithHome(fresh, READ_CONFIG);
    const j = parseOut(out, "坏旧文件");
    const expectedFresh = join(fresh, ".dsh", "dsh-stock-leek", "config.json");
    check("坏的旧文件不搬迁", j.path === expectedFresh, j.path);
    check("坏的旧文件未被复制到新位置", !existsSync(expectedFresh), true);
    rmSync(fresh, { recursive: true, force: true });
  }

  // 7. 旧名环境变量仍然生效（兼容老脚本）
  {
    const custom = mkdtempSync(join(tmpdir(), "sl-home-env-"));
    const envPath = join(custom, "custom.json");
    const script = `
      import http from "node:http";
      const { apply } = await import(${JSON.stringify(INDEX_URL)});
      const routes = new Map();
      apply({ effect: (fn) => fn(), webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {}; } } });
      const server = http.createServer((req, res) => {
        const h = routes.get(new URL(req.url, "http://x").pathname);
        if (h) h(req, res); else { res.writeHead(404); res.end(); }
      });
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const r = await fetch("http://127.0.0.1:" + server.address().port + "/dsh-stock-leek/config?quotes=0");
      const j = await r.json();
      console.log(JSON.stringify({ path: j.path }));
      server.close();
      process.exit(0);
    `;
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: custom, USERPROFILE: custom, DSH_STOCK_LEEK_CONFIG: "", DSH_LEEK_FUND_CONFIG: envPath },
      encoding: "utf8",
      timeout: 60000,
    });
    const j = parseOut({ stdout: (res.stdout || "").trim(), stderr: (res.stderr || "").trim() }, "旧环境变量");
    check("旧名环境变量 DSH_LEEK_FUND_CONFIG 仍生效", j.path === envPath, { got: j.path, want: envPath });
    rmSync(custom, { recursive: true, force: true });
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);