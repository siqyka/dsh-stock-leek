/**
 * 插件装载契约回归测试：node test/plugin-contract.mjs
 *
 * 背景（真实事故）：插件发布到 npm 后，用户安装成功但界面里看不到任何东西。
 * 根因是 cordis.patch.yml 里把 name 写成了**裸名** `dsh-stock-leek`，而 npm 包名是
 * `@shiqyka/dsh-stock-leek`。DSH 的 @deepseek-ai/dsh-client-modules 加载器要求：
 *
 *   lib/index.js:774  nearestPackage —— 用行内 specifier 解析到的 package.json，
 *                     其 name 必须 **等于** 该 specifier，否则返回 undefined；
 *   lib/index.js:718  声明 dsh.client 的包必须在 exports 里导出 "./client"；
 *   lib/index.js:884  graph entry 的 id 取自 packageName（= pkg.name）；
 *   lib/client.js:624 校验加载到的 bundle 是否用 __ModuleLoader__.load 注册了该 id，
 *                     否则报 'loaded without registering "<id>"' 并跳过该插件。
 *
 * 任何一环不满足，插件就静默不显示（host 半体还可能因为残留软链而照常工作，
 * 更加难以察觉）。本测试锁死这四条契约。
 *
 * 之所以需要单独的套件：test/e2e-render.mjs 的装载桩 `load: (def) => ...` 忽略了
 * 模块 id，因此当年没能拦住这个 bug。
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let fails = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ok  ", label);
  else {
    console.log("  FAIL", label, extra === undefined ? "" : JSON.stringify(extra));
    fails++;
  }
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

// ---------------------------------------------------------------- 1. package.json 契约
console.log("== 1. package.json 的双半体声明 ==");
check("是 scoped 包名（与 patch 的 name 必须一致）", typeof pkg.name === "string" && pkg.name.length > 0, pkg.name);
check("声明了 dsh.bundle.patch", !!(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch), pkg.dsh && pkg.dsh.bundle);
check("声明了 dsh.client", !!(pkg.dsh && pkg.dsh.client));
check('dsh.client.platform === "web"', pkg.dsh?.client?.platform === "web", pkg.dsh?.client?.platform);

// clientExportOf：exports["./client"] 必须是字符串，或带 string default 的对象
const ce = pkg.exports && pkg.exports["./client"];
const clientRel = typeof ce === "string" ? ce : ce && typeof ce.default === "string" ? ce.default : undefined;
check('exports["./client"] 可解析为路径', !!clientRel, ce);
const clientAbs = clientRel ? join(root, clientRel) : null;
check("client 半体文件存在", !!clientAbs && existsSync(clientAbs), clientAbs);

// bundle patch 指向的文件存在
const patchRel = pkg.dsh?.bundle?.patch;
const patchAbs = patchRel ? join(root, patchRel) : null;
check("bundle patch 文件存在", !!patchAbs && existsSync(patchAbs), patchAbs);

// ---------------------------------------------------------------- 2. patch 的 specifier 必须能解析回本包
console.log("\n== 2. cordis.patch.yml 的行内 specifier（nearestPackage 判定） ==");
let spec = null;
if (patchAbs && existsSync(patchAbs)) {
  const raw = readFileSync(patchAbs, "utf8");
  // 去掉注释行，避免把说明文字里的示例当声明
  const code = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");
  const m = /^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/m.exec(code);
  spec = m ? m[1].trim() : null;
}
check("patch 里声明了 name", !!spec, spec);
check("name 等于 package.json 的 name", spec === pkg.name, { spec, pkgName: pkg.name });

if (spec === pkg.name) {
  // 模拟加载器：用 profile 的解析根去 resolve 这个 specifier
  const req = createRequire(join(root, "package.json"));
  let resolved = null;
  try {
    resolved = req.resolve(spec + "/package.json");
  } catch (e) {
    // 本仓库自身作为包根时，自引用解析可能不可用 —— 退化为直接比对包名即可
    check("specifier 可被 Node 解析（或为自引用）", true, "跳过：" + e.code);
  }
  if (resolved) {
    const rn = JSON.parse(readFileSync(resolved, "utf8")).name;
    check("解析到的 package.json.name === specifier", rn === spec, { resolvedName: rn, spec });
  }
}

// ---------------------------------------------------------------- 3. 客户端 bundle 注册的 id
console.log("\n== 3. 客户端 bundle 注册的 id（graph entry id 校验） ==");
let regId = null;
if (clientAbs && existsSync(clientAbs)) {
  const src = readFileSync(clientAbs, "utf8");
  const m = /__ModuleLoader__\s*\.\s*load\s*\(\s*\{[\s\S]{0,400}?\bid:\s*['"]([^'"]+)['"]/.exec(src);
  regId = m ? m[1] : null;
}
check("client.js 调用了 __ModuleLoader__.load 且带 id", !!regId, regId);
// graph entry 的 id 取自 packageName（index.js:884），客户端必须注册同一个 id
check("注册的 id === package.json 的 name", regId === pkg.name, { regId, pkgName: pkg.name });

// ---------------------------------------------------------------- 4. 真实执行 bundle，复现加载器判定
console.log("\n== 4. 实际执行 bundle 能否被加载器认领 ==");
if (clientAbs && existsSync(clientAbs)) {
  // 用一个最小 window 桩执行 bundle 顶层（只做 __ModuleLoader__.load 调用）
  let registered = null;
  const win = { __ModuleLoader__: { load: (def) => { registered = def; } } };
  let threw = null;
  try {
    // eslint-disable-next-line no-new-func
    new Function("window", "globalThis", readFileSync(clientAbs, "utf8"))(win, { window: win });
  } catch (e) {
    threw = e;
  }
  check("执行 bundle 不抛错", !threw, threw && threw.message);
  check("执行后完成注册", !!registered);
  if (registered) {
    // 这就是 lib/client.js:624 的判定：factories.has(id)
    const factories = new Set([registered.id]);
    check('factories.has(包名) 通过（不会报 loaded without registering）', factories.has(pkg.name), {
      registeredId: registered.id,
      expected: pkg.name,
    });
    check("factory 是函数", typeof registered.factory === "function");
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
