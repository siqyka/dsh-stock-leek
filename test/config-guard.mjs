/**
 * 测试配置路径守卫（零依赖，供两个测试文件共用）。
 *
 * 背景：两个测试都会 POST /config 写配置。直接用真实配置路径会覆盖用户的持仓数据。
 * 这里做三件事：
 *   1. 未指定 DSH_STOCK_LEEK_CONFIG → 落到系统临时目录（带 pid，天然隔离）
 *   2. 已指定但指向看起来像真实配置的路径 → 拒绝启动，除非显式设 SL_ALLOW_REAL_CONFIG=1
 *   3. 进程退出时删除临时文件，不留垃圾
 */
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { existsSync, unlinkSync, rmSync } from "node:fs";

/**
 * 真实配置路径的识别规则。
 * 除了当前默认路径，**历史改名前的旧路径也要拦**——那些文件同样装着用户的真实持仓，
 * 测试写坏它们的后果和写坏当前路径一样。
 */
const REAL_PATTERNS = [
  /[/\\]\.dsh[/\\]dsh-stock-leek[/\\]config\.json$/i, // 当前真实默认路径
  /[/\\]\.dsh[/\\]dsh-leek-fund[/\\]config\.json$/i, // 改名前的旧默认路径
  /[/\\]\.dsh-leek-fund[/\\]config\.json$/i, // 更早的旧默认路径
];

/**
 * @param {string} tag 测试标识，用于临时文件名（如 e2e / routes）
 * @returns {string} 最终生效的配置路径
 */
/**
 * 校验「index.js 实际生效的配置路径」就是期望的隔离路径。
 *
 * 背景：index.js 曾在模块顶层固化 CONFIG_PATH，而 ESM 的静态 import 会被提升
 * ——测试文件里 `import ... from "../index.js"` 会在 useTestConfigPath() 之前
 * 执行，守卫设的环境变量根本来不及生效，测试于是写到了用户的真实配置上。
 * index.js 现已改为惰性解析，但**导入顺序依然是前提**，所以这里做实锤校验：
 * 若生效路径不是隔离路径，直接抛错让测试失败，绝不静默写坏用户数据。
 *
 * 用法（必须在 await import("../index.js") 之后调用）：
 *   useTestConfigPath("x");
 *   const { apply } = await import("../index.js");
 *   await verifyConfigPathIsolation();
 *
 * @param {string} [want] 期望的隔离路径，默认取当前环境变量
 */
export async function verifyConfigPathIsolation(want) {
  const expect = want || process.env.DSH_STOCK_LEEK_CONFIG || "";
  if (!expect) return; // 用户显式指定路径时由 REAL_PATTERNS 把关
  const mod = await import("../index.js");
  const actual = mod.getConfigPathForTest();
  if (actual !== expect) {
    throw new Error(
      [
        "",
        "拒绝运行：index.js 生效的配置路径不是测试隔离路径。",
        `  期望: ${expect}`,
        `  实际: ${actual}`,
        "",
        "这几乎一定是导入顺序写错了：ESM 静态 import 会提升，",
        '必须在 useTestConfigPath() 之后再用 await import("../index.js")。',
        "",
      ].join("\n"),
    );
  }
}

export function useTestConfigPath(tag) {
  // 同步防呆：index.js 已被提前 import（说明导入顺序错了），此刻设环境变量已来不及
  if (globalThis[Symbol.for("dsh-stock-leek.index.loaded")]) {
    throw new Error(
      [
        "",
        "拒绝运行：index.js 在 useTestConfigPath() 之前就被 import 了。",
        "",
        "ESM 的静态 import 会被提升到所有语句之前执行，此时守卫还没机会",
        "设置隔离路径，测试会写到用户的真实配置（~/.dsh/dsh-stock-leek/config.json）。",
        "",
        "改法：把 import 改成动态导入，并放在本调用之后：",
        '  useTestConfigPath("x");',
        '  const { apply } = await import("../index.js");',
        "",
      ].join("\n"),
    );
  }

  const envPath = process.env.DSH_STOCK_LEEK_CONFIG;

  if (envPath) {
    const looksReal = REAL_PATTERNS.some((re) => re.test(envPath));
    if (looksReal && process.env.SL_ALLOW_REAL_CONFIG !== "1") {
      throw new Error(
        [
          "",
          "拒绝运行：DSH_STOCK_LEEK_CONFIG 指向了看起来是真实配置的路径。",
          `  当前值: ${envPath}`,
          "本测试会 POST /config 写入该文件，可能覆盖你的持仓数据。",
          "请改用临时路径，或确知风险后设置 SL_ALLOW_REAL_CONFIG=1 重试。",
          "",
        ].join("\n"),
      );
    }
    process.env.DSH_STOCK_LEEK_CONFIG = envPath;
    return envPath;
  }

  const p = join(tmpdir(), `dsh-stock-leek-${tag}-${process.pid}.json`);
  process.env.DSH_STOCK_LEEK_CONFIG = p;

  // 清理：临时文件与可能产生的 .bak / .corrupt / .alerts 一起删
  // （.alerts 是预警事件账本，派生自 configPath()+".alerts"，隔离随主文件继承）
  const cleanup = () => {
    for (const f of [p, p + ".bak", p + ".corrupt", p + ".alerts"]) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  };
  process.on("exit", cleanup);
  // 兜底：ctrl-c / 未捕获异常时也清
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  return p;
}

/** 删除临时配置目录（测试收尾可显式调用，保证断言输出前已落盘） */
export function dropTestConfigPath(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
}