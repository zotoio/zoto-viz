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
  /** Import specifier, resolved pack path, or stable rule tag (baseline identity). */
  target: string;
}

export function violationKey(v: PackLintViolation): string {
  return `${v.file}\0${v.rule}\0${v.target}`;
}

export type PackLintBaseline = { violations: PackLintViolation[] };
