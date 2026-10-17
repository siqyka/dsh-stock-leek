/**
 * 验证 normalizeApiCode 能否识别黄金/期货代码（hf_ / nf_ 前缀）。
 *   node test/gold-code-probe.mjs
 */
const codes = ["hf_GC", "hf_XAU", "hf_SI", "nf_AU0", "nf_AU2612", "hf_ES", "hf_CL"];

const US_INDEX_ALIAS = {
  IXIC: "usIXIC", DJI: "usDJI", INX: "usINX", SPX: "usINX",
  NDX: "usNDX", HSI: "hkHSI", HSCEI: "hkHSCEI", HSTECH: "hkHSTECH",
};

// 复刻 index.js 的 normalizeApiCode（逐行一致）
function normalizeApiCode(input) {
  if (!input) return null;
  let code = String(input).trim();
  if (!code) return null;
  code = code.replace(/[^A-Za-z0-9_.$]/g, "");
  if (!code) return null;

  if (/^usr_/i.test(code)) code = "us" + code.slice(4).toUpperCase();
  if (/^us[._]/i.test(code)) code = "us" + code.slice(3).toUpperCase();

  const lower = code.toLowerCase();
  if (/^(sh|sz|bj)[0-9]{6}$/.test(lower)) return lower;
  if (/^hk/i.test(code)) {
    const rest = code.slice(2);
    if (/^[0-9]+$/.test(rest)) return "hk" + rest.padStart(5, "0");
    const alias = US_INDEX_ALIAS[rest.toUpperCase()];
    if (alias && alias.startsWith("hk")) return alias;
    return "hk" + rest.toUpperCase();
  }
  if (/^us/i.test(code)) {
    let rest = code.slice(2).replace(/\./g, "");
    const stripped = rest.replace(/(OQ|AM)$/, "");
    if (stripped) rest = stripped;
    const alias = US_INDEX_ALIAS[rest.toUpperCase()];
    if (alias) return alias;
    return "us" + rest.toUpperCase();
  }
  if (/^(gb_)/i.test(code)) return lower;

  if (/^[0-9]{6}$/.test(code)) {
    if (/^(60|68|75|78|51|56|58|50|0009|900)/.test(code)) return "sh" + code;
    if (/^(4|8|92)/.test(code)) return "bj" + code;
    if (/^(688)/.test(code)) return "sh" + code;
    return "sz" + code;
  }
  if (/^[0-9]{5}$/.test(code)) return "hk" + code;
  if (/^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(code)) {
    const up = code.toUpperCase();
    const alias = US_INDEX_ALIAS[up];
    if (alias) return alias;
    return "us" + up;
  }
  return code;
}

// 期望：hf_/nf_ 前缀应原样保留（大小写按输入），不该被拼成 usXXX
const expected = (c) => c;
const isOk = (c, out) => out === expected(c);

console.log("=== normalizeApiCode 对黄金/期货代码的归一结果 ===");
for (const c of codes) {
  const out = normalizeApiCode(c);
  console.log("  " + c.padEnd(11) + " → " + String(out).padEnd(14) + (isOk(c, out) ? "✅ 原样保留" : "❌ 被改写为 " + out));
}

console.log("\n=== 结论 ===");
const broken = codes.filter((c) => !isOk(c, normalizeApiCode(c)));
if (broken.length) {
  console.log("  " + broken.length + " 个代码无法正确归一，会被发成错误请求：");
  for (const c of broken) console.log("    " + c + " → " + normalizeApiCode(c));
  console.log("\n  根因：normalizeApiCode 只特判了 gb_ 前缀，");
  console.log("       hf_/nf_ 落到「纯字母→美股」分支，被拼成 usHF_GC 之类。");
  process.exitCode = 1;
} else {
  console.log("  全部可正确归一");
}
