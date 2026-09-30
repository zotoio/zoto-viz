/**
 * #186 lint_timeout: bundle-pack-entry.mjs runs the install lint in a worker_thread and bounds the
 * whole lint-mode run (lint, then esbuild) with its own timer, shorter than the service's
 * PACK_BUNDLE_TIMEOUT_S (20 s, still the backstop). On that timeout it writes the lint_timeout refusal,
 * takes its process group down if (and only if) it leads it, and exits 3. So a service that dies while
 * the lint spins (QE's revert R13: `node -e setInterval...` left running) leaves nothing behind.
 *
 * Every row runs the real script from a temp copy of web/scripts, started the way the service starts
 * it (its own process group) by a stand-in parent. ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS shortens the
 * timer (it can only shorten it). Process groups are read from /proc (Linux); zombies don't count.
 * Every row's teardown SIGKILLs the groups it started, so a red run leaves no orphan. The service side
 * (reason code and sentence, fresh and upgrade) is tests/test_pack_install_lint_timeout.py.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const webRoot = path.join(repoRoot, "web");
const BUILT = "pack-install-lint.built.mjs";
const BUILT_PATH = path.join(webRoot, "scripts", BUILT);
const PACK_NAME = "Star Sines";
const EXIT_LINT_SETUP = 3;
/** UX Pro's lint_timeout sentence (web/scripts/pack-install-lint-setup-copy.json, pinned as a literal). */
const TIMEOUT_MSG = (name: string) =>
  `Couldn't safety-check ${name} in time, so it wasn't installed. Try again, and if it keeps happening, the pack may be broken.`;
/** The inner timer the rows run with, and how long past it a group may take to go. */
const INNER_MS = 1500;
const MARGIN_MS = 5000;
const STEP_MS = 50;
/** The esbuild row's lint must finish first (a real lint of a real pack), so it gets a longer timer. */
const ESBUILD_INNER_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const tmpRoots: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `zv186t-${prefix}-`));
  tmpRoots.push(d);
  return d;
}

/** Process groups and pids a row started: SIGKILLed in teardown whatever the row's outcome. */
const groups = new Set<number>();
const pids = new Set<number>();
function killQuietly(target: number): void {
  try {
    process.kill(target, "SIGKILL");
  } catch {
    /* gone already */
  }
}
afterEach(() => {
  for (const g of groups) killQuietly(-g);
  for (const p of pids) killQuietly(p);
  groups.clear();
  pids.clear();
});
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

type Proc = { pid: number; state: string; pgrp: number; cmd: string };
function procStat(name: string): Proc | null {
  try {
    const stat = readFileSync(`/proc/${name}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const cmd = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").join(" ").trim();
    return { pid: Number(name), state: f[0] ?? "", pgrp: Number(f[2]), cmd };
  } catch {
    return null;
  }
}
/** Live (non-zombie) members of process group `pgrp`. */
function groupMembers(pgrp: number): Proc[] {
  return readdirSync("/proc")
    .filter((n) => /^\d+$/.test(n))
    .map(procStat)
    .filter((p): p is Proc => p !== null && p.pgrp === pgrp && p.state !== "Z");
}
const describeMembers = (m: Proc[]) => m.map((p) => `${p.pid} [${p.state}] ${p.cmd.slice(0, 120)}`).join("; ");

/** Poll (bounded by a step count, not a clock) until group `pgrp` is empty; returns what's left. */
async function groupAfter(pgrp: number, withinMs: number): Promise<Proc[]> {
  let left = groupMembers(pgrp);
  for (let i = 0; i < Math.ceil(withinMs / STEP_MS) && left.length > 0; i++) {
    await sleep(STEP_MS);
    left = groupMembers(pgrp);
  }
  return left;
}

/** Poll (step count) until `file` exists; false if it never does. */
async function fileAppears(file: string, withinMs: number): Promise<boolean> {
  for (let i = 0; i < Math.ceil(withinMs / STEP_MS); i++) {
    if (existsSync(file)) return true;
    await sleep(STEP_MS);
  }
  return existsSync(file);
}

type Exit = { code: number | null; signal: NodeJS.Signals | null; capped: boolean; stdout: string; stderr: string };
/** Collect a child's output and wait for its exit; after `capMs` SIGKILL its group and report `capped`. */
function exited(child: ChildProcess, capMs: number, group: number): Promise<Exit> {
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr?.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  return new Promise((resolve) => {
    let capped = false;
    const cap = setTimeout(() => {
      capped = true;
      killQuietly(-group);
      killQuietly(child.pid ?? 0);
    }, capMs);
    child.on("close", (code, signal) => {
      clearTimeout(cap);
      resolve({ code, signal, capped, stdout, stderr });
    });
  });
}

/** Real stamp (so only the body differs) plus `body`, as the built lint. */
function fakeBuilt(body: string): string {
  const src = readFileSync(BUILT_PATH, "utf8");
  const m = /^export const PACK_INSTALL_LINT_BUILD = (\{.*?\});\s*$/ms.exec(src);
  if (!m) throw new Error("PACK_INSTALL_LINT_BUILD footer not found");
  return `${body}\nexport const PACK_INSTALL_LINT_BUILD = ${m[1]};\n`;
}

/**
 * A lint that spins in plain JS (QE's R13): it starts a `setInterval` child of its own, records both
 * pids, then busy-loops, so no timer on its thread could ever fire.
 */
function spinningLint(pidFile: string, withChild = true): string {
  return fakeBuilt(
    [
      'import { spawn } from "node:child_process";',
      'import { appendFileSync } from "node:fs";',
      "export function runPackInstallLint() {",
      withChild
        ? '  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });'
        : "  const c = { pid: 0 };",
      `  appendFileSync(${JSON.stringify(pidFile)}, \`\${process.pid} \${c.pid}\\n\`);`,
      "  for (;;) {}",
      "}",
    ].join("\n"),
  );
}

/**
 * An esbuild that hangs while it works: the real esbuild (its `--service` child really running) with a
 * first onLoad that never settles; it writes `markFile` when esbuild reaches it. A test fixture in the
 * temp tree, nothing in the script: a hang can only end in a refusal (no bundle, no pass line).
 */
function hangingEsbuild(dir: string, markFile: string): void {
  const real = realpathSync(path.join(webRoot, "node_modules/esbuild"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "esbuild", type: "module", exports: "./index.js" }));
  writeFileSync(
    path.join(dir, "index.js"),
    [
      'import { appendFileSync } from "node:fs";',
      `import real from ${JSON.stringify(pathToFileURL(path.join(real, "lib/main.js")).href)};`,
      "export const version = real.version;",
      "const hang = {",
      '  name: "hang-while-bundling (#186 row)",',
      "  setup(b) {",
      "    b.onLoad({ filter: /.*/ }, () => {",
      `      appendFileSync(${JSON.stringify(markFile)}, "esbuild working\\n");`,
      "      return new Promise(() => {});",
      "    });",
      "  },",
      "};",
      "export function build(opts) {",
      "  return real.build({ ...opts, plugins: [hang, ...(opts.plugins ?? [])] });",
      "}",
    ].join("\n"),
  );
}

/** A copy of web/scripts, web/package.json, esbuild (real, or the hanging one) and plugins/sdk (linked). */
function scriptTree(opts: { built?: string; esbuildMark?: string } = {}): string {
  const root = tmp("tree");
  mkdirSync(path.join(root, "web/scripts"), { recursive: true });
  mkdirSync(path.join(root, "web/node_modules"), { recursive: true });
  mkdirSync(path.join(root, "plugins"), { recursive: true });
  for (const ent of readdirSync(path.join(webRoot, "scripts"), { withFileTypes: true })) {
    if (ent.isFile()) cpSync(path.join(webRoot, "scripts", ent.name), path.join(root, "web/scripts", ent.name));
  }
  if (typeof opts.built === "string") writeFileSync(path.join(root, "web/scripts", BUILT), opts.built);
  cpSync(path.join(webRoot, "package.json"), path.join(root, "web/package.json"));
  const esbuildDir = path.join(root, "web/node_modules/esbuild");
  if (opts.esbuildMark) hangingEsbuild(esbuildDir, opts.esbuildMark);
  else symlinkSync(realpathSync(path.join(webRoot, "node_modules/esbuild")), esbuildDir, "dir");
  symlinkSync(path.join(repoRoot, "plugins/sdk"), path.join(root, "plugins/sdk"), "dir");
  return root;
}

function packHome(): string {
  const home = path.join(tmp("pack"), "star-sines");
  cpSync(path.join(repoRoot, "plugins/src/star-sines"), home, { recursive: true });
  return home;
}

/** The service's argv (bundle mode) and env, with the inner timer shortened to `innerMs`. */
function scriptArgs(tree: string, home: string, innerMs: number): { argv: string[]; env: NodeJS.ProcessEnv } {
  return {
    argv: [path.join(tree, "web/scripts/bundle-pack-entry.mjs"), path.join(home, "frontend/index.ts"), path.join(tree, "plugins/sdk"), home, tree],
    env: {
      ...process.env,
      ZOTO_PACK_INSTALL_LINT: "1",
      ZOTO_PACK_INSTALL_LINT_NONCE: randomUUID(),
      ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS: String(innerMs),
      NODE_ENV: "production",
    },
  };
}

/**
 * A stand-in parent (the service, or anything else that runs the script). It starts the script with
 * pipes (as the service does), in a new process group when `detached` (the service's
 * start_new_session), prints `script <pid>`, and `script-exit <code> <signal>` when it ends.
 */
const PARENT = `
const { spawn } = require("node:child_process");
const [detached, ...argv] = process.argv.slice(1);
const c = spawn(process.execPath, argv, { detached: detached === "1", stdio: ["ignore", "pipe", "pipe"] });
process.stdout.write("script " + c.pid + "\\n");
c.stdout.resume();
c.stderr.on("data", (d) => process.stderr.write(d));
c.on("exit", (code, signal) => process.stdout.write("script-exit " + code + " " + signal + "\\n"));
`;

function startParent(argv: string[], env: NodeJS.ProcessEnv, opts: { scriptDetached: boolean; parentDetached: boolean }): ChildProcess {
  const parent = spawn(process.execPath, ["-e", PARENT, opts.scriptDetached ? "1" : "0", ...argv], {
    env,
    detached: opts.parentDetached,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (parent.pid) pids.add(parent.pid);
  if (parent.pid && opts.parentDetached) groups.add(parent.pid);
  return parent;
}

/** The script pid the stand-in parent printed. */
async function scriptPid(parent: ChildProcess): Promise<number> {
  let out = "";
  parent.stdout?.setEncoding("utf8").on("data", (d: string) => (out += d));
  for (let i = 0; i < Math.ceil(MARGIN_MS / STEP_MS); i++) {
    const m = /^script (\d+)$/m.exec(out);
    if (m) {
      const pid = Number(m[1]);
      pids.add(pid);
      groups.add(pid);
      return pid;
    }
    await sleep(STEP_MS);
  }
  throw new Error(`the stand-in parent never started the script: ${out}`);
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

describe.runIf(process.platform === "linux")("#186 lint_timeout: a spinning lint never outlives its service", () => {
  it("orphan, plain JS: the service dies while the lint busy-loops (with a setInterval child); the whole group is gone within the inner timeout", async () => {
    const dir = tmp("spin");
    const pidFile = path.join(dir, "pids");
    const { argv, env } = scriptArgs(scriptTree({ built: spinningLint(pidFile) }), packHome(), INNER_MS);
    const parent = startParent(argv, env, { scriptDetached: true, parentDetached: false });
    const pgid = await scriptPid(parent);
    expect(await fileAppears(pidFile, MARGIN_MS), "the lint really ran and is spinning").toBe(true);
    const lintPids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    expect(lintPids[0], "the lint spins inside the script process").toBe(pgid);
    const before = groupMembers(pgid);
    expect(before.length, `script plus its setInterval child in one group: ${describeMembers(before)}`).toBeGreaterThanOrEqual(2);
    expect(before.map((p) => p.pid)).toContain(lintPids[1]);
    parent.kill("SIGKILL"); // the service dies
    const left = await groupAfter(pgid, INNER_MS + MARGIN_MS);
    expect(left, `process group ${pgid} still alive ${INNER_MS + MARGIN_MS} ms after its parent died: ${describeMembers(left)}`).toEqual([]);
  }, 60_000);

  it("orphan, during esbuild: the service dies while esbuild works; the group (node and esbuild's service child) is empty", async () => {
    const dir = tmp("esb");
    const mark = path.join(dir, "esbuild-working");
    const { argv, env } = scriptArgs(scriptTree({ esbuildMark: mark }), packHome(), ESBUILD_INNER_MS);
    const parent = startParent(argv, env, { scriptDetached: true, parentDetached: false });
    const pgid = await scriptPid(parent);
    expect(await fileAppears(mark, ESBUILD_INNER_MS), "the lint passed and esbuild reached the hang").toBe(true);
    const before = groupMembers(pgid);
    expect(before.map((p) => p.pid), describeMembers(before)).toContain(pgid);
    expect(before.some((p) => p.pid !== pgid && /esbuild.*--service/.test(p.cmd)), `esbuild's service child is in the group: ${describeMembers(before)}`).toBe(true);
    parent.kill("SIGKILL");
    const left = await groupAfter(pgid, ESBUILD_INNER_MS + MARGIN_MS);
    expect(left, `process group ${pgid} still alive ${ESBUILD_INNER_MS + MARGIN_MS} ms after its parent died: ${describeMembers(left)}`).toEqual([]);
  }, 60_000);

  it("timeout verdict: the script alone (parent alive) exits 3 with reason lint_timeout and the install sentence; nothing is left", async () => {
    const dir = tmp("verdict");
    const pidFile = path.join(dir, "pids");
    const { argv, env } = scriptArgs(scriptTree({ built: spinningLint(pidFile) }), packHome(), INNER_MS);
    const child = spawn(process.execPath, argv, { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const pgid = child.pid ?? 0;
    pids.add(pgid);
    groups.add(pgid);
    const r = await exited(child, INNER_MS + MARGIN_MS, pgid);
    const why = `exit ${r.code} signal ${r.signal} capped ${r.capped}; stderr: ${r.stderr.slice(0, 900)}`;
    expect(r.capped, `the script didn't end by itself within ${INNER_MS + MARGIN_MS} ms: ${why}`).toBe(false);
    expect(r.code, why).toBe(EXIT_LINT_SETUP);
    expect(r.stdout, "no bundle written").toBe("");
    const setup = verdicts(r.stderr, "pack-install-lint-setup-error");
    expect(setup, `one setup-error line: ${why}`).toHaveLength(1);
    expect(setup[0]!.reason).toBe("lint_timeout");
    expect(setup[0]!.message).toBe(TIMEOUT_MSG(PACK_NAME));
    expect(r.stderr.split(/\r?\n/)[0], "the first stderr line is the sentence").toBe(TIMEOUT_MSG(PACK_NAME));
    expect(String(setup[0]!.detail)).toBe(`install lint took longer than ${INNER_MS} ms`);
    expect(verdicts(r.stderr, "pack-install-lint-pass"), "no pass line").toEqual([]);
    expect(r.stderr).not.toMatch(/\n\s+at .+:\d+:\d+/);
    expect(existsSync(pidFile), "the lint really ran").toBe(true);
    const left = await groupAfter(pgid, MARGIN_MS);
    expect(left, `the lint's setInterval child went with the group: ${describeMembers(left)}`).toEqual([]);
  }, 60_000);

  it("group-leader guard: a script that doesn't lead its group refuses on timeout without killing its parent's group", async () => {
    const dir = tmp("guard");
    const pidFile = path.join(dir, "pids");
    const { argv, env } = scriptArgs(scriptTree({ built: spinningLint(pidFile, false) }), packHome(), INNER_MS);
    // The parent leads its own group (never vitest's); the script runs inside that group.
    const parent = startParent(argv, env, { scriptDetached: false, parentDetached: true });
    const r = await exited(parent, INNER_MS + MARGIN_MS, parent.pid ?? 0);
    const why = `parent exit ${r.code} signal ${r.signal} capped ${r.capped}; stdout ${r.stdout.trim()}; stderr: ${r.stderr.slice(0, 600)}`;
    expect(r.signal, `the parent's group was killed by the script: ${why}`).toBeNull();
    expect(r.capped, why).toBe(false);
    expect(r.code, why).toBe(0);
    expect(r.stdout, why).toMatch(/^script-exit 3 null$/m);
    expect(verdicts(r.stderr, "pack-install-lint-setup-error")[0]?.reason, why).toBe("lint_timeout");
    expect(existsSync(pidFile), "the lint really ran").toBe(true);
  }, 60_000);
});
