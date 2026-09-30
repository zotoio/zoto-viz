/**
 * #111: a refused update (the version you had is still installed) is recognised by its stable code,
 * `reasonCode: "update_refused"` (service/pack_install_copy.py REASON_UPDATE_REFUSED), never by the
 * message text. The payload comes from the service itself (service/plugin_install.py
 * update_refused_error), so a service that stops sending the code fails here too. The surface shows the
 * service's sentence as is (UX Pro's, from web/scripts/pack-install-lint-setup-copy.json); it has no copy
 * of its own.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ZIP = "/home/op/.zoto-viz/plugins/local/upgrade-probe.zip";
/**
 * The repo's interpreter, as starter-pack-pipeline.ts does: `<repo>/.venv/bin/python` (where CI's web job
 * installs the service requirements, PyYAML included, without putting it on PATH), else `python3`.
 * These rows always run; there is no skip.
 */
const venvPython = path.join(repoRoot, ".venv/bin/python");
const python = existsSync(venvPython) ? venvPython : "python3";

// The first python spawn imports the service (2-4 s on a loaded box).
vi.setConfig({ testTimeout: 30_000 });

type RefusedPayloadFields = { upgrade_blocked?: string; zip?: string; reasonCode?: string; message?: string };

/**
 * The service's refused update (service/plugin_install.py update_refused_error: the new version couldn't
 * be safety-checked) as JSON: its message and payload fields. `old` is the installed version ("" = unknown).
 */
function serviceRefusedUpdate(name = "Probe", old = "1"): RefusedPayloadFields {
  const script = [
    "import json, sys",
    "from service.plugin_install import update_refused_error",
    "e = update_refused_error(sys.argv[1], sys.argv[2] or None, sys.argv[3])",
    "print(json.dumps({'message': str(e), **e.payload}))",
  ].join("\n");
  const out: RefusedPayloadFields = JSON.parse(
    execFileSync(python, ["-c", script, name, old, ZIP], {
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
    const row = { ...serviceRefusedUpdate(), file: ZIP, error: arbitrary, message: arbitrary };
    expect(row.reasonCode).toBe(PACK_UPDATE_REFUSED);

    expect(isPackInstallBlockedPayload(row), "reasonCode update_refused alone makes it a refusal").toBe(true);
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

  // #111: UX Pro's sentence, exactly, where the user sees it: the catalog notice, the Blocked menu entry
  // and the agent chat line.
  const cases = [
    {
      label: "installed version known",
      old: "3",
      want: "Couldn't safety-check the new version of Star Sines, so it wasn't updated. You're still on version 3.",
    },
    {
      label: "installed version unknown",
      old: "",
      want: "Couldn't safety-check the new version of Star Sines, so it wasn't updated. The version you had is still installed.",
    },
  ];
  for (const { label, old, want } of cases) {
    it(`shows the service's refused-update sentence as is (${label})`, async () => {
      const {
        blockedCatalogEntries,
        formatBlockedCatalogNotice,
        localPluginPublishChatLine,
        takePackInstallBlockedNotice,
      } = await import("./pack-install-surface");
      const { installPlugins } = await import("./plugin");
      const refused = serviceRefusedUpdate("Star Sines", old);
      expect(refused.message).toBe(want);
      const row = { ...refused, file: ZIP, error: "pack_install_blocked" };
      vi.stubGlobal("fetch", async () => ({
        ok: true,
        json: async () => ({ dir: "", schema: "", plugins: [], errors: [row] }),
      }));
      await installPlugins();
      expect(takePackInstallBlockedNotice()).toBe(want);
      expect(formatBlockedCatalogNotice(blockedCatalogEntries())).toBe(
        `${want}\nZip folder: /home/op/.zoto-viz/plugins/local`,
      );
      expect(localPluginPublishChatLine({ ok: false, error: "pack_install_blocked", message: refused.message }, "Star Sines")).toBe(want);
    });
  }
});
