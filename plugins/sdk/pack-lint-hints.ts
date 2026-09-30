import type { PackLintRule, PackLintViolation } from "./pack-lint-types";
import { PACK_BOUNDARY_FIX_HINT } from "./pack-lint-import";

export function formatViolationMessage(v: PackLintViolation): string {
  const msg = ruleMessage(v.rule, v);
  const hint = ruleHint(v.rule, v);
  return hint ? `${msg} — ${hint}` : msg;
}

export function ruleHint(rule: PackLintRule, v: PackLintViolation): string {
  switch (rule) {
    case "host-import":
    case "cross-pack-import":
      return PACK_BOUNDARY_FIX_HINT;
    case "unverified-import-call":
      return "Use a string path inside your pack, e.g. `import(\"./scenes/a\")`.";
    case "side-effect-import":
      return "Side-effect imports are only allowed for files inside your pack (e.g. `import \"./setup\"`). "
        + "Out-of-pack side effects bypass the bundle boundary.";
    case "sandbox-escape":
      return "Pack code runs in a sandboxed iframe — do not touch parent, storage, or cookies.";
    case "host-transport-escape":
      return v.detail ?? "Use getVizZoto() in the sandbox; do not call postMessage or import host transport types.";
    case "inline-zoto-declare":
    case "pack-zoto-binding":
      return v.detail ?? "Use getVizZoto() from plugins/sdk/viz-zoto (const host = getVizZoto();).";
    case "get-config-in-on-frame":
      return "Read config in onConfig or once at init with getConfig(); do not call getConfig() from onFrame.";
    case "host-imports-pack-src":
      return "Load shipped packs only via /api/plugins/<id>/module.js (no direct plugins/src imports).";
    default:
      return "";
  }
}

export function ruleMessage(rule: PackLintRule, v: PackLintViolation): string {
  const loc = v.line != null ? `\`${v.file}:${v.line}\`` : v.file;
  switch (rule) {
    case "unverified-import-call":
      return `${loc} ${v.detail ?? v.target} can't be checked.`;
    case "host-import":
      return `${loc} imports host or out-of-pack code (\`${v.target}\`).`;
    case "cross-pack-import":
      return `${loc} imports another pack (\`${v.target}\`).`;
    case "side-effect-import":
      return `${loc} side-effect import targets out-of-pack \`${v.target}\`.`;
    case "sandbox-escape":
      return `${loc} uses forbidden sandbox API (${v.target}).`;
    case "host-transport-escape":
      return `${loc} reaches host transport (${v.target}).`;
    case "inline-zoto-declare":
      return `${loc} declares zoto inline.`;
    case "pack-zoto-binding":
      return `${loc} binds top-level identifier zoto.`;
    case "get-config-in-on-frame":
      return `${loc} calls getConfig() inside onFrame.`;
    case "host-imports-pack-src":
      return `${loc} reaches pack source (\`${v.target}\`).`;
    default:
      return `${loc} ${rule} → ${v.target}`;
  }
}

/**
 * #185: plain-words sentence per rule for the user-facing install block
 * ("<Name> was blocked because <sentence> Nothing was installed, …"; service/pack_block_copy.py).
 * No rule ids, file paths, line numbers or code (`parent.`) — those stay in the diagnostic log.
 * Every rule is listed so a new rule can't silently fall back.
 */
export const PACK_LINT_PLAIN_SUMMARY: Readonly<Record<PackLintRule, string>> = {
  "sandbox-escape": "it tries to reach outside its sandbox.",
  "host-transport-escape": "it tries to talk to the app directly, which packs aren't allowed to do.",
  "inline-zoto-declare": "it connects to the visualiser in an old way that isn't allowed any more.",
  "pack-zoto-binding": "it connects to the visualiser in an old way that isn't allowed any more.",
  "host-import": "it loads code from outside its own folder.",
  "cross-pack-import": "it loads code from another pack.",
  "side-effect-import": "it loads code from outside its own folder.",
  "unverified-import-call": "it loads code in a way that can't be checked.",
  "get-config-in-on-frame": "it reads its settings in a way that isn't allowed.",
  "host-imports-pack-src": "it loads code from outside its own folder.",
};

export const PACK_LINT_PLAIN_FALLBACK = "it uses code the pack sandbox doesn't allow.";

/** One sentence per distinct kind of finding, in first-seen order ("it …. It …."). */
export function plainBlockSummary(violations: readonly Pick<PackLintViolation, "rule">[]): string {
  const sentences: string[] = [];
  for (const v of violations) {
    const s = (PACK_LINT_PLAIN_SUMMARY as Record<string, string | undefined>)[v.rule] ?? PACK_LINT_PLAIN_FALLBACK;
    if (!sentences.includes(s)) sentences.push(s);
  }
  if (!sentences.length) sentences.push(PACK_LINT_PLAIN_FALLBACK);
  return sentences.map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1))).join(" ");
}
