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
export function useTestConfigPath(tag) {
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

  // 清理：临时文件与可能产生的 .bak 一起删
  const cleanup = () => {
    for (const f of [p, p + ".bak", p + ".corrupt"]) {
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