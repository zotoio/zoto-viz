export type PackLintRule =
  | "sandbox-escape"
  | "host-import"
  | "cross-pack-import"
  | "inline-zoto-declare"
  | "get-config-in-on-frame"
  /** `web/src/**` statically reaches `plugins/src/**` (reverse pack boundary). */
  | "host-imports-pack-src";

export interface PackLintViolation {
  /** Repo-relative path (`plugins/src/...` or `web/src/...`). */
  file: string;
  rule: PackLintRule;
  /** Baseline identity: resolved repo path or stable rule tag. */
  target: string;
  /** Raw import specifier or extra context (not stored in baseline). */
  detail?: string;
}

export function formatViolationMessage(v: PackLintViolation): string {
  const base = `${v.file}: ${v.rule} → ${v.target}`;
  return v.detail ? `${base} (${v.detail})` : base;
}

export function violationKey(v: PackLintViolation): string {
  return `${v.file}\0${v.rule}\0${v.target}`;
}

export type PackLintBaseline = { violations: PackLintViolation[] };
