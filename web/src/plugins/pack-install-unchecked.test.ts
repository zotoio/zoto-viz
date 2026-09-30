/**
 * #200: a fresh install whose safety check couldn't run is one blocked pack in the catalog. The row comes
 * from the service itself (service/plugin_install.py install_unchecked_payload, on the check's own
 * InstallCheckUnavailableError); the surface lists it as blocked and shows the service's sentence as is.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** The repo's interpreter (CI installs the service requirements into <repo>/.venv), else python3. No skip. */
const venvPython = path.join(repoRoot, ".venv/bin/python");
const python = existsSync(venvPython) ? venvPython : "python3";

// The python spawn imports the service (2-4 s on a loaded box).
vi.setConfig({ testTimeout: 30_000 });

const ZIP = "/home/op/.zoto-viz/plugins/local/star-sines.zip";

type UncheckedRow = { error?: string; message?: string; reasonCode?: string };

function serviceUncheckedRow(name: string): UncheckedRow {
  const script = [
    "import json, sys",
    "from service.plugin_install import InstallCheckUnavailableError, format_couldnt_check_message, install_unchecked_payload",
    "print(json.dumps(install_unchecked_payload(InstallCheckUnavailableError(format_couldnt_check_message(sys.argv[1])))))",
  ].join("\n");
  const out: UncheckedRow = JSON.parse(
    execFileSync(python, ["-c", script, name], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, PYTHONPATH: repoRoot } }),
  );
  return out;
}

describe("#200 unchecked fresh install: one blocked pack", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the pack as blocked with the service's fresh-install sentence, and the other packs still load", async () => {
    const { blockedCatalogEntries, takePackInstallBlockedNotice } = await import("./pack-install-surface");
    const { installPlugins, viewSelectOptions } = await import("./plugin");
    const want = "Couldn't safety-check Star Sines, so it wasn't installed.";
    const row = { ...serviceUncheckedRow("Star Sines"), file: ZIP, zip: ZIP };
    expect(row.message, "the service's install_unchecked sentence").toBe(want);
    expect(row.reasonCode, "the service's stable code").toBe("install_unchecked");
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ dir: "", schema: "", plugins: [], errors: [row] }),
    }));
    await installPlugins();
    expect(takePackInstallBlockedNotice(), "catalog notice").toBe(want);
    expect(blockedCatalogEntries().map((e) => e.message), "Blocked menu entry").toEqual([want]);
    expect(viewSelectOptions().some((o) => o.label === "Blocked (1)"), "Blocked (1) in the view menu").toBe(true);
  });
});
