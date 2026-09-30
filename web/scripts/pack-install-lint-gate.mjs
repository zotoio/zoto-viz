/**
 * Install lint gate for bundle-pack-entry.mjs (#185). Fails closed: the only way through is the
 * runner's pass verdict, bound to this run's nonce and pack id, as the runner's LAST stdout line.
 *
 * Verdicts:
 * - pass:  runner exit 0 and its last non-empty stdout line is exactly
 *          {"type":"pack-install-lint-pass","nonce":<this run's nonce>,"pack":<pack id>}.
 * - block: runner exit 1 with a `pack-install-lint-block` JSON line on stderr (a real lint finding).
 * - setup: anything else (tsx/runner unresolvable, spawn error, crash, signal, timeout, exit 0
 *          without a valid verdict). The detail is diagnostic only; it never reaches the user message.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

/** Runner timeout; must stay below the service's bundle timeout (plugins.PACK_BUNDLE_TIMEOUT_S = 20 s). */
export const DEFAULT_LINT_TIMEOUT_MS = 15000;
export const EXIT_LINT_BLOCK = 1;
export const EXIT_LINT_SETUP = 3;
export const LINT_PASS = "pack-install-lint-pass";
export const LINT_BLOCK = "pack-install-lint-block";
export const LINT_SETUP = "pack-install-lint-setup-error";

export function jsonLines(text, type) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const raw = JSON.parse(t);
      if (raw && typeof raw === "object" && raw.type === type) out.push(raw);
    } catch {
      /* not a verdict line */
    }
  }
  return out;
}

export function lastNonEmptyLine(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

/** True only for exactly {type: pass, nonce, pack} — no other keys, no other values. */
export function isExactPassVerdict(line, nonce, pack) {
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return false;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "nonce,pack,type") return false;
  return raw.type === LINT_PASS && typeof nonce === "string" && nonce !== "" && raw.nonce === nonce && raw.pack === pack;
}

/**
 * Run web/scripts/pack-install-lint-run.ts under tsx in its own process group, with a timeout that
 * kills the whole group (tsx runs the script in a grandchild).
 * @returns {Promise<{kind: "pass" | "block" | "setup", detail?: string, stderr: string}>}
 */
export async function runInstallLint({ repoRoot, packHome, packId, timeoutMs = DEFAULT_LINT_TIMEOUT_MS }) {
  const setup = (detail, stderr = "") => ({ kind: "setup", detail, stderr });
  let tsxCli;
  try {
    tsxCli = createRequire(path.join(repoRoot, "web/package.json")).resolve("tsx/cli");
  } catch (err) {
    return setup(`tsx not resolvable from web/: ${String(err?.code || err?.message || err)}`);
  }
  const lintRun = path.join(repoRoot, "web/scripts/pack-install-lint-run.ts");
  if (!fs.existsSync(lintRun)) return setup(`lint runner missing: ${lintRun}`);
  const nonce = randomUUID();
  const group = process.platform !== "win32";
  return await new Promise((resolve) => {
    let settled = false;
    let child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const killTree = () => {
      if (!child?.pid) return;
      try {
        if (group) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    };
    const onParentExit = () => killTree();
    // bundle-pack-entry.mjs itself told to stop (the service's timeout sends SIGTERM to its group
    // first): take the runner's group down with it rather than orphaning it.
    const STOP_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
    const onParentSignal = (sig) => {
      killTree();
      process.exit(128 + (os.constants.signals[sig] ?? 15));
    };
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree();
      process.removeListener("exit", onParentExit);
      for (const sig of STOP_SIGNALS) process.removeListener(sig, onParentSignal);
      resolve(verdict);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    try {
      child = spawn(process.execPath, [tsxCli, lintRun, packHome, repoRoot, packId, nonce], {
        cwd: repoRoot,
        detached: group,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish(setup(`lint runner did not start: ${String(err?.code || err?.message || err)}`));
      return;
    }
    process.once("exit", onParentExit);
    for (const sig of STOP_SIGNALS) process.once(sig, onParentSignal);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      finish(setup(`lint runner did not start: ${String(err?.code || err?.message || err)}`, stderr));
    });
    child.on("close", (code, signal) => {
      if (timedOut) return finish(setup(`lint runner timed out after ${timeoutMs} ms`, stderr));
      if (signal) return finish(setup(`lint runner killed by ${signal}`, stderr));
      if (code === EXIT_LINT_BLOCK && jsonLines(stderr, LINT_BLOCK).length > 0) {
        return finish({ kind: "block", stderr });
      }
      if (code !== 0) return finish(setup(`lint runner ended before a verdict (exit ${code})`, stderr));
      if (!isExactPassVerdict(lastNonEmptyLine(stdout), nonce, packId)) {
        return finish(setup("lint runner exited 0 without a valid pass verdict as its last stdout line", stderr));
      }
      return finish({ kind: "pass", stderr });
    });
  });
}
