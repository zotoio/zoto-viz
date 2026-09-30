/**
 * #185: the pack install lint fails closed.
 *
 * bundle-pack-entry.mjs runs the blocking install lint when ZOTO_PACK_INSTALL_LINT=1 (bundled packs)
 * or with --lint-only (`frontend.bundle: false` and no-frontend packs), as the service's install
 * path does. It used to run it only if web/node_modules/tsx/dist/cli.mjs existed and silently install
 * otherwise; tsx wasn't declared anywhere, so a clean `pnpm install` skipped the lint at every real
 * install. Unbundled and no-frontend packs skipped it entirely.
 *
 * #186: the lint now runs in-process from the prebuilt plain-JS web/scripts/pack-install-lint.built.mjs
 * (no tsx, no runner child). The #185 rows for a missing, crashed, killed, silent, spoofed or hung
 * runner are gone with the runner; pack-install-lint-prebuilt.test.ts has the rows that replace
 * them (no tsx present, built lint missing / stale / throwing / hanging, no child process).
 *
 * The install goes ahead only with exit 0 and the service's nonce-bound pass line
 * {"type":"pack-install-lint-pass","nonce":<per-run nonce>,"pack":<id>} as the LAST stderr line.
 * A real finding is exit 1 with the lint message. Everything else is exit 3 with the setup message.
 *
 * Every row runs the real bundle-pack-entry.mjs as a child process. The refusal rows use a temp
 * copy of the tree the script needs (web/scripts, web/package.json, esbuild, plugins/sdk) so esbuild
 * or the built lint is really missing; no test-only switch.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  catalogErrorLooksBlocked,
  formatPackInstallBlocked,
  isPackInstallBlockedPayload,
  localPluginPublishChatLine,
  PACK_INSTALL_CHECK_UNAVAILABLE,
} from "./pack-install-surface";
import { PACK_LINT_PLAIN_FALLBACK, PACK_LINT_PLAIN_SUMMARY, plainBlockSummary } from "../../../plugins/sdk/pack-lint-hints";
import type { PackLintRule } from "../../../plugins/sdk/pack-lint-types";
import { formatBundleBoundaryError } from "../../../plugins/sdk/pack-bundle-resolve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "web");
const sdkRoot = path.join(repoRoot, "plugins/sdk");
const PACK_NAME = "Star Sines";
/**
 * UX Pro's fix sentences, pinned here as literals (the source is web/scripts/pack-install-lint-setup-copy.json):
 * #186 split them by setup reason; a missing, stale or unloadable built lint says `pnpm run prepare`.
 */
const FIX_INSTALL = "Run `pnpm install` in `web/` and try again.";
const FIX_PREPARE = "Run `pnpm run prepare` in `web/` and try again.";
type Fix = typeof FIX_INSTALL | typeof FIX_PREPARE;
/** Each setup reason's own fix (the reasons these rows produce). */
const FIX_FOR: Record<string, Fix> = {
  esbuild_unresolvable: FIX_INSTALL,
  lint_prebuilt_missing: FIX_PREPARE,
  lint_prebuilt_stale: FIX_PREPARE,
};
const setupMsg = (name: string, fix: Fix) => `Couldn't safety-check ${name}, so it wasn't installed. ${fix}`;
/** The built lint missing (the separation / plain-words rows' setup refusal). */
const SETUP_MSG_MISSING = setupMsg(PACK_NAME, FIX_PREPARE);
/** UX Pro's upgrade copy (the service builds it; it knows the installed version). */
const upgradeSetupMsg = (name: string, old: string, fix: Fix) =>
  `Couldn't safety-check the new version of ${name}, so it wasn't updated. You're still on version ${old}. ${fix}`;
const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const BARE_PASS = '{"type":"pack-install-lint-pass"}';
/** #186: the files bundle-pack-entry.mjs needs next to it for the in-process install lint. */
const LINT_SCRIPTS = [
  "bundle-pack-entry.mjs",
  "pack-install-lint-stamp.mjs",
  "pack-install-lint.built.mjs",
  "pack-install-lint-setup-copy.mjs",
  "pack-install-lint-setup-copy.json",
];
/** Plain-words block summary for sandbox-escape findings (plugins/sdk/pack-lint-hints.ts). */
const SANDBOX_PLAIN = PACK_LINT_PLAIN_SUMMARY["sandbox-escape"];

/** Raw `file:line rule — …` lines of a block verdict (diagnostics, never shown to users). */
function details(block: Record<string, unknown>): string {
  return Array.isArray(block.details) ? block.details.map(String).join("\n") : "";
}

const tmpRoots: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `zv185-${prefix}-`));
  tmpRoots.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

/** A pack home copied from plugins/src/<id>; `bad` adds a sandbox-escape .ts file. */
function packHome(bad = false, id = "star-sines"): string {
  const home = path.join(tmp(bad ? "bad-pack" : "pack"), id);
  cpSync(path.join(repoRoot, "plugins/src", id), home, { recursive: true });
  if (bad) writeFileSync(path.join(home, "frontend/leak.ts"), 'export function leak() { return indexedDB.open("x"); }\n');
  return home;
}

/**
 * The tree bundle-pack-entry.mjs needs, copied: its scripts (and the #186 built lint), web/package.json,
 * esbuild, the SDK. The built lint (with its stamp) is copied by default; `built: null` leaves it
 * out, `stale: true` copies plugins/sdk and edits a source after the build so the stamp no longer
 * matches; `esbuild: false` leaves esbuild out. No tsx anywhere (#186: the install path doesn't use it).
 */
function scriptTree(opts: { esbuild?: boolean; built?: null; stale?: boolean } = {}): string {
  const root = tmp(opts.built === null ? "tree-no-built-lint" : "tree");
  mkdirSync(path.join(root, "web/scripts"), { recursive: true });
  mkdirSync(path.join(root, "web/node_modules"), { recursive: true });
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  for (const f of LINT_SCRIPTS) {
    if (f === "pack-install-lint.built.mjs" && opts.built === null) continue;
    cpSync(path.join(webRoot, "scripts", f), path.join(root, "web/scripts", f));
  }
  cpSync(path.join(webRoot, "package.json"), path.join(root, "web/package.json"));
  if (opts.esbuild !== false) {
    symlinkSync(realpathSync(path.join(webRoot, "node_modules/esbuild")), path.join(root, "web/node_modules/esbuild"), "dir");
  }
  if (opts.stale) {
    cpSync(sdkRoot, path.join(root, "plugins/sdk"), { recursive: true });
    appendFileSync(path.join(root, "plugins/sdk/pack-lint.ts"), "\n// edited after the build (#186 row)\n");
  } else {
    symlinkSync(sdkRoot, path.join(root, "plugins/sdk"), "dir");
  }
  return root;
}

type Run = SpawnSyncReturns<string> & { nonce: string };

/** Run bundle-pack-entry.mjs from `tree` on `home` with the install lint on (the service's argv). */
function bundle(
  tree: string,
  home: string,
  opts: { lintOnly?: boolean; flags?: string[]; env?: Record<string, string>; timeoutMs?: number } = {},
): Run {
  const nonce = randomUUID();
  const script = path.join(tree, "web/scripts/bundle-pack-entry.mjs");
  const argv = opts.lintOnly
    ? [script, "--lint-only", ...(opts.flags ?? []), home, tree]
    : [script, ...(opts.flags ?? []), path.join(home, "frontend/index.ts"), sdkRoot, home, tree];
  const r = spawnSync(process.execPath, argv, {
    cwd: tree,
    encoding: "utf8",
    env: {
      ...process.env,
      ZOTO_PACK_INSTALL_LINT: "1",
      ZOTO_PACK_INSTALL_LINT_NONCE: nonce,
      NODE_ENV: "production",
      ...(opts.env ?? {}),
    },
    timeout: opts.timeoutMs ?? 60_000,
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

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

function why(r: SpawnSyncReturns<string>): string {
  return `exit ${r.status} signal ${r.signal}; stdout ${r.stdout.length} B; stderr: ${r.stderr.slice(0, 600)}`;
}

/** The user-facing text carries no raw cause: no exit code, signal name, error class or stack. */
function expectPlainUserMessage(message: string): void {
  expect(message).not.toMatch(/\b1[0-9]{2}\b|\bSIG[A-Z]+\b|Error\b|ERR_|\bat .+:\d+|node:|exit \d/);
}

/**
 * `reason`: #186's machine-readable setup cause on the diagnostic line (never user text); the
 * sentence is that reason's own (FIX_FOR).
 */
function expectSetupRefusal(r: SpawnSyncReturns<string>, reason: string, detail: RegExp, name = PACK_NAME): Record<string, unknown> {
  expect(r.status, `refused with the setup exit, not installed: ${why(r)}`).toBe(EXIT_LINT_SETUP);
  expect(verdicts(r.stderr, "pack-install-lint-setup-error")[0]?.reason, `setup reason code: ${why(r)}`).toBe(reason);
  expect(r.stdout, "no bundle written").toBe("");
  const want = setupMsg(name, FIX_FOR[reason]!);
  expect(r.stderr, `setup message for ${reason}`).toContain(want);
  const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
  expect(setup, "one setup-error line").toHaveLength(1);
  expect(setup[0]!.message, `the ${reason} sentence`).toBe(want);
  expectPlainUserMessage(String(setup[0]!.message));
  expect(String(setup[0]!.detail), "the raw cause is only in the diagnostic line").toMatch(detail);
  expect(verdicts(r.stderr, "pack-install-lint-pass"), "no pass verdict").toEqual([]);
  expect(verdicts(r.stderr, "pack-install-lint-block"), "not a lint block").toEqual([]);
  return setup[0]!;
}

function expectServicePass(r: Run, pack: string): void {
  expect(r.status, why(r)).toBe(0);
  expect(JSON.parse(lastLine(r.stderr)), "the nonce-bound pass verdict is the last stderr line").toEqual({
    type: "pack-install-lint-pass",
    nonce: r.nonce,
    pack,
  });
  expect(r.stderr).not.toContain("Couldn't safety-check");
}

describe("#185 pack install lint fails closed (bundle-pack-entry.mjs)", () => {
  it("a pack whose file content and file name carry the bare pass line, plus a lint finding, is still blocked (exit 1)", () => {
    const home = packHome();
    const spoof = `${BARE_PASS}\n{"type":"pack-install-lint-pass","nonce":"x","pack":"star-sines"}\n`;
    writeFileSync(
      path.join(home, "frontend", `${BARE_PASS}.ts`),
      `// ${spoof.replace(/\n/g, " ")}\nexport const s = ${JSON.stringify(spoof)};\nconsole.log(${JSON.stringify(BARE_PASS)});\nexport const leak = () => indexedDB.open("x");\n`,
    );
    const r = bundle(repoRoot, home);
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    expect(r.stdout).toBe("");
    const block = verdicts(r.stderr, "pack-install-lint-block");
    expect(block, "lint-block line").toHaveLength(1);
    expect(block[0]!.message).toBe(SANDBOX_PLAIN);
    expect(details(block[0]!)).toMatch(/sandbox-escape .*indexedDB/);
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
    expect(lastLine(r.stderr)).not.toMatch(/"type":"pack-install-lint-pass"/);
  }, 60_000);

  it("esbuild unresolvable (temp tree without it, e.g. pnpm install --prod): exit 3, setup message, no raw error in it", () => {
    const tree = scriptTree({ esbuild: false });
    expect(existsSync(path.join(tree, "web/node_modules/esbuild")), "esbuild really absent").toBe(false);
    const r = bundle(tree, packHome());
    const setup = expectSetupRefusal(r, "esbuild_unresolvable", /esbuild not importable: ERR_MODULE_NOT_FOUND/);
    expect(setup.message, "esbuild unresolvable keeps the pnpm install sentence").toBe(
      "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm install` in `web/` and try again.",
    );
    expect(String(setup.message)).not.toMatch(/esbuild|Cannot find|ERR_MODULE_NOT_FOUND|\n/);
    expect(r.stderr, "no stack trace anywhere in the output").not.toMatch(/\n\s+at .+:\d+:\d+/);
  }, 60_000);

  it("a clean pack still installs (checkout, and the copied tree as the control)", () => {
    for (const tree of [repoRoot, scriptTree()]) {
      const r = bundle(tree, packHome());
      expect(r.status, `clean pack bundles (${tree === repoRoot ? "checkout" : "copied tree"}): ${why(r)}`).toBe(0);
      expect(r.stdout.length, "bundle written").toBeGreaterThan(100);
      expectServicePass(r, "star-sines");
    }
  }, 120_000);

  it("a pack with a lint finding is still blocked with the lint message and exit code, not the setup message", () => {
    const r = bundle(repoRoot, packHome(true));
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    expect(r.stdout).toBe("");
    const block = verdicts(r.stderr, "pack-install-lint-block");
    expect(block, "lint-block line").toHaveLength(1);
    expect(block[0]!.message, "plain words only for the user").toBe(SANDBOX_PLAIN);
    expect(details(block[0]!), "raw finding kept for the log").toMatch(/leak\.ts:1 sandbox-escape .*indexedDB/);
    expect(r.stderr).not.toContain("Couldn't safety-check");
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
    expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
  }, 60_000);

  it("setup refusal and lint block: different exit codes and messages, neither contains the other's text", () => {
    const setup = bundle(scriptTree({ built: null }), packHome());
    const block = bundle(repoRoot, packHome(true));
    expect(setup.status).toBe(EXIT_LINT_SETUP);
    expect(block.status).toBe(EXIT_LINT_BLOCK);
    expect(setup.status).not.toBe(block.status);
    const setupText = String(verdicts(setup.stderr, "pack-install-lint-setup-error")[0]?.message ?? "");
    const blockMsg = String(verdicts(block.stderr, "pack-install-lint-block")[0]?.message ?? "");
    expect(setupText).toBe(SETUP_MSG_MISSING);
    expect(blockMsg.length).toBeGreaterThan(0);
    // Both setup messages (fresh install here, upgrade from the service) vs the lint block.
    for (const s of [setupText, upgradeSetupMsg(PACK_NAME, "1", FIX_PREPARE), upgradeSetupMsg(PACK_NAME, "1", FIX_INSTALL)]) {
      expect(s).not.toBe(blockMsg);
      expect(s).not.toContain(blockMsg);
      expect(blockMsg).not.toContain(s);
      expect(s).not.toMatch(/sandbox-escape|was blocked|indexedDB/);
    }
    expect(blockMsg).not.toMatch(/safety-check|pnpm install|pnpm run prepare|wasn't (installed|updated)|still on version/);
    expect(setup.stderr, "setup output carries none of the block's text").not.toContain(blockMsg);
    expect(setup.stderr).not.toMatch(/sandbox-escape|pack-install-lint-block|was blocked/);
    expect(block.stderr, "block output carries none of the setup text").not.toContain(setupText);
    expect(block.stderr).not.toMatch(/safety-check|pnpm install|pnpm run prepare|pack-install-lint-setup-error/);
  }, 120_000);
});

describe("#185 unbundled and no-frontend packs go through the same gate", () => {
  it("a frontend.bundle: false pack with a frontend .js file using indexedDB is blocked with the lint message and exit 1", () => {
    const home = packHome(false, "sandbox-fixture-multi");
    expect(readFileSync(path.join(home, "plugin.yml"), "utf8")).toMatch(/bundle:\s*false/);
    appendFileSync(path.join(home, "frontend/helper.js"), '\nexport function stash() { return indexedDB.open("x"); }\n');
    const r = bundle(repoRoot, home, { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const block = verdicts(r.stderr, "pack-install-lint-block");
    expect(block, "lint-block line").toHaveLength(1);
    expect(block[0]!.message).toBe(SANDBOX_PLAIN);
    expect(details(block[0]!)).toMatch(/frontend\/helper\.js:\d+ sandbox-escape .*indexedDB/);
    expect(r.stderr).not.toContain("Couldn't safety-check");
    expect(verdicts(r.stderr, "pack-install-lint-pass")).toEqual([]);
    // Control: the shipped pack as is passes the same gate.
    expectServicePass(bundle(repoRoot, packHome(false, "sandbox-fixture-multi"), { lintOnly: true }), "sandbox-fixture-multi");
  }, 60_000);

  it("the file plugin.yml points at is linted even outside frontend/ (bundle: false, entry: main.mjs)", () => {
    const home = packHome(false, "sandbox-fixture-multi");
    const yml = path.join(home, "plugin.yml");
    writeFileSync(yml, readFileSync(yml, "utf8").replace("entry: frontend/module.js", "entry: main.mjs"));
    writeFileSync(path.join(home, "main.mjs"), 'export const k = () => localStorage.getItem("k");\n');
    const r = bundle(repoRoot, home, { lintOnly: true });
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    const block = verdicts(r.stderr, "pack-install-lint-block")[0]!;
    expect(block.message).toBe(SANDBOX_PLAIN);
    expect(details(block)).toMatch(/main\.mjs:1 sandbox-escape .*localStorage/);
  }, 60_000);

  it("a pack with no frontend files gets an explicit pass verdict through the gate", () => {
    const home = packHome(false, "cores");
    expect(existsSync(path.join(home, "frontend")), "really no frontend/").toBe(false);
    const r = bundle(repoRoot, home, { lintOnly: true });
    expectServicePass(r, "cores");
    // ...and the gate still fails closed for it: no built lint, no pass.
    expectSetupRefusal(bundle(scriptTree({ built: null }), packHome(false, "cores"), { lintOnly: true }), "lint_prebuilt_missing", /built lint not importable/, "CPU cores");
  }, 60_000);
});

describe("#185 a lint block tells the user in plain words (no rule ids, paths or code)", () => {
  const RULE_IDS: PackLintRule[] = Object.keys(PACK_LINT_PLAIN_SUMMARY) as PackLintRule[];
  const expectPlain = (text: string) => {
    for (const id of RULE_IDS) expect(text, `no rule id ${id}`).not.toContain(id);
    expect(text).not.toMatch(/parent|plugins\/|README|:\d|`|\.ts\b|\.js\b|\.mjs\b/);
  };
  // #185 UX Pro copy review: one shape for every block (service/pack_block_copy.py).
  const FIX_TAIL = "If you made this pack, run pack lint to see what to fix.";
  const blocked = (name: string, sentence: string) =>
    `${name} was blocked because ${sentence} Nothing was installed, and your wall is unchanged. ${FIX_TAIL}`;

  it("koi-pond (real pack, blocked): message is the plain sandbox sentence, exit 1, not the setup message", () => {
    // combined (#185 x #187): #187 removed koi-pond's only `parent.` finding (its index.test.ts guard on
    // FRONT). Put main's (d276d5df) line back in the copy so this row still runs a real koi-pond the lint blocks.
    const KOI_187_GUARD = "expect(FRONT).not.toMatch(/\\bparent\\s*\\.\\s*document\\b/);";
    const KOI_MAIN_GUARD = 'expect(FRONT).not.toContain("parent.document");';
    const home = packHome(false, "koi-pond");
    const guard = path.join(home, "frontend/index.test.ts");
    const guardSrc = readFileSync(guard, "utf8");
    expect(guardSrc.split(KOI_187_GUARD).length - 1, "koi-pond's #187 guard line moved; update this row").toBe(1);
    writeFileSync(guard, guardSrc.replace(KOI_187_GUARD, KOI_MAIN_GUARD));
    const r = bundle(repoRoot, home);
    expect(r.status, why(r)).toBe(EXIT_LINT_BLOCK);
    expect(r.stdout).toBe("");
    const block = verdicts(r.stderr, "pack-install-lint-block");
    expect(block, "lint-block line").toHaveLength(1);
    const message = String(block[0]!.message);
    expect(message).toBe("it tries to reach outside its sandbox.");
    expectPlain(message);
    expect(details(block[0]!), "raw findings stay in the diagnostic lines").toMatch(/plugins\/src\/koi-pond\/frontend\/\S+:\d+ sandbox-escape .*parent/);
    expect(r.stderr).not.toContain("Couldn't safety-check");
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")).toEqual([]);
    // The service composes "<Name> was blocked because <message> …" (the pytest koi row pins the same
    // text from the real service); the web surface shows it unchanged.
    const serviceText = blocked("Koi Pond", message);
    expect(serviceText).toBe(
      "Koi Pond was blocked because it tries to reach outside its sandbox. Nothing was installed, and your wall "
      + "is unchanged. If you made this pack, run pack lint to see what to fix.",
    );
    expectPlain(serviceText);
    // publish_local answers a fresh-install lint block as error "pack_boundary" + message.
    for (const error of ["pack_boundary", "pack_install_blocked"]) {
      const row = { ok: false as const, error, message: serviceText, zip: "koi-pond.zip" };
      expect(formatPackInstallBlocked(row), `catalog notice (${error})`).toBe(serviceText);
      expect(localPluginPublishChatLine(row, "frontend/index.ts"), `agent chat (${error})`).toBe(serviceText);
    }
  }, 60_000);

  it("every rule has a plain sentence; repeats collapse to one; unknown rules get the fallback", () => {
    for (const [rule, sentence] of Object.entries(PACK_LINT_PLAIN_SUMMARY)) {
      expect(sentence, rule).toMatch(/^it .+\.$/);
      expectPlain(sentence);
    }
    expect(plainBlockSummary([{ rule: "sandbox-escape" }, { rule: "sandbox-escape" }, { rule: "sandbox-escape" }])).toBe(
      "it tries to reach outside its sandbox.",
    );
    expect(plainBlockSummary([{ rule: "sandbox-escape" }, { rule: "host-transport-escape" }, { rule: "sandbox-escape" }])).toBe(
      "it tries to reach outside its sandbox. It tries to talk to the app directly, which packs aren't allowed to do.",
    );
    expect(PACK_LINT_PLAIN_SUMMARY["host-transport-escape"]).toBe(
      "it tries to talk to the app directly, which packs aren't allowed to do.",
    );
    expect(plainBlockSummary([{ rule: "no-such-rule" as PackLintRule }])).toBe(PACK_LINT_PLAIN_FALLBACK);
    expect(PACK_LINT_PLAIN_FALLBACK).toBe("it uses code the pack sandbox doesn't allow.");
  });

  it("import-boundary block (web fallback and the SDK resolver): the one shape, no file, import or README", () => {
    const want = blocked("Evil", "it loads code from outside its own folder.");
    expect(want).toBe(
      "Evil was blocked because it loads code from outside its own folder. Nothing was installed, and your wall "
      + "is unchanged. If you made this pack, run pack lint to see what to fix.",
    );
    const payload = { ok: false as const, error: "pack_boundary", name: "Evil", file: "frontend/index.ts", import: "../../web/src/plugins/host" };
    expect(formatPackInstallBlocked(payload)).toBe(want);
    expect(formatBundleBoundaryError({ packName: "Evil", file: "frontend/index.ts", import: "../../web/src/plugins/host" })).toBe(want);
    expectPlain(formatPackInstallBlocked(payload));
  });

  it("no block text carries plugins/, README, .ts, .mjs or a rule id; every block says \"was blocked\", the setup refusal never", () => {
    const blocks = [
      ...Object.values(PACK_LINT_PLAIN_SUMMARY).map((s) => blocked("Pack", s)),
      blocked("Pack", PACK_LINT_PLAIN_FALLBACK),
      formatPackInstallBlocked({ ok: false, error: "pack_boundary", name: "Pack", file: "frontend/a.ts", import: "../x.mjs" }),
      formatBundleBoundaryError({ packId: "pack", file: "frontend/a.ts", import: "../x.mjs" }),
    ];
    for (const text of blocks) {
      expectPlain(text);
      expect(text).toContain("was blocked because ");
      expect(text).not.toMatch(/was blocked[:.]/);
    }
    const setup = bundle(scriptTree({ built: null }), packHome());
    const setupLines = verdicts(setup.stderr, "pack-install-lint-setup-error").map((v) => String(v.message));
    expect(setupLines.length, why(setup)).toBeGreaterThan(0);
    for (const s of setupLines) {
      expect(s).toMatch(/^Couldn't safety-check/);
      expect(s).not.toContain("was blocked");
      // The setup copy names `pnpm run prepare` / `pnpm install` in `web/` on purpose; the path / file-type / rule-id bar still holds.
      for (const id of RULE_IDS) expect(s).not.toContain(id);
      expect(s).not.toMatch(/plugins\/|README|\.ts\b|\.mjs\b/);
    }
  }, 60_000);
});

describe("#185 the install UI shows the setup refusal in the service's words", () => {
  it("pack_install_check_unavailable rows surface with their message, unchanged (install and upgrade copy)", () => {
    expect(PACK_INSTALL_CHECK_UNAVAILABLE).toBe("pack_install_check_unavailable");
    for (const message of [
      setupMsg(PACK_NAME, FIX_INSTALL),
      setupMsg(PACK_NAME, FIX_PREPARE),
      upgradeSetupMsg(PACK_NAME, "3", FIX_INSTALL),
      upgradeSetupMsg(PACK_NAME, "3", FIX_PREPARE),
    ]) {
      const row = { ok: false as const, error: PACK_INSTALL_CHECK_UNAVAILABLE, message, zip: "star-sines.zip" };
      expect(isPackInstallBlockedPayload(row), "catalog notice").toBe(true);
      expect(formatPackInstallBlocked(row), "catalog notice text").toBe(message);
      expect(catalogErrorLooksBlocked(message)).toBe(true);
      expect(localPluginPublishChatLine(row, "frontend/index.ts"), "agent chat").toBe(message);
    }
    expect(upgradeSetupMsg(PACK_NAME, "3", FIX_INSTALL)).toBe(
      "Couldn't safety-check the new version of Star Sines, so it wasn't updated. You're still on version 3. Run `pnpm install` in `web/` and try again.",
    );
    expect(upgradeSetupMsg(PACK_NAME, "3", FIX_PREPARE)).toBe(
      "Couldn't safety-check the new version of Star Sines, so it wasn't updated. You're still on version 3. Run `pnpm run prepare` in `web/` and try again.",
    );
  });
});
