#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "revert-proofs/113");

const rows = [
  ["row-01-tab-wrap-to-allow", "src/ui/media-ask-focus.chromium.test.ts", "cycles Tab from Not now back to Allow while the dialog is open"],
  ["row-02-reload-unreachable", "src/ui/media-ask-focus.chromium.test.ts", "keeps the Reload notice action unreachable while the dialog is open"],
  ["row-03-ten-tab-guard", "src/ui/media-ask-focus.chromium.test.ts", "never focuses the Reload notice across ten Tab presses"],
  ["row-04-escape-dismiss-jsdom", "src/ui/media-ask-focus.chromium.test.ts", "closes on Escape with no microphone request"],
  ["row-06-focus-return-fresh-mic", "src/ui/media-ask-focus.test.ts", "returns focus to the header mic toggle on a fresh load after close"],
  ["row-07-focus-return-prior", "src/ui/media-ask-focus.test.ts", "returns focus to the element that had it before open when still connected"],
  ["row-08-copy-heading", "src/ui/media-ask-focus.test.ts", "pins the microphone heading copy byte-for-byte"],
  ["row-09-copy-body", "src/ui/media-ask-focus.test.ts", "pins the embedded-shell body copy"],
  ["row-10-copy-allow", "src/ui/media-ask-focus.test.ts", "pins the Allow button label"],
  ["row-11-copy-not-now", "src/ui/media-ask-focus.test.ts", "pins the Not now button label"],
  ["row-12-dialog-labelledby", "src/ui/media-ask-focus.test.ts", "uses a native dialog labelled by the heading"],
  ["row-13-dismiss-persist-reload", "src/ui/media-ask-dismiss-storage.test.ts", "persists mic dismiss so a reload does not reopen the dialog"],
  ["row-14-clear-dismiss-storage", "src/ui/media-ask-dismiss-storage.test.ts", "clears session dismiss so re-ask after reload can reopen the dialog"],
  ["row-15-dismiss-per-kind", "src/ui/media-ask-dismiss-storage.test.ts", "keeps camera ask available after mic dismiss across a reload"],
];

function runVitest(file, testName) {
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", file, "-t", testName], {
      cwd: path.join(root, "web"),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, out: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function redLine(out) {
  const lines = out.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("AssertionError:")) return t;
  }
  return null;
}

for (const [slug, file, testName] of rows) {
  const patchPath = path.join(dir, `${slug}.patch`);
  execFileSync("git", ["apply", "--check", patchPath], { cwd: root });
  const unpatched = runVitest(file, testName);
  if (unpatched.code !== 0) throw new Error(`${slug}: unpatched failed\n${unpatched.out.slice(-400)}`);
  execFileSync("git", ["apply", patchPath], { cwd: root });
  const patched = runVitest(file, testName);
  execFileSync("git", ["checkout", "HEAD", "--", "web/src/ui/media-ask.ts", "web/src/style.css"], { cwd: root });
  if (patched.code === 0) throw new Error(`${slug}: patched passed`);
  const red = redLine(patched.out);
  if (!red?.includes("AssertionError")) throw new Error(`${slug}: bad red\n${patched.out.slice(-400)}`);
  if (red.includes("…")) throw new Error(`${slug}: ellipsis in red`);
  const meta = JSON.parse(readFileSync(path.join(dir, `${slug}.json`), "utf8"));
  if (meta.red !== red) {
    throw new Error(`${slug}: red mismatch\n  json: ${meta.red}\n  got:  ${red}`);
  }
  console.log(slug, "OK");
}
