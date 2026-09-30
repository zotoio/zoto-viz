/**
 * #185: the pack install lint fails closed.
 *
 * bundle-pack-entry.mjs runs the blocking install lint (web/scripts/pack-install-lint-run.ts under
 * tsx, via pack-install-lint-gate.mjs) when ZOTO_PACK_INSTALL_LINT=1 (bundled packs) or with
 * --lint-only (`frontend.bundle: false` and no-frontend packs), as the service's install path does.
 * It used to run it only if web/node_modules/tsx/dist/cli.mjs existed and silently install
 * otherwise; tsx wasn't declared anywhere, so a clean `pnpm install` skipped the lint at every real
 * install. Unbundled and no-frontend packs skipped it entirely.
 *
 * The install goes ahead only when the runner's LAST stdout line is exactly
 * {"type":"pack-install-lint-pass","nonce":<per-run nonce>,"pack":<id>} with exit 0. A real finding
 * is exit 1 with the lint message. Everything else is exit 3 with the setup message.
 *
 * Every row runs the real bundle-pack-entry.mjs as a child process. The refusal rows use a temp
 * copy of the tree the script needs (web/scripts, web/package.json, esbuild, plugins/sdk) so the
 * runner / esbuild is really unresolvable or really misbehaves; no test-only switch. The timeout
 * row uses the script's real --lint-timeout-ms option.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  catalogErrorLooksBlocked,
  formatPackInstallBlocked,
  isPackInstallBlockedPayload,
  localPluginPublishChatLine,
  PACK_INSTALL_CHECK_UNAVAILABLE,
} from "./pack-install-surface";
import { PACK_LINT_PLAIN_FALLBACK, PACK_LINT_PLAIN_SUMMARY, plainBlockSummary } from "../../../plugins/sdk/pack-lint-hints";
import type { PackLintRule } from "../../../plugins/sdk/pack-lint-types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "web");
const sdkRoot = path.join(repoRoot, "plugins/sdk");
const PACK_NAME = "Star Sines";
const setupMsg = (name: string) =>
  `Couldn't safety-check ${name}, so it wasn't installed. Run \`pnpm install\` in \`web/\` and try again.`;
const SETUP_MSG = setupMsg(PACK_NAME);
/** UX Pro's upgrade copy (the service builds it; it knows the installed version). */
const upgradeSetupMsg = (name: string, old: string) =>
  `Couldn't safety-check the new version of ${name}, so it wasn't updated. You're still on v${old}. Run \`pnpm install\` in \`web/\` and try again.`;
const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const BARE_PASS = '{"type":"pack-install-lint-pass"}';
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
 * The tree bundle-pack-entry.mjs needs, copied: its scripts, web/package.json, esbuild, the SDK.
 * `tsx` / `esbuild` link the real packages in (or leave them out); `runner` replaces the lint
 * runner's source (null: no runner file).
 */
function scriptTree(opts: { tsx: boolean; esbuild?: boolean; runner?: string | null }): string {
  const root = tmp(opts.tsx ? "tree-tsx" : "tree-no-tsx");
  mkdirSync(path.join(root, "web/scripts"), { recursive: true });
  mkdirSync(path.join(root, "web/node_modules"), { recursive: true });
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  for (const f of ["bundle-pack-entry.mjs", "pack-install-lint-gate.mjs"]) {
    cpSync(path.join(webRoot, "scripts", f), path.join(root, "web/scripts", f));
  }
  cpSync(path.join(webRoot, "package.json"), path.join(root, "web/package.json"));
  const runner = path.join(root, "web/scripts/pack-install-lint-run.ts");
  if (opts.runner === undefined) cpSync(path.join(webRoot, "scripts/pack-install-lint-run.ts"), runner);
  else if (opts.runner !== null) writeFileSync(runner, opts.runner);
  if (opts.esbuild !== false) {
    symlinkSync(realpathSync(path.join(webRoot, "node_modules/esbuild")), path.join(root, "web/node_modules/esbuild"), "dir");
  }
  if (opts.tsx) symlinkSync(realpathSync(path.join(webRoot, "node_modules/tsx")), path.join(root, "web/node_modules/tsx"), "dir");
  symlinkSync(sdkRoot, path.join(root, "plugins/sdk"), "dir");
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

function expectSetupRefusal(r: SpawnSyncReturns<string>, detail: RegExp, name = PACK_NAME): Record<string, unknown> {
  expect(r.status, `refused with the setup exit, not installed: ${why(r)}`).toBe(EXIT_LINT_SETUP);
  expect(r.stdout, "no bundle written").toBe("");
  expect(r.stderr, "setup message").toContain(setupMsg(name));
  const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
  expect(setup, "one setup-error line").toHaveLength(1);
  expect(setup[0]!.message).toBe(setupMsg(name));
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    expect((e as NodeJS.ErrnoException).code, `pid ${pid} is gone (ESRCH), not just not ours`).toBe("ESRCH");
    return false;
  }
}

/** A fake runner that prints `lines` to stdout (argv: packHome repoRoot packId nonce) and exits 0. */
function printingRunner(body: string): string {
  return `const [, , , , pack, nonce] = process.argv;\n${body}\nprocess.exit(0);\n`;
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
    expectSetupRefusal(r, /ended before a verdict \(exit 1\)/);
    expect(r.stderr, "the crash is still in the log").toContain("lint runner crashed (#185 row)");
  }, 60_000);

  it("a runner killed by a signal: exit 3, and the user message has no exit code or signal name", () => {
    const r = bundle(scriptTree({ tsx: true, runner: 'process.kill(process.pid, "SIGKILL");\n' }), packHome());
    // tsx runs the script in a child and relays a signal death as 128 + n; either form is a refusal.
    const setup = expectSetupRefusal(r, /killed by SIGKILL|ended before a verdict \(exit 137\)/);
    expect(String(setup.message)).not.toMatch(/137|SIGKILL|signal|killed/i);
    expect(r.stderr.split(/\r?\n/)[0], "first stderr line is the user message").toBe(SETUP_MSG);
  }, 60_000);

  it("a runner that exits 0 but prints no verdict: refused with the setup message", () => {
    expectSetupRefusal(
      bundle(scriptTree({ tsx: true, runner: "process.exit(0);\n" }), packHome()),
      /exited 0 without a valid pass verdict/,
    );
  }, 60_000);

  it("a runner that prints a pass line with the wrong nonce (or none): exit 3", () => {
    const wrong = printingRunner('console.log(JSON.stringify({ type: "pack-install-lint-pass", nonce: "not-the-nonce", pack }));');
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: wrong }), packHome()), /without a valid pass verdict/);
    const bare = printingRunner(`console.log(${JSON.stringify(BARE_PASS)});`);
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: bare }), packHome()), /without a valid pass verdict/);
    const otherPack = printingRunner('console.log(JSON.stringify({ type: "pack-install-lint-pass", nonce, pack: "other-pack" }));');
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: otherPack }), packHome()), /without a valid pass verdict/);
  }, 120_000);

  it("a runner that prints the correct pass line followed by more output: exit 3 (only the last line counts)", () => {
    const trailing = printingRunner(
      'console.log(JSON.stringify({ type: "pack-install-lint-pass", nonce, pack }));\nconsole.log("lint done");',
    );
    expectSetupRefusal(bundle(scriptTree({ tsx: true, runner: trailing }), packHome()), /without a valid pass verdict/);
    // Control: the same runner without the trailing line passes, so the nonce/pack plumbing is real.
    const exact = printingRunner('console.log(JSON.stringify({ type: "pack-install-lint-pass", nonce, pack }));');
    expectServicePass(bundle(scriptTree({ tsx: true, runner: exact }), packHome()), "star-sines");
  }, 120_000);

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

  it("a runner that hangs is killed at the timeout (--lint-timeout-ms=2000): exit 3, setup message, no orphan left", () => {
    // Short, but above tsx's cold start (~0.3 s idle, ~1 s under a loaded suite) so the runner is
    // really running and hung when the timeout fires; 300 ms fired before the runner existed.
    const HANG_TIMEOUT_MS = 2000;
    const pidFile = path.join(tmp("pids"), "runner.pids");
    const hang = [
      'import { appendFileSync } from "node:fs";',
      'process.on("SIGTERM", () => {}); // only a group SIGKILL gets rid of it',
      "appendFileSync(process.env.ZV185_PIDFILE!, `${process.pid} ${process.ppid}\\n`);",
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n");
    const t0 = Date.now();
    const r = bundle(scriptTree({ tsx: true, runner: hang }), packHome(), {
      flags: [`--lint-timeout-ms=${HANG_TIMEOUT_MS}`],
      env: { ZV185_PIDFILE: pidFile },
      timeoutMs: 20_000,
    });
    const elapsed = Date.now() - t0;
    expectSetupRefusal(r, new RegExp(`timed out after ${HANG_TIMEOUT_MS} ms`));
    expect(elapsed, "refused at the short timeout, not the 15 s default").toBeLessThan(12_000);
    expect(existsSync(pidFile), "the runner really started and hung (tsx starts in ~0.3-1 s here)").toBe(true);
    const [child, tsxParent] = readFileSync(pidFile, "utf8").trim().split(/\s+/).map(Number);
    expect(child).toBeGreaterThan(0);
    expect(alive(child!), `hung runner ${child} was killed`).toBe(false);
    expect(alive(tsxParent!), `tsx parent ${tsxParent} was killed`).toBe(false);
  }, 30_000);

  it("esbuild unresolvable (temp tree without it, e.g. pnpm install --prod): exit 3, setup message, no raw error in it", () => {
    const tree = scriptTree({ tsx: true, esbuild: false });
    expect(existsSync(path.join(tree, "web/node_modules/esbuild")), "esbuild really absent").toBe(false);
    const r = bundle(tree, packHome());
    const setup = expectSetupRefusal(r, /esbuild not importable: ERR_MODULE_NOT_FOUND/);
    expect(String(setup.message)).not.toMatch(/esbuild|Cannot find|ERR_MODULE_NOT_FOUND|\n/);
    expect(r.stderr, "no stack trace anywhere in the output").not.toMatch(/\n\s+at .+:\d+:\d+/);
  }, 60_000);

  it("a clean pack still installs (checkout, and the copied tree with tsx as the control)", () => {
    for (const tree of [repoRoot, scriptTree({ tsx: true })]) {
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
    const setup = bundle(scriptTree({ tsx: false }), packHome());
    const block = bundle(repoRoot, packHome(true));
    expect(setup.status).toBe(EXIT_LINT_SETUP);
    expect(block.status).toBe(EXIT_LINT_BLOCK);
    expect(setup.status).not.toBe(block.status);
    const setupText = String(verdicts(setup.stderr, "pack-install-lint-setup-error")[0]?.message ?? "");
    const blockMsg = String(verdicts(block.stderr, "pack-install-lint-block")[0]?.message ?? "");
    expect(setupText).toBe(SETUP_MSG);
    expect(blockMsg.length).toBeGreaterThan(0);
    // Both setup messages (fresh install here, upgrade from the service) vs the lint block.
    for (const s of [setupText, upgradeSetupMsg(PACK_NAME, "1")]) {
      expect(s).not.toBe(blockMsg);
      expect(s).not.toContain(blockMsg);
      expect(blockMsg).not.toContain(s);
      expect(s).not.toMatch(/sandbox-escape|was blocked|indexedDB/);
    }
    expect(blockMsg).not.toMatch(/safety-check|pnpm install|wasn't (installed|updated)|still on v/);
    expect(setup.stderr, "setup output carries none of the block's text").not.toContain(blockMsg);
    expect(setup.stderr).not.toMatch(/sandbox-escape|pack-install-lint-block|was blocked/);
    expect(block.stderr, "block output carries none of the setup text").not.toContain(setupText);
    expect(block.stderr).not.toMatch(/safety-check|pnpm install|pack-install-lint-setup-error/);
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
    // ...and the gate still fails closed for it: no runner, no pass.
    expectSetupRefusal(bundle(scriptTree({ tsx: false }), packHome(false, "cores"), { lintOnly: true }), /tsx not resolvable/, "CPU cores");
  }, 60_000);
});

describe("#185 a lint block tells the user in plain words (no rule ids, paths or code)", () => {
  const RULE_IDS: PackLintRule[] = Object.keys(PACK_LINT_PLAIN_SUMMARY) as PackLintRule[];
  const expectPlain = (text: string) => {
    for (const id of RULE_IDS) expect(text, `no rule id ${id}`).not.toContain(id);
    expect(text).not.toMatch(/parent|plugins\/src|:\d|`|\.ts\b|\.js\b/);
  };

  it("koi-pond (real pack, blocked): message is the plain sandbox sentence, exit 1, not the setup message", () => {
    const r = bundle(repoRoot, packHome(false, "koi-pond"));
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
    // The service composes "<Name> was blocked: <message> …"; the web surface shows it unchanged.
    const serviceText = `Koi Pond was blocked: ${message} Nothing was installed and the current wall is unchanged. `
      + "Ask the pack author to run pack lint — see plugins/sdk/starter/README.md#2-pack-lint.";
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
      "it tries to reach outside its sandbox. It tries to talk to the app directly instead of through the pack SDK.",
    );
    expect(plainBlockSummary([{ rule: "no-such-rule" as PackLintRule }])).toBe(PACK_LINT_PLAIN_FALLBACK);
    expect(PACK_LINT_PLAIN_FALLBACK).toBe("it uses code the pack sandbox doesn't allow.");
  });
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
  it("pack_install_check_unavailable rows surface with their message, unchanged (install and upgrade copy)", () => {
    expect(PACK_INSTALL_CHECK_UNAVAILABLE).toBe("pack_install_check_unavailable");
    for (const message of [SETUP_MSG, upgradeSetupMsg(PACK_NAME, "3")]) {
      const row = { ok: false as const, error: PACK_INSTALL_CHECK_UNAVAILABLE, message, zip: "star-sines.zip" };
      expect(isPackInstallBlockedPayload(row), "catalog notice").toBe(true);
      expect(formatPackInstallBlocked(row), "catalog notice text").toBe(message);
      expect(catalogErrorLooksBlocked(message)).toBe(true);
      expect(localPluginPublishChatLine({ ok: false, ...row }, "frontend/index.ts"), "agent chat").toBe(message);
    }
    expect(upgradeSetupMsg(PACK_NAME, "3")).toBe(
      "Couldn't safety-check the new version of Star Sines, so it wasn't updated. You're still on v3. Run `pnpm install` in `web/` and try again.",
    );
  });
});
