/**
 * #111: a refused update (the version you had is still installed) is recognised by its stable code,
 * `reasonCode: "update_refused"` (service/pack_install_copy.py REASON_UPDATE_REFUSED), never by the
 * message text. The payload comes from the service itself (service/plugin_install.py
 * update_refused_payload), so a service that stops sending the code fails here too.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZIP = "/home/op/.zoto-viz/plugins/local/upgrade-probe.zip";

type RefusedPayloadFields = { upgrade_blocked?: string; zip?: string; reasonCode?: string };

/** The service's refused-update payload fields, as JSON from service/plugin_install.py. */
function serviceRefusedPayload(): RefusedPayloadFields {
  const script = [
    "import json, sys",
    "from service.plugin_install import update_refused_payload",
    "print(json.dumps(update_refused_payload(sys.argv[1])))",
  ].join("\n");
  const out: RefusedPayloadFields = JSON.parse(
    execFileSync("python3", ["-c", script, ZIP], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: repoRoot },
    }),
  );
  return out;
}

describe("#111 refused update: the surface branches on reasonCode, not on the wording", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("picks the refused-update branch from the code alone, whatever the message says", async () => {
    const {
      PACK_UPDATE_REFUSED,
      blockedCatalogEntries,
      formatPackInstallBlocked,
      isPackInstallBlockedPayload,
      takePackInstallBlockedNotice,
    } = await import("./pack-install-surface");
    const { installPlugins } = await import("./plugin");
    const arbitrary = "Zorblax quibbled the frobnicator; nothing here is copy the surface knows.";
    // `error` is arbitrary too (the service's fallback row puts the raw text there): only the code is left.
    const row = { ...serviceRefusedPayload(), file: ZIP, error: arbitrary, message: arbitrary };
    expect(row.reasonCode).toBe(PACK_UPDATE_REFUSED);

    expect(isPackInstallBlockedPayload(row)).toBe(true);
    expect(formatPackInstallBlocked(row)).toBe(arbitrary);
    expect(isPackInstallBlockedPayload({ ...row, reasonCode: "" }), "without the code it's not a refusal").toBe(false);

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ dir: "", schema: "", plugins: [], errors: [row] }),
    }));
    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBe(arbitrary);
    expect(blockedCatalogEntries().map((e) => e.message)).toEqual([arbitrary]);
  });
});
