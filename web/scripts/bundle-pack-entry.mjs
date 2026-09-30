#!/usr/bin/env node
/**
 * Bundle a pack frontend entry for the service catalog.
 * Every resolved file must stay inside the pack home or plugins/sdk (realpath).
 *
 *   bundle-pack-entry.mjs <entry.ts> <plugins/sdk/abs> <packHome/abs> [repoRoot]
 *   bundle-pack-entry.mjs --lint-only <packHome/abs> <repoRoot>
 *
 * Install lint (#185) runs with ZOTO_PACK_INSTALL_LINT=1 (bundle mode) or --lint-only (packs that
 * aren't bundled: `frontend.bundle: false` or no frontend). #186: it runs in this process, from the
 * prebuilt plain-JS pack-install-lint.built.mjs (no TypeScript runner); its verdict is a return
 * value. --lint-only also runs esbuild's import-boundary check over the unbundled scripts. It fails
 * closed. Exit codes: 0 pass, 1 lint block / boundary block / build error, 2 usage, 3 setup refusal
 * (the check couldn't run: esbuild, plugins/sdk or the built lint missing, a built lint that doesn't
 * match its sources, or a lint that threw or gave no verdict; the user message never carries the
 * raw cause, only the `pack-install-lint-setup-error` diagnostic line does). On a pass the LAST
 * stderr line is {"type":"pack-install-lint-pass","nonce":$ZOTO_PACK_INSTALL_LINT_NONCE,"pack":<id>},
 * which the service requires.
 *
 * #186 lint_timeout: the lint body runs in a worker_thread, so this (main) thread's timer can fire
 * while the lint spins in a sync loop. After LINT_TIMEOUT_MS (shorter than the service's 20 s
 * PACK_BUNDLE_TIMEOUT_S, which stays as the backstop) the whole lint-mode run (lint and esbuild) is
 * refused: exit 3, reason `lint_timeout`. If this process leads its process group (the service starts
 * it with start_new_session) it takes the group down too (esbuild's service child, anything the lint
 * spawned), so a dead service can't leave a spinning lint behind.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const EXIT_LINT_BLOCK = 1;
const EXIT_LINT_SETUP = 3;
const LINT_SETUP = "pack-install-lint-setup-error";
const LINT_PASS = "pack-install-lint-pass";
const LINT_BLOCK = "pack-install-lint-block";
/** The checkout this script (and its built lint) belongs to: the built lint's sources are here. */
const scriptRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const flags = new Map();
const pos = [];
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--")) {
    const eq = arg.indexOf("=");
    flags.set(eq < 0 ? arg.slice(2) : arg.slice(2, eq), eq < 0 ? "" : arg.slice(eq + 1));
  } else {
    pos.push(arg);
  }
}
const lintOnly = flags.has("lint-only");
const lintMode = lintOnly || process.env.ZOTO_PACK_INSTALL_LINT === "1";

const entry = lintOnly ? "" : pos[0];
const sdkRoot = lintOnly ? "" : path.resolve(pos[1] ?? "");
const packHome = path.resolve((lintOnly ? pos[0] : pos[2]) ?? "");
const repoArg = lintOnly ? pos[1] : pos[3];
const repoRoot = repoArg ? path.resolve(repoArg) : undefined;

if (lintOnly ? !pos[0] || !pos[1] : !entry || !pos[1] || !pos[2]) {
  console.error("usage: bundle-pack-entry.mjs <entry.ts> <plugins/sdk/abs> <packHome/abs> [repoRoot]");
  console.error("       bundle-pack-entry.mjs --lint-only <packHome/abs> <repoRoot>");
  process.exit(2);
}

function readManifest(home) {
  for (const name of ["plugin.yml", "plugin.yaml"]) {
    try {
      return fs.readFileSync(path.join(home, name), "utf8");
    } catch {
      /* try the next name */
    }
  }
  return "";
}

function manifestField(text, key) {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  if (!m) return "";
  return m[1].replace(/^(["'])(.*)\1$/, "$2").trim();
}

const manifest = readManifest(packHome);
/** plugin.yml `id:` (the service checks it in the pass verdict), else the pack folder name. */
const packId = manifestField(manifest, "id") || path.basename(packHome);
/** plugin.yml display name (top-level `name:`), else `id:`, else the pack folder name. */
const packName = manifestField(manifest, "name") || packId;

/**
 * #186: `reason` is a machine-readable code for the log and the rows (never user text): which setup
 * step failed. The user sentence's fix depends on it (`pnpm run prepare` for a missing, stale or
 * unloadable built lint, `pnpm install` otherwise); the wording lives in one table,
 * pack-install-lint-setup-copy.json, which the service reads too.
 */
const SETUP_REASONS = Object.freeze({
  noRepoRoot: "no_repo_root",
  esbuild: "esbuild_unresolvable",
  sdk: "sdk_unresolvable",
  stampModule: "lint_stamp_unresolvable",
  missing: "lint_prebuilt_missing",
  unloadable: "lint_prebuilt_unloadable",
  stale: "lint_prebuilt_stale",
  threw: "lint_threw",
  noVerdict: "lint_no_verdict",
  timeout: "lint_timeout",
});

/**
 * #186: the in-script bound on a lint-mode run. The service's own timeout is PACK_BUNDLE_TIMEOUT_S =
 * 20 s (service/plugins.py) and counts node start-up too; 15 s leaves 5 s for start-up, the refusal
 * line, the group kill and the exit, so this bound fires first. LINT_TIMEOUT_ENV can only shorten it
 * (the rows use it); a timeout only ever refuses.
 */
const LINT_TIMEOUT_MS = 15_000;
const LINT_TIMEOUT_ENV = "ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS";
/** After a timeout, how long a worker gets to stop before this process kills itself instead. */
const LINT_TIMEOUT_GRACE_MS = 500;

function lintTimeoutMs() {
  const ms = Number(process.env[LINT_TIMEOUT_ENV]);
  return Number.isInteger(ms) && ms > 0 ? Math.min(ms, LINT_TIMEOUT_MS) : LINT_TIMEOUT_MS;
}

/**
 * The setup copy (pack-install-lint-setup-copy.mjs + .json), loaded up front in lint mode so a refusal
 * can't fail on it. If it can't load, the refusal still happens (exit 3, same reason) without a
 * sentence; the service renders its own from the same table.
 */
const setupCopy = lintMode
  ? await import("./pack-install-lint-setup-copy.mjs").catch((err) => ({ loadError: err }))
  : null;

/** The setup-refusal stderr text: the reason's sentence (if the copy loaded), then the JSON line. */
function setupRefusalText(detail, reason) {
  let message = null;
  let copyDetail = "";
  try {
    if (setupCopy?.loadError) throw setupCopy.loadError;
    message = setupCopy.setupSentence(packName, reason);
  } catch (err) {
    copyDetail = `; setup copy unavailable: ${errCode(err)}`;
  }
  const line = JSON.stringify({ type: LINT_SETUP, message, reason, detail: `${detail}${copyDetail}` });
  return message ? `${message}\n${line}\n` : `${line}\n`;
}

function refuseLintSetup(detail, reason) {
  process.stderr.write(setupRefusalText(detail, reason));
  process.exit(EXIT_LINT_SETUP);
}

/**
 * This process's group id when it leads the group (Linux: /proc/self/stat), else null. Only a leader
 * may kill its group: run from a shell or a test harness, the group is the caller's.
 */
function ownProcessGroup() {
  try {
    const stat = fs.readFileSync("/proc/self/stat", "utf8");
    const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
    return pgrp === process.pid ? pgrp : null;
  } catch {
    return null;
  }
}

/** Other live processes in group `pgrp` (Linux /proc scan). */
function groupMembers(pgrp) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return out;
  }
  for (const name of entries) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
      if (Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]) === pgrp) out.push(pid);
    } catch {
      /* gone already */
    }
  }
  return out;
}

/** The lint worker while it runs (the timeout stops it). */
let lintWorker = null;

/**
 * #186 lint_timeout. Write the refusal first (sync: nothing after this is guaranteed to run; a dead
 * service's closed pipe doesn't stop the rest), then, as
 * group leader only, take the group down: SIGTERM to the group (this process ignores it) and SIGKILL
 * to anything left. Never await worker.terminate(): it waits for a sync native call in the worker, and
 * so would process.exit(). Exit 3 once the worker has stopped; if it hasn't within the grace, kill
 * this process (the group, as leader) so nothing is left behind.
 */
function lintTimedOut(ms) {
  try {
    fs.writeSync(2, setupRefusalText(`install lint took longer than ${ms} ms`, SETUP_REASONS.timeout));
  } catch {
    /* EPIPE: the service is gone; the group still has to go */
  }
  const pgrp = ownProcessGroup();
  if (pgrp !== null) {
    process.on("SIGTERM", () => {});
    try {
      process.kill(-pgrp, "SIGTERM");
    } catch {
      /* nothing else in the group */
    }
    for (const pid of groupMembers(pgrp)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* gone already */
      }
    }
  }
  const worker = lintWorker;
  if (!worker) process.exit(EXIT_LINT_SETUP);
  worker.once("exit", () => process.exit(EXIT_LINT_SETUP));
  worker.terminate().catch(() => {});
  setTimeout(() => process.kill(pgrp === null ? process.pid : -pgrp, "SIGKILL"), LINT_TIMEOUT_GRACE_MS);
}

/** Armed for the whole lint-mode run (lint, then esbuild); unref'd, so a finished run exits at once. */
const lintTimer = lintMode
  ? setTimeout(() => lintTimedOut(lintTimeoutMs()), lintTimeoutMs())
  : null;
lintTimer?.unref();

function errCode(err) {
  return String(err?.code || err?.message || err);
}

/** The service's verdict: last stderr line, bound to the service's nonce and this pack id. */
function emitServicePass() {
  if (lintTimer) clearTimeout(lintTimer);
  console.error(JSON.stringify({ type: LINT_PASS, nonce: process.env.ZOTO_PACK_INSTALL_LINT_NONCE ?? "", pack: packId }));
}

/** A module the bundle needs (esbuild after `pnpm install --prod`, plugins/sdk) can't load. */
async function importOrRefuse(spec, what, reason) {
  try {
    return await import(spec);
  } catch (err) {
    if (lintMode) refuseLintSetup(`${what} not importable: ${errCode(err)}`, reason);
    console.error(`${what} not importable (${errCode(err)}); run \`pnpm install\` in \`web/\``);
    process.exit(1);
  }
}

const esbuild = lintOnly ? null : await importOrRefuse("esbuild", "esbuild", SETUP_REASONS.esbuild);
const bundleResolve = lintOnly
  ? null
  : await importOrRefuse("../../plugins/sdk/pack-bundle-resolve.mjs", "plugins/sdk/pack-bundle-resolve.mjs", SETUP_REASONS.sdk);

/**
 * #186: the install lint, in this process's lint worker (a worker_thread: no child process; the verdict
 * comes back as a message). The built lint is plain JS (no tsx); a missing or stale one is the setup
 * refusal, and its sentence says `pnpm run prepare` in web/ (which rebuilds it; an up-to-date `pnpm
 * install` skips prepare). Only a `{kind: "pass"}` verdict lets the install go ahead. The worker runs
 * the same steps the main thread did before lint_timeout (stamp module, built lint, stale check, the
 * lint call) and answers {type: "refuse", detail, reason} or {type: "verdict", ...}.
 */
const LINT_WORKER_SOURCE = `
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { parentPort, workerData: w } = require("node:worker_threads");
const errCode = (err) => String(err?.code || err?.message || err);
const str = (v) => (v === undefined || v === null ? v : String(v));
const refuse = (detail, reason, warnings = []) => parentPort.postMessage({ type: "refuse", detail, reason, warnings });
(async () => {
  let stamp;
  let lint;
  try {
    stamp = await import(pathToFileURL(path.join(w.scriptsDir, "pack-install-lint-stamp.mjs")).href);
  } catch (err) {
    return refuse("lint stamp check not importable: " + errCode(err), w.reasons.stampModule);
  }
  try {
    lint = await import(pathToFileURL(path.join(w.scriptsDir, stamp.BUILT_LINT_FILE)).href);
  } catch (err) {
    const missing = err?.code === "ERR_MODULE_NOT_FOUND" && String(err?.message || "").includes(stamp.BUILT_LINT_FILE);
    return refuse("built lint not importable: " + errCode(err) + "; " + stamp.REBUILD_HINT, missing ? w.reasons.missing : w.reasons.unloadable);
  }
  const stale = stamp.staleReason(lint.PACK_INSTALL_LINT_BUILD, w.scriptRepoRoot);
  if (stale) return refuse(stale, w.reasons.stale);
  let verdict;
  try {
    verdict = lint.runPackInstallLint(w.packHome, w.repoRoot, { unbundled: w.unbundled });
  } catch (err) {
    return refuse("lint threw: " + errCode(err), w.reasons.threw);
  }
  const kind = verdict && typeof verdict === "object" ? verdict.kind : undefined;
  const warnings = (Array.isArray(verdict?.warnings) ? verdict.warnings : []).map(String);
  if (kind !== "pass" && kind !== "block" && kind !== "boundary") {
    return refuse("lint gave no verdict (" + (kind === undefined ? typeof verdict : JSON.stringify(kind)) + ")", w.reasons.noVerdict, warnings);
  }
  parentPort.postMessage({
    type: "verdict",
    kind,
    warnings,
    message: String(verdict.message || ""),
    details: Array.isArray(verdict.details) ? verdict.details.map(String) : [],
    file: str(verdict.file),
    import: str(verdict.import),
    reason: str(verdict.reason),
  });
})().catch((err) => refuse("lint threw: " + errCode(err), w.reasons.threw));
`;

/** Run the lint worker; resolves with its answer (a crash or an exit without one is a refusal). */
function lintInWorker() {
  return new Promise((resolve) => {
    const workerData = {
      scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
      scriptRepoRoot,
      packHome,
      repoRoot,
      unbundled: lintOnly,
      reasons: { ...SETUP_REASONS },
    };
    try {
      lintWorker = new Worker(LINT_WORKER_SOURCE, { eval: true, workerData });
    } catch (err) {
      resolve({ type: "refuse", detail: `lint worker not startable: ${errCode(err)}`, reason: SETUP_REASONS.threw });
      return;
    }
    lintWorker.once("message", resolve);
    lintWorker.once("error", (err) => resolve({ type: "refuse", detail: `lint threw: ${errCode(err)}`, reason: SETUP_REASONS.threw }));
    lintWorker.once("exit", () => resolve({ type: "refuse", detail: "lint gave no verdict (worker exited)", reason: SETUP_REASONS.noVerdict }));
  });
}

async function runInstallLint() {
  if (!repoRoot) refuseLintSetup("no repo root passed to bundle-pack-entry.mjs", SETUP_REASONS.noRepoRoot);
  const answer = await lintInWorker();
  // The verdict is in: stop the worker (anything the lint left running) without waiting for it.
  const done = lintWorker;
  lintWorker = null;
  done?.unref();
  done?.terminate().catch(() => {});
  for (const w of Array.isArray(answer?.warnings) ? answer.warnings : []) console.warn(String(w));
  if (answer?.type !== "verdict") refuseLintSetup(String(answer?.detail ?? "lint gave no verdict"), answer?.reason ?? SETUP_REASONS.noVerdict);
  if (answer.kind === "block") {
    for (const line of answer.details) console.error(line);
    // #185: `message` is the <sentence> in "<Name> was blocked because <sentence> …" — plain words only.
    // #194: `reason` names install-only refusals (dynamic_import_nonliteral); the details carry it to the log too.
    const reason = answer.reason ? { reason: answer.reason } : {};
    console.error(JSON.stringify({ type: LINT_BLOCK, message: answer.message, details: answer.details, ...reason }));
    process.exit(EXIT_LINT_BLOCK);
  }
  if (answer.kind === "boundary") {
    // #186: the same payload esbuild's boundary plugin gives the service (pack_boundary.py).
    console.error(JSON.stringify({ type: "pack-bundle-boundary", file: answer.file, import: answer.import, reason: answer.reason }));
    process.exit(EXIT_LINT_BLOCK);
  }
  if (answer.kind !== "pass") refuseLintSetup(`lint gave no verdict (${JSON.stringify(answer.kind)})`, SETUP_REASONS.noVerdict);
}

if (lintMode) await runInstallLint();

if (lintOnly) {
  emitServicePass();
  process.exit(0);
}

const { PACK_BUNDLE_EXTERNALS, resolvePackBundleImport } = bundleResolve;

function boundaryError(importer, specifier, reason) {
  const relFile = path.relative(packHome, importer).replace(/\\/g, "/");
  const payload = {
    type: "pack-bundle-boundary",
    file: relFile.startsWith("..") ? path.basename(importer) : relFile,
    import: specifier,
    reason,
  };
  return { errors: [{ text: JSON.stringify(payload) }] };
}

const nodeEnv = process.env.NODE_ENV === "production" ? "production" : "development";

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: {
    "process.env.NODE_ENV": JSON.stringify(nodeEnv),
  },
  external: [...PACK_BUNDLE_EXTERNALS],
  plugins: [
    {
      name: "zoto-pack-boundary",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith("\0")) return null;
          if (args.kind === "entry-point") return null;
          const resolved = resolvePackBundleImport({
            specifier: args.path,
            importerFile: args.importer,
            packHome,
            sdkRoot,
            repoRoot,
          });
          if (resolved.ok && resolved.external) {
            return { path: args.path, external: true };
          }
          if (!resolved.ok) {
            return boundaryError(args.importer, args.path, resolved.reason);
          }
          return { path: resolved.path };
        });
      },
    },
  ],
  write: false,
  logLevel: "silent",
}).catch((err) => {
  const msgs = err?.errors?.map((e) => e.text).filter(Boolean) ?? [];
  const boundary = msgs.find((t) => t.includes("pack-bundle-boundary"));
  if (boundary) {
    console.error(boundary);
  } else {
    console.error(String(err?.message || err));
  }
  process.exit(1);
});

if (!result.outputFiles[0]) {
  console.error("esbuild produced no output");
  process.exit(1);
}
if (lintMode) emitServicePass();
process.stdout.write(result.outputFiles[0].text);
