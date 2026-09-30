/**
 * #111: the web reads UX Pro's update sentences from the one table (web/scripts/pack-install-lint-setup-copy.json,
 * `updates`) through pack-install-copy-table.ts, and renders them exactly as the service does.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { packUpdateCopy, type PackUpdateCopyKind } from "./pack-install-copy-table";
import { packRetryStartFailedMessage } from "./pack-install-retry-copy";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** The repo's interpreter (CI installs the service requirements into <repo>/.venv), else python3. No skip. */
const venvPython = path.join(repoRoot, ".venv/bin/python");
const python = existsSync(venvPython) ? venvPython : "python3";

// The python spawn imports the service (2-4 s on a loaded box).
vi.setConfig({ testTimeout: 30_000 });

const SHA = "b".repeat(64);

type Case = { kind: PackUpdateCopyKind; name: string; newVersion: string; old: string };

/** What service/pack_install_lint.py format_update_copy says for each case. */
function serviceSentences(cases: readonly Case[]): string[] {
  const script = [
    "import json, sys",
    "from service.pack_install_lint import format_update_copy",
    "cases = json.loads(sys.argv[1])",
    "print(json.dumps([format_update_copy(c['kind'], c['name'], c['newVersion'] or None, c['old'] or None) for c in cases]))",
  ].join("\n");
  const out: string[] = JSON.parse(
    execFileSync(python, ["-c", script, JSON.stringify(cases)], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: repoRoot },
    }),
  );
  return out;
}

describe("#111 update copy from the one table", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  const retryCases = [
    { label: "old version known", installedVersion: "1", want: "Star Sines version 2 still couldn't start. You're still on version 1." },
    { label: "old version unknown", installedVersion: "", want: "Star Sines version 2 still couldn't start. The version you had is still installed." },
  ];
  for (const { label, installedVersion, want } of retryCases) {
    it(`retry still couldn't start, the web's own fallback (${label})`, async () => {
      expect(packRetryStartFailedMessage("Star Sines", 2, installedVersion)).toBe(want);
      const { applyPackInstallRetryResponse, blockedRecordDisplayMessage } = await import("./pack-install-retry");
      const { blockedCatalogEntries, syncBlockedCatalogFromErrors } = await import("./pack-install-surface");
      syncBlockedCatalogFromErrors([{
        error: "pack_install_start_failed",
        blockReason: "couldnt_start",
        message: "seed",
        name: "Star Sines",
        zip: "/tmp/star-sines.zip",
        zipSha256: SHA,
      }]);
      // No `message` in the response: the web renders the table's sentence itself.
      applyPackInstallRetryResponse(SHA, 400, { retryResult: "start_failed", name: "Star Sines", version: 2, installedVersion });
      const entry = blockedCatalogEntries()[0];
      expect(entry && blockedRecordDisplayMessage(entry)).toBe(want);
    });
  }

  it("renders every update sentence exactly as the service does (known and unknown old version)", () => {
    const cases: Case[] = [];
    const kinds: PackUpdateCopyKind[] = ["couldnt_start", "interrupted", "retry_couldnt_start"];
    for (const kind of kinds) {
      for (const name of ["Star Sines", "  Upgrade probe v1  ", "Pack {still} {new}", ""]) {
        for (const old of ["3", ""]) cases.push({ kind, name, newVersion: "4", old });
      }
    }
    const web = cases.map((c) => packUpdateCopy(c.kind, c.name, c.newVersion, c.old));
    expect(web).toEqual(serviceSentences(cases));
    expect(packUpdateCopy("couldnt_start", "Star Sines", 4, 3)).toBe(
      "Star Sines version 4 couldn't start, so it wasn't updated. You're still on version 3.",
    );
    expect(packUpdateCopy("interrupted", "Star Sines", null, "")).toBe(
      "The update to Star Sines didn't finish, so nothing changed. The version you had is still installed.",
    );
  });
});
