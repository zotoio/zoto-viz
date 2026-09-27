export type PackLintRule =
  | "sandbox-escape"
  | "host-import"
  | "cross-pack-import"
  | "inline-zoto-declare"
  | "pack-zoto-binding"
  | "host-transport-escape"
  | "get-config-in-on-frame"
  | "side-effect-import"
  /** `import()` / `require()` argument is not a verifiable string literal. */
  | "unverified-import-call"
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
  line?: number;
  column?: number;
}

export function violationKey(v: PackLintViolation): string {
  return `${v.file}\0${v.rule}\0${v.target}`;
}

export type PackLintBaseline = { violations: PackLintViolation[] };
