/**
 * #185: the pack install lint fails closed.
 *
 * bundle-pack-entry.mjs runs the blocking install lint (web/scripts/pack-install-lint-run.ts under
 * tsx) when ZOTO_PACK_INSTALL_LINT=1, as the service's install path does. It used to run it only
 * if web/node_modules/tsx/dist/cli.mjs existed and silently install otherwise; tsx wasn't declared
 * anywhere, so a clean `pnpm install` skipped the lint at every real install.
 *
 * Every row runs the real bundle-pack-entry.mjs as a child process. The refusal rows use a temp
 * copy of the tree the script needs (web/scripts, web/package.json, web/node_modules/esbuild,
 * plugins/sdk), so the runner is really unresolvable or really misbehaves; no test-only switch.
 *
 * Revert row: put back the old `fs.existsSync(tsxCli) && fs.existsSync(lintRun)` gate -> the
 * missing-runner, crash and exit-0-without-verdict rows install (exit 0) and go red.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  catalogErrorLooksBlocked,
  formatPackInstallBlocked,
  isPackInstallBlockedPayload,
  PACK_INSTALL_CHECK_UNAVAILABLE,
} from "./pack-install-surface";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "web");
const sdkRoot = path.join(repoRoot, "plugins/sdk");
const PACK_NAME = "Star Sines";
const SETUP_MSG = `Couldn't safety-check ${PACK_NAME}, so it wasn't installed. Run \`pnpm install\` in \`web/\` and try again.`;
const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;

const tmpRoots: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `zv185-${prefix}-`));
  tmpRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

/** A pack home copied from plugins/src/star-sines; `bad` adds a sandbox-escape file. */
function packHome(bad = false): string {
  const home = path.join(tmp(bad ? "bad-pack" : "pack"), "star-sines");
  cpSync(path.join(repoRoot, "plugins/src/star-sines"), home, { recursive: true });
  if (bad) writeFileSync(path.join(home, "frontend/leak.ts"), 'export function leak() { return indexedDB.open("x"); }\n');
  return home;
}

/**
 * The tree bundle-pack-entry.mjs needs, copied: its scripts, web/package.json, esbuild, the SDK.
 * `tsx` links the real tsx package in (or leaves it out); `runner` replaces the lint runner's source.
 */
function scriptTree(opts: { tsx: boolean; runner?: string | null }): string {
  const root = tmp(opts.tsx ? "tree-tsx" : "tree-no-tsx");
  mkdirSync(path.join(root, "web/scripts"), { recursive: true });
  mkdirSync(path.join(root, "web/node_modules"), { recursive: true });
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  cpSync(path.join(webRoot, "scripts/bundle-pack-entry.mjs"), path.join(root, "web/scripts/bundle-pack-entry.mjs"));
  cpSync(path.join(webRoot, "package.json"), path.join(root, "web/package.json"));
  const runner = path.join(root, "web/scripts/pack-install-lint-run.ts");
  if (opts.runner === undefined) cpSync(path.join(webRoot, "scripts/pack-install-lint-run.ts"), runner);
  else if (opts.runner !== null) writeFileSync(runner, opts.runner);
  symlinkSync(realpathSync(path.join(webRoot, "node_modules/esbuild")), path.join(root, "web/node_modules/esbuild"), "dir");
  if (opts.tsx) symlinkSync(realpathSync(path.join(webRoot, "node_modules/tsx")), path.join(root, "web/node_modules/tsx"), "dir");
  symlinkSync(sdkRoot, path.join(root, "plugins/sdk"), "dir");
  return root;
}

/** Run bundle-pack-entry.mjs from `tree` on `home` with the install lint on (the service's argv). */
function bundle(tree: string, home: string): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [path.join(tree, "web/scripts/bundle-pack-entry.mjs"), path.join(home, "frontend/index.ts"), sdkRoot, home, tree],
    { cwd: tree, encoding: "utf8", env: { ...process.env, ZOTO_PACK_INSTALL_LINT: "1", NODE_ENV: "production" }, timeout: 60_000 },
  );
}

function verdicts(text: string, type: string): Record<string, unknown>[] {
  return text.split(/\r?\n/).flatMap((l) => {
    try {
      const raw = JSON.parse(l.trim()) as Record<string, unknown>;
      return raw && raw.type === type ? [raw] : [];
    } catch {
      return [];
    }
  });
}

function why(r: SpawnSyncReturns<string>): string {
  return `exit ${r.status} signal ${r.signal}; stdout ${r.stdout.length} B; stderr: ${r.stderr.slice(0, 600)}`;
}

function expectSetupRefusal(r: SpawnSyncReturns<string>, detail: RegExp): void {
  expect(r.status, `refused with the setup exit, not installed: ${why(r)}`).toBe(EXIT_LINT_SETUP);
  expect(r.stdout, "no bundle written").toBe("");
  expect(r.stderr, "setup message").toContain(SETUP_MSG);
  const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
  expect(setup, "one setup-error line").toHaveLength(1);
  expect(setup[0]!.message).toBe(SETUP_MSG);
  expect(String(setup[0]!.detail)).toMatch(detail);
  expect(verdicts(r.stderr, "pack-install-lint-pass"), "no pass verdict").toEqual([]);
  expect(verdicts(r.stderr, "pack-install-lint-block"), "not a lint block").toEqual([]);
}

describe("#185 pack install lint fails closed (bundle-pack-entry.mjs)", () => {
  it("no runner available (no tsx in web/node_modules): the install is refused with the setup message, not skipped", () => {
    const tree = scriptTree({ tsx: false });
    expect(existsSync(path.join(tree, "web/node_modules/tsx")), "tsx really absent").toBe(false);
    expectSetupRefusal(bundle(tree, packHome()), /tsx not resolvable/);
  }, 60_000);

  it("lint runner file missing: refused with the setup message", () => {
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: null }), packHome()), /lint runner missing/);
  }, 60_000);

  it("a runner that crashes: refused with the setup message", () => {
    const r = bundle(scriptTree({ tsx: true, runner: 'throw new Error("lint runner crashed (#185 row)");\n' }), packHome());
    expectSetupRefusal(r, /no verdict \(exit 1\)/);
    expect(r.stderr, "the crash is still in the log").toContain("lint runner crashed (#185 row)");
  }, 60_000);

  it("a runner killed by a signal: refused with the setup message", () => {
    const r = bundle(scriptTree({ tsx: true, runner: 'process.kill(process.pid, "SIGKILL");\n' }), packHome());
    // tsx runs the script in a child and relays a signal death as 128 + n, so either form is a refusal.
    expectSetupRefusal(r, /killed by SIGKILL|no verdict \(exit 137\)/);
  }, 60_000);

  it("a runner that exits 0 but prints no verdict: refused with the setup message", () => {
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: "process.exit(0);\n" }), packHome()), /no verdict \(exit 0\)/);
  }, 60_000);

  it("a clean pack still installs (checkout, and the copied tree with tsx as the control)", () => {
    for (const tree of [repoRoot, scriptTree({ tsx: true })]) {
      const r = bundle(tree, packHome());
      expect(r.status, `clean pack bundles (${tree === repoRoot ? "checkout" : "copied tree"}): ${why(r)}`).toBe(0);
      expect(r.stdout.length, "bundle written").toBeGreaterThan(100);
      expect(verdicts(r.stderr, "pack-install-lint-pass"), "the lint ran and passed").toHaveLength(1);
      expect(r.stderr).not.toContain("Couldn't safety-check");
    }
  }, 120_000);

  it("a pack with a lint finding is still blocked with the lint message and exit code, not the setup message", () => {
    const r = bundle(repoRoot, packHome(true));
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    expect(r.stdout).toBe("");
    const block = verdicts(r.stderr, "pack-install-lint-block");
    expect(block, "lint-block line").toHaveLength(1);
    expect(String(block[0]!.message)).toMatch(/leak\.ts:1 sandbox-escape .*indexedDB/);
    expect(r.stderr).not.toContain("Couldn't safety-check");
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
    expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
  }, 60_000);

  it("setup refusal and lint block: different exit codes and messages, neither contains the other's text", () => {
    const setup = bundle(scriptTree({ tsx: false }), packHome());
    const block = bundle(repoRoot, packHome(true));
    expect(setup.status).toBe(EXIT_LINT_SETUP);
    expect(block.status).toBe(EXIT_LINT_BLOCK);
    expect(setup.status).not.toBe(block.status);
    const setupMsg = String(verdicts(setup.stderr, "pack-install-lint-setup-error")[0]?.message ?? "");
    const blockMsg = String(verdicts(block.stderr, "pack-install-lint-block")[0]?.message ?? "");
    expect(setupMsg).toBe(SETUP_MSG);
    expect(blockMsg.length).toBeGreaterThan(0);
    expect(setupMsg).not.toBe(blockMsg);
    expect(setup.stderr, "setup output carries none of the block's text").not.toContain(blockMsg);
    expect(setup.stderr).not.toMatch(/sandbox-escape|pack-install-lint-block|was blocked/);
    expect(block.stderr, "block output carries none of the setup text").not.toContain(setupMsg);
    expect(block.stderr).not.toMatch(/safety-check|pnpm install|pack-install-lint-setup-error/);
  }, 120_000);
});

describe("#185 tsx is a pinned production dependency of web/", () => {
  it("web/package.json dependencies pin tsx exactly, and the lockfile's prod set has it (read, no install)", () => {
    const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const pin = pkg.dependencies?.tsx;
    expect(pin, "tsx in dependencies (installed by pnpm install --prod)").toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies?.tsx, "not a devDependency").toBeUndefined();
    const lock = parse(readFileSync(path.join(webRoot, "pnpm-lock.yaml"), "utf8")) as {
      importers: Record<string, { dependencies?: Record<string, { specifier: string; version: string }>; devDependencies?: Record<string, unknown> }>;
      packages: Record<string, unknown>;
    };
    const prod = lock.importers["."]?.dependencies?.tsx;
    expect(prod, "lockfile importer '.' dependencies.tsx").toEqual({ specifier: pin, version: pin });
    expect(lock.importers["."]?.devDependencies?.tsx).toBeUndefined();
    expect(lock.packages[`tsx@${pin}`], "tsx package entry in the lockfile").toBeDefined();
  });
});

describe("#185 the install UI shows the setup refusal in the service's words", () => {
  it("pack_install_check_unavailable rows surface with their message, unchanged", () => {
    const row = { ok: false as const, error: PACK_INSTALL_CHECK_UNAVAILABLE, message: SETUP_MSG, zip: "star-sines.zip" };
    expect(PACK_INSTALL_CHECK_UNAVAILABLE).toBe("pack_install_check_unavailable");
    expect(isPackInstallBlockedPayload(row)).toBe(true);
    expect(formatPackInstallBlocked(row)).toBe(SETUP_MSG);
    expect(catalogErrorLooksBlocked(SETUP_MSG)).toBe(true);
  });
});
