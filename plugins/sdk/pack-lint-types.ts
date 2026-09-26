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
}

export type PackLintBaseline = { violations: PackLintViolation[] };
