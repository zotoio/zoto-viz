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
    case "glsl-uniform-undeclared":
      return "Declare `uniform <type> NAME;` in that stage (or the GLSL const it interpolates). "
        + "A missing declaration fails the shader compile and leaves the tile bare (#171).";
    case "uniform-set-undeclared":
      return "Declare the uniform in the shader it is bound to, or stop setting it (a pack can only set host sky uniforms).";
    case "glsl-uniform-unset":
      return "Set it in the material's uniforms / onBeforeCompile (or use a host sky uniform in a pack sky).";
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
    case "glsl-uniform-undeclared": {
      const [stage, name] = v.target.split(":");
      return `${loc} ${stage} shader reads undeclared uniform ${name}.`;
    }
    case "uniform-set-undeclared":
      return `${loc} binds uniform ${v.target}, which its GLSL never declares.`;
    case "glsl-uniform-unset": {
      const [stage, name] = v.target.split(":");
      return `${loc} ${stage} shader reads uniform ${name}, which nothing sets.`;
    }
    default:
      return `${loc} ${rule} → ${v.target}`;
  }
}
