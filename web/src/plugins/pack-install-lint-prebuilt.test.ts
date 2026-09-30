/**
 * #186: the pack install lint runs in-process from a prebuilt plain-JS file, so installing a pack
 * needs no TypeScript runner.
 *
 * web/scripts/build-pack-install-lint.mjs builds plugins/sdk/pack-install-lint.ts (and what it
 * imports) with esbuild into the committed web/scripts/pack-install-lint.built.mjs; web/'s `prepare`
 * script regenerates it on `pnpm install`. bundle-pack-entry.mjs imports it and gets the verdict as a
 * return value. What #185 guarded with a runner timeout, a nonce on the runner's stdout and exit-code
 * mapping can't happen any more (no runner); what can still go wrong is pinned here:
 *
 * - the committed file is stale (drift row) or missing / stale / throwing / silent at install (exit 3,
 *   the #185 setup sentence, which `pnpm install` in web/ really fixes);
 * - no tsx and no child process anywhere on the install path;
 * - `frontend.bundle: false` packs get esbuild's import-boundary check in-process;
 * - the install lint never reads pack-lint-baseline.json (the baseline is no allow-list).
 *
 * Every install row runs the real bundle-pack-entry.mjs from a temp copy of web/scripts, so the built
 * lint, esbuild and plugins/sdk are really there or really not; no test-only switch. The service side
 * (zip installs, the in-process hang under the service timeout) is tests/test_pack_install_lint_prebuilt.py.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { PackInstallLintVerdict } from "../../../plugins/sdk/pack-install-lint";
import { PACK_LINT_PLAIN_SUMMARY } from "../../../plugins/sdk/pack-lint-hints";
import { formatBundleBoundaryError } from "../../../plugins/sdk/pack-bundle-resolve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "web");
const sdkRoot = path.join(repoRoot, "plugins/sdk");
const BUILT = "pack-install-lint.built.mjs";
const BUILT_PATH = path.join(webRoot, "scripts", BUILT);
const PACK_NAME = "Star Sines";
/**
 * The setup sentence by reason, pinned as literals (the source is web/scripts/pack-install-lint-setup-copy.json,
 * which service/pack_install_lint.py and bundle-pack-entry.mjs both read): a missing, stale or
 * unloadable built lint says `pnpm run prepare` (an up-to-date `pnpm install` skips prepare); everything else keeps
 * #185's `pnpm install`.
 */
const FIX_INSTALL = "Run `pnpm install` in `web/` and try again.";
const FIX_PREPARE = "Run `pnpm run prepare` in `web/` and try again.";
const setupMsg = (name: string, reason: SetupReason) =>
  `Couldn't safety-check ${name}, so it wasn't installed. ${FIX_FOR[reason]}`;
const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const SANDBOX_PLAIN = PACK_LINT_PLAIN_SUMMARY["sandbox-escape"];

type BuildStamp = { entry: string; inputs: string[]; sha256: string };
type BuiltLint = {
  runPackInstallLint: (home: string, root: string, opts?: { unbundled?: boolean }) => PackInstallLintVerdict;
  PACK_INSTALL_LINT_BUILD: BuildStamp;
};
type BuildScript = { buildPackInstallLint: (o?: { repoRoot?: string }) => Promise<string> };
type StampModule = { staleReason: (b: unknown, root: string) => string | null };

const importFile = async <T>(abs: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as T;

const tmpRoots: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `zv186-${prefix}-`));
  tmpRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

function packHome(opts: { bad?: boolean; id?: string } = {}): string {
  const id = opts.id ?? "star-sines";
  const home = path.join(tmp(opts.bad ? "bad-pack" : "pack"), id);
  cpSync(path.join(repoRoot, "plugins/src", id), home, { recursive: true });
  if (opts.bad) writeFileSync(path.join(home, "frontend/leak.ts"), 'export function leak() { return indexedDB.open("x"); }\n');
  return home;
}

/**
 * A copy of web/scripts (every top-level file, so a revert that brings back an old helper is copied
 * too), web/package.json, esbuild (unless `esbuild: false`) and plugins/sdk (linked, or copied with
 * `sdkCopy` so a row can edit it). The built lint (with its stamp) is copied by default:
 * `built: null` deletes it, a string replaces it, `stale: true` edits a copied plugins/sdk source
 * after the build so its stamp no longer matches. Never tsx.
 */
function scriptTree(opts: { esbuild?: boolean; built?: string | null; sdkCopy?: boolean; stale?: boolean } = {}): string {
  const root = tmp("tree");
  mkdirSync(path.join(root, "web/scripts"), { recursive: true });
  mkdirSync(path.join(root, "web/node_modules"), { recursive: true });
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  for (const ent of readdirSync(path.join(webRoot, "scripts"), { withFileTypes: true })) {
    if (ent.isFile()) cpSync(path.join(webRoot, "scripts", ent.name), path.join(root, "web/scripts", ent.name));
  }
  if (opts.built === null) unlinkSync(path.join(root, "web/scripts", BUILT));
  else if (typeof opts.built === "string") writeFileSync(path.join(root, "web/scripts", BUILT), opts.built);
  cpSync(path.join(webRoot, "package.json"), path.join(root, "web/package.json"));
  if (opts.esbuild !== false) {
    symlinkSync(realpathSync(path.join(webRoot, "node_modules/esbuild")), path.join(root, "web/node_modules/esbuild"), "dir");
  }
  if (opts.sdkCopy || opts.stale) cpSync(sdkRoot, path.join(root, "plugins/sdk"), { recursive: true });
  else symlinkSync(sdkRoot, path.join(root, "plugins/sdk"), "dir");
  if (opts.stale) appendFileSync(path.join(root, "plugins/sdk/pack-lint.ts"), "\n// edited after the build (#186 row)\n");
  return root;
}

type Run = SpawnSyncReturns<string> & { nonce: string };

/** bundle-pack-entry.mjs from `tree` on `home` with the install lint on (the service's argv and env). */
function bundle(tree: string, home: string, opts: { lintOnly?: boolean; node?: string[] } = {}): Run {
  const nonce = randomUUID();
  const script = path.join(tree, "web/scripts/bundle-pack-entry.mjs");
  const argv = opts.lintOnly
    ? [script, "--lint-only", home, tree]
    : [script, path.join(home, "frontend/index.ts"), path.join(tree, "plugins/sdk"), home, tree];
  const r = spawnSync(process.execPath, [...(opts.node ?? []), ...argv], {
    cwd: tree,
    encoding: "utf8",
    env: { ...process.env, ZOTO_PACK_INSTALL_LINT: "1", ZOTO_PACK_INSTALL_LINT_NONCE: nonce, NODE_ENV: "production" },
    timeout: 60_000,
  });
  return Object.assign(r, { nonce });
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

const lastLine = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? "";
const why = (r: SpawnSyncReturns<string>) =>
  `exit ${r.status} signal ${r.signal}; stdout ${r.stdout.length} B; stderr: ${r.stderr.slice(0, 900)}`;

function expectPass(r: Run, pack: string): void {
  expect(r.status, why(r)).toBe(0);
  expect(JSON.parse(lastLine(r.stderr)), "the service's nonce-bound pass line is the last stderr line").toEqual({
    type: "pack-install-lint-pass",
    nonce: r.nonce,
    pack,
  });
  expect(r.stderr).not.toContain("Couldn't safety-check");
}

function expectSandboxBlock(r: Run): void {
  expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
  expect(r.stdout, "no bundle written").toBe("");
  const block = verdicts(r.stderr, "pack-install-lint-block");
  expect(block, "one lint-block line").toHaveLength(1);
  expect(block[0]!.message).toBe(SANDBOX_PLAIN);
  expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
  expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
}

/** #186: bundle-pack-entry.mjs's machine-readable setup reasons (diagnostic line only, never user text). */
type SetupReason =
  | "lint_prebuilt_missing"
  | "lint_prebuilt_stale"
  | "lint_prebuilt_unloadable"
  | "esbuild_unresolvable"
  | "lint_threw"
  | "lint_no_verdict";
const FIX_FOR: Record<SetupReason, string> = {
  lint_prebuilt_missing: FIX_PREPARE,
  lint_prebuilt_stale: FIX_PREPARE,
  lint_prebuilt_unloadable: FIX_PREPARE,
  esbuild_unresolvable: FIX_INSTALL,
  lint_threw: FIX_INSTALL,
  lint_no_verdict: FIX_INSTALL,
};

/**
 * Exit 3, this cause's own reason code, that reason's own sentence and nothing raw for the user: no
 * exit code, signal, error class or stack.
 */
function expectSetupRefusal(r: Run, reason: SetupReason, detail: RegExp, name = PACK_NAME): void {
  expect(r.status, `refused with the setup exit, not installed: ${why(r)}`).toBe(EXIT_LINT_SETUP);
  expect(verdicts(r.stderr, "pack-install-lint-setup-error")[0]?.reason, `setup reason code: ${why(r)}`).toBe(reason);
  expect(r.stdout, "no bundle written").toBe("");
  expect(r.stderr.split(/\r?\n/)[0], `first stderr line is the ${reason} sentence`).toBe(setupMsg(name, reason));
  const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
  expect(setup, "one setup-error line").toHaveLength(1);
  expect(setup[0]!.message, `the ${reason} sentence`).toBe(setupMsg(name, reason));
  expect(String(setup[0]!.message)).not.toMatch(/\b1[0-9]{2}\b|\bSIG[A-Z]+\b|Error\b|ERR_|\bat .+:\d+|node:|exit \d/);
  expect(String(setup[0]!.detail), "the raw cause is only in the diagnostic line").toMatch(detail);
  expect(r.stderr, "no stack trace anywhere in the output").not.toMatch(/\n\s+at .+:\d+:\d+/);
  expect(verdicts(r.stderr, "pack-install-lint-pass"), "no pass verdict").toEqual([]);
  expect(verdicts(r.stderr, "pack-install-lint-block"), "not a lint block").toEqual([]);
}

/** A replacement built lint: the real source stamp (so only `body` differs) plus `body`. */
async function fakeBuilt(body: string): Promise<string> {
  const real = await importFile<BuiltLint>(BUILT_PATH);
  return `${body}\nexport const PACK_INSTALL_LINT_BUILD = ${JSON.stringify(real.PACK_INSTALL_LINT_BUILD)};\n`;
}

describe("#186 the prebuilt install lint is the TS source, built", () => {
  it("drift: the committed web/scripts/pack-install-lint.built.mjs is byte-equal to a fresh build of plugins/sdk", async () => {
    const { buildPackInstallLint } = await importFile<BuildScript>(path.join(webRoot, "scripts/build-pack-install-lint.mjs"));
    const fresh = await buildPackInstallLint();
    const committed = readFileSync(BUILT_PATH, "utf8");
    expect(
      committed === fresh,
      "web/scripts/pack-install-lint.built.mjs doesn't match plugins/sdk: run `pnpm run prepare` in web/ and commit it",
    ).toBe(true);
    const built = await importFile<BuiltLint>(BUILT_PATH);
    const { staleReason } = await importFile<StampModule>(path.join(webRoot, "scripts/pack-install-lint-stamp.mjs"));
    expect(staleReason(built.PACK_INSTALL_LINT_BUILD, repoRoot), "source stamp matches the checkout").toBeNull();
    expect(built.PACK_INSTALL_LINT_BUILD.inputs).toEqual(expect.arrayContaining(["plugins/sdk/pack-lint.ts", "plugins/sdk/pack-bundle-resolve.mjs"]));
  }, 60_000);

  it("prepare: web/package.json's prepare script rebuilds a deleted built lint, byte-equal, and the install passes again", () => {
    const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const prepare = pkg.scripts?.prepare ?? "";
    expect(prepare, "`pnpm install` in web/ runs prepare").toMatch(/build-pack-install-lint\.mjs/);
    const tree = scriptTree({ built: null });
    const r = spawnSync("sh", ["-c", prepare], { cwd: path.join(tree, "web"), encoding: "utf8", timeout: 60_000 });
    expect(r.status, `prepare: ${r.stdout}${r.stderr}`).toBe(0);
    expect(readFileSync(path.join(tree, "web/scripts", BUILT), "utf8"), "rebuilt byte-equal to the committed file").toBe(
      readFileSync(BUILT_PATH, "utf8"),
    );
    expectPass(bundle(tree, packHome()), "star-sines");
  }, 60_000);

  it("prepare without esbuild (pnpm install --prod): exits 0 and keeps the committed built lint", () => {
    const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const tree = scriptTree({ esbuild: false });
    const r = spawnSync("sh", ["-c", pkg.scripts?.prepare ?? "false"], { cwd: path.join(tree, "web"), encoding: "utf8", timeout: 60_000 });
    expect(r.status, `prepare must not fail the install: ${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stderr).toMatch(/esbuild not importable .*keeping the committed web\/scripts\/pack-install-lint\.built\.mjs/);
    expect(readFileSync(path.join(tree, "web/scripts", BUILT), "utf8")).toBe(readFileSync(BUILT_PATH, "utf8"));
  }, 60_000);
});

describe("#186 no TypeScript runner on the install path", () => {
  it("no tsx anywhere in the tree: a clean pack installs (bundled and lint-only) and a finding is still blocked", () => {
    const tree = scriptTree();
    expect(() => createRequire(path.join(tree, "web/package.json")).resolve("tsx"), "tsx really unresolvable from the tree").toThrow();
    const r = bundle(tree, packHome());
    expect(r.stdout.length, `bundle written: ${why(r)}`).toBeGreaterThan(100);
    expectPass(r, "star-sines");
    expectPass(bundle(tree, packHome({ id: "sandbox-fixture-multi" }), { lintOnly: true }), "sandbox-fixture-multi");
    expectPass(bundle(tree, packHome({ id: "cores" }), { lintOnly: true }), "cores");
    const bad = bundle(tree, packHome({ bad: true }));
    expectSandboxBlock(bad);
    expect(String(verdicts(bad.stderr, "pack-install-lint-block")[0]!.details)).toMatch(/leak\.ts:1 sandbox-escape .*indexedDB/);
  }, 120_000);

  it("the lint starts no child process: with every child_process spawn throwing, lint-only still passes and blocks", () => {
    const deny = [
      'import cp from "node:child_process";',
      'import { syncBuiltinESMExports } from "node:module";',
      'for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {',
      '  cp[k] = () => { throw new Error(`#186 row: child_process.${k} called`); };',
      "}",
      "syncBuiltinESMExports();",
    ].join("\n");
    const preload = path.join(tmp("preload"), "deny-child-process.mjs");
    writeFileSync(preload, deny);
    const node = ["--import", pathToFileURL(preload).href];
    const tree = scriptTree({ esbuild: false });
    expectPass(bundle(tree, packHome({ id: "sandbox-fixture-multi" }), { lintOnly: true, node }), "sandbox-fixture-multi");
    const home = packHome({ id: "sandbox-fixture-multi" });
    appendFileSync(path.join(home, "frontend/helper.js"), '\nexport function stash() { return indexedDB.open("x"); }\n');
    expectSandboxBlock(bundle(tree, home, { lintOnly: true, node }));
  }, 60_000);

  it("lint-only needs neither tsx nor esbuild (the built lint is plain JS): a bundle: false pack installs", () => {
    const tree = scriptTree({ esbuild: false });
    expect(existsSync(path.join(tree, "web/node_modules/esbuild"))).toBe(false);
    expectPass(bundle(tree, packHome({ id: "sandbox-fixture-multi" }), { lintOnly: true }), "sandbox-fixture-multi");
  }, 60_000);
});

describe("#186 the built lint fails closed at install (exit 3, the reason's own sentence)", () => {
  it("built lint deleted: the install is refused with the setup sentence, no raw exit code or stack; lint-only too", () => {
    const tree = scriptTree({ built: null });
    expect(existsSync(path.join(tree, "web/scripts", BUILT)), "built lint really missing").toBe(false);
    expectSetupRefusal(bundle(tree, packHome()), "lint_prebuilt_missing", /built lint not importable: ERR_MODULE_NOT_FOUND/);
    expect(setupMsg(PACK_NAME, "lint_prebuilt_missing")).toBe(
      "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm run prepare` in `web/` and try again.",
    );
    expectSetupRefusal(bundle(tree, packHome({ id: "cores" }), { lintOnly: true }), "lint_prebuilt_missing", /built lint not importable/, "CPU cores");
  }, 60_000);

  it("built lint stale (plugins/sdk edited after the build): refused with the setup sentence", () => {
    const tree = scriptTree({ stale: true });
    expectSetupRefusal(bundle(tree, packHome()), "lint_prebuilt_stale", /built lint is stale: sources changed since it was built/);
    expect(setupMsg(PACK_NAME, "lint_prebuilt_stale")).toBe(
      "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm run prepare` in `web/` and try again.",
    );
    // Control: the same copy, unedited, passes.
    expectPass(bundle(scriptTree({ sdkCopy: true }), packHome()), "star-sines");
  }, 120_000);

  it("the setup copy table missing too: still refused (exit 3, same reason), no sentence, no stack; the service renders its own", () => {
    const tree = scriptTree({ built: null });
    unlinkSync(path.join(tree, "web/scripts/pack-install-lint-setup-copy.json"));
    const r = bundle(tree, packHome());
    expect(r.status, why(r)).toBe(EXIT_LINT_SETUP);
    expect(r.stdout).toBe("");
    const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
    expect(setup, `one setup-error line: ${why(r)}`).toHaveLength(1);
    expect(setup[0]!.reason).toBe("lint_prebuilt_missing");
    expect(setup[0]!.message, "no sentence without the table (never a second copy)").toBeNull();
    expect(String(setup[0]!.detail)).toMatch(/built lint not importable: .*; setup copy unavailable: ENOENT/);
    expect(r.stderr).not.toMatch(/Couldn't safety-check|\n\s+at .+:\d+:\d+/);
    expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
  }, 60_000);

  it("built lint unloadable (present but not valid JS): refused with the prepare sentence, the error only in the diagnostic line", () => {
    const r = bundle(scriptTree({ built: "export const = ;\n" }), packHome());
    expectSetupRefusal(r, "lint_prebuilt_unloadable", /built lint not importable: .*SyntaxError|built lint not importable: .*Unexpected/);
    expect(setupMsg(PACK_NAME, "lint_prebuilt_unloadable")).toBe(
      "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm run prepare` in `web/` and try again.",
    );
  }, 60_000);

  it("a built lint that throws: refused with the setup sentence, the error only in the diagnostic line", async () => {
    const built = await fakeBuilt('export function runPackInstallLint() { throw new TypeError("lint broke (#186 row)"); }');
    expectSetupRefusal(bundle(scriptTree({ built }), packHome()), "lint_threw", /lint threw: lint broke \(#186 row\)/);
  }, 60_000);

  it("a built lint that returns no verdict (undefined, a string, an unknown kind): refused, never a pass", async () => {
    for (const ret of ["undefined", '"pass"', '{ kind: "PASS", warnings: [] }', "{}"]) {
      const built = await fakeBuilt(`export function runPackInstallLint() { return ${ret}; }`);
      expectSetupRefusal(bundle(scriptTree({ built }), packHome()), "lint_no_verdict", /lint gave no verdict/);
    }
  }, 120_000);
});

describe("#186 frontend.bundle: false packs get esbuild's import-boundary check in-process", () => {
  it("an unbundled .js importing a file outside the pack is blocked with the boundary payload (exit 1)", () => {
    const home = packHome({ id: "sandbox-fixture-multi" });
    writeFileSync(path.join(home, "../outside.js"), "export const x = 1;\n");
    appendFileSync(path.join(home, "frontend/helper.js"), '\nexport { x } from "../../outside.js";\n');
    const r = bundle(repoRoot, home, { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const hit = verdicts(r.stderr, "pack-bundle-boundary");
    expect(hit, "one boundary line").toHaveLength(1);
    expect(hit[0]).toMatchObject({ file: "frontend/helper.js", import: "../../outside.js" });
    expect(String(hit[0]!.reason)).toMatch(/escapes pack and SDK/);
    expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
    // What the user sees (service/pack_boundary.py, same shape): no file, import or README.
    expect(formatBundleBoundaryError({ packName: "Sandbox Fixture Multi", file: "frontend/helper.js", import: "../../outside.js" })).toBe(
      "Sandbox Fixture Multi was blocked because it loads code from outside its own folder. Nothing was installed, and your wall is unchanged. If you made this pack, run pack lint to see what to fix.",
    );
  }, 60_000);

  it("remote URLs and bare modules in an unbundled .js are blocked too; the shipped pack is the control", () => {
    for (const [spec, reason] of [
      ["https://evil.example/x.js", /remote URL imports are not allowed/],
      ["left-pad", /bare module imports are not allowed/],
    ] as const) {
      const home = packHome({ id: "sandbox-fixture-multi" });
      appendFileSync(path.join(home, "frontend/module.js"), `\nimport ${JSON.stringify(spec)};\n`);
      const r = bundle(repoRoot, home, { lintOnly: true });
      expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
      const hit = verdicts(r.stderr, "pack-bundle-boundary")[0];
      expect(hit, why(r)).toMatchObject({ file: "frontend/module.js", import: spec });
      expect(String(hit!.reason)).toMatch(reason);
    }
    expectPass(bundle(repoRoot, packHome({ id: "sandbox-fixture-multi" }), { lintOnly: true }), "sandbox-fixture-multi");
  }, 60_000);
});

describe("#186 the baseline is not an install-time allow-list", () => {
  it("a finding that is in pack-lint-baseline.json still blocks the install", () => {
    const tree = scriptTree({ sdkCopy: true });
    const baselinePath = path.join(tree, "plugins/sdk/pack-lint-baseline.json");
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { violations: { file: string; rule: string; target: string }[] };
    baseline.violations.push({ file: "plugins/src/star-sines/frontend/leak.ts", rule: "sandbox-escape", target: "indexedDB" });
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    const r = bundle(tree, packHome({ bad: true }));
    expectSandboxBlock(r);
    expect(String(verdicts(r.stderr, "pack-install-lint-block")[0]!.details), "the very finding the baseline lists").toMatch(
      /plugins\/src\/star-sines\/frontend\/leak\.ts:1 sandbox-escape/,
    );
  }, 60_000);

  it("the built lint never reads the baseline (no reference to it, not a build input)", async () => {
    const text = readFileSync(BUILT_PATH, "utf8");
    expect(text).not.toMatch(/pack-lint-baseline|loadBaseline/);
    const built = await importFile<BuiltLint>(BUILT_PATH);
    expect(built.PACK_INSTALL_LINT_BUILD.inputs.filter((p) => /baseline/.test(p))).toEqual([]);
  });
});

describe("#186 tsx is no production dependency of web/", () => {
  it("web/package.json dependencies and the lockfile's prod set have no tsx; nothing on the install path names it", () => {
    const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.tsx, "tsx not in dependencies (#185 put it there for the runner)").toBeUndefined();
    const lock = parse(readFileSync(path.join(webRoot, "pnpm-lock.yaml"), "utf8")) as {
      importers: Record<string, { dependencies?: Record<string, unknown> }>;
    };
    expect(lock.importers["."]?.dependencies?.tsx, "lockfile importer '.' dependencies.tsx").toBeUndefined();
    for (const f of ["bundle-pack-entry.mjs", "pack-install-lint-stamp.mjs", "pack-install-lint-setup-copy.mjs", BUILT]) {
      const text = readFileSync(path.join(webRoot, "scripts", f), "utf8");
      expect(text, `${f} names no TS runner`).not.toMatch(/\btsx\/|["']tsx["']|node_modules\/tsx/);
      expect(text, `${f} starts no child process`).not.toMatch(/node:child_process/);
    }
  });
});
