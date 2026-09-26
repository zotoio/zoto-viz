import { describe, expect, it } from "vitest";
import {
  blockedViewSelectRow,
  consumePackInstallNotices,
  formatBlockedCatalogNotice,
  queuePackInstallBlockedNotice,
  resetPackInstallSurfaceForTests,
  syncBlockedCatalogFromErrors,
  takePackInstallBlockedNotice,
} from "./pack-install-surface";
import { installPlugins, viewSelectOptions } from "./plugin";

describe("pack install blocked surface", () => {
  it("toast once per unchanged zip; Blocked row on every catalog sync", async () => {
    resetPackInstallSurfaceForTests();
    const orig = globalThis.fetch;
    const blocked =
      "Probe was blocked: it imports a file outside its own folder (`frontend/index.ts`) (`./evil`). "
      + "Nothing was installed and the current wall is unchanged.";
    const catalog = {
      ok: true,
      json: async () => ({
        dir: "",
        schema: "",
        plugins: [],
        errors: [{
          file: "/home/op/.zoto-viz/plugins/local/bad.zip",
          zip: "/home/op/.zoto-viz/plugins/local/bad.zip",
          error: "pack_boundary",
          message: blocked,
        }],
      }),
    };
    globalThis.fetch = (async () => catalog) as never;

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBe(blocked);
    expect(viewSelectOptions().some((o) => o.label === "Blocked (1)")).toBe(true);

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBeNull();
    expect(viewSelectOptions().some((o) => o.label === "Blocked (1)")).toBe(true);

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBeNull();
    expect(viewSelectOptions().some((o) => o.label === "Blocked (1)")).toBe(true);

    globalThis.fetch = orig;
  });

  it("blocked menu notice includes zip folder path", () => {
    resetPackInstallSurfaceForTests();
    syncBlockedCatalogFromErrors([{
      error: "pack_boundary",
      zip: "/data/plugins/local/evil.zip",
      message: "Evil was blocked (frontend/index.ts imports ../escape); v1 is still running.",
    }]);
    const row = blockedViewSelectRow([{
      error: "pack_boundary",
      zipPath: "/data/plugins/local/evil.zip",
      zipDir: "/data/plugins/local",
      message: "Evil was blocked (frontend/index.ts imports ../escape); v1 is still running.",
    }]);
    expect(row?.label).toBe("Blocked (1)");
    const text = formatBlockedCatalogNotice([{
      error: "pack_boundary",
      zipPath: "/data/plugins/local/evil.zip",
      zipDir: "/data/plugins/local",
      message: "Evil was blocked (frontend/index.ts imports ../escape); v1 is still running.",
    }]);
    expect(text).toContain("Zip folder: /data/plugins/local");
    expect(text).toContain("v1 is still running");
  });

  it("surfaces pack_sdk_contract like pack_boundary (older SDK label)", async () => {
    resetPackInstallSurfaceForTests();
    const orig = globalThis.fetch;
    const blocked =
      "Stale was blocked: Built for an older zoto-viz SDK — needs an update from its author. Nothing else changed.";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        dir: "",
        schema: "",
        plugins: [],
        errors: [{
          file: "/tmp/stale.zip",
          zip: "/tmp/stale.zip",
          error: "pack_sdk_contract",
          message: blocked,
        }],
      }),
    })) as never;

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBe(blocked);
    expect(viewSelectOptions().some((o) => o.label === "Blocked (1)")).toBe(true);
    globalThis.fetch = orig;
  });

  it("consumes installNotices from catalog payload exactly once", async () => {
    resetPackInstallSurfaceForTests();
    const orig = globalThis.fetch;
    const human = "An update to Probe was interrupted, so v1 was restored";
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        dir: "",
        schema: "",
        plugins: [],
        errors: [],
        installNotices: [{ error: "pack_install_interrupted", message: human }],
      }),
    })) as never;

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBe(human);
    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBeNull();

    const shown = consumePackInstallNotices([{ error: "pack_install_interrupted", message: human }]);
    expect(shown).toEqual([]);

    globalThis.fetch = orig;
  });

  it("toasts again when the blocked zip message changes", () => {
    resetPackInstallSurfaceForTests();
    const base = { error: "pack_boundary" as const, zip: "/tmp/same.zip" };
    queuePackInstallBlockedNotice({ ...base, message: "first block" });
    expect(takePackInstallBlockedNotice()).toBe("first block");
    queuePackInstallBlockedNotice({ ...base, message: "second block" });
    expect(takePackInstallBlockedNotice()).toBe("second block");
  });
});
