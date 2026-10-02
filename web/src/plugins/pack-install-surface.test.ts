import { beforeEach, describe, expect, it, vi } from "vitest";

describe("pack install blocked surface", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("toast once per unchanged zip; Blocked row on every catalog sync", async () => {
    const {
      takePackInstallBlockedNotice,
    } = await import("./pack-install-surface");
    const { installPlugins, viewSelectOptions } = await import("./plugin");
    const orig = globalThis.fetch;
    const blocked =
      "Probe was blocked because it loads code from outside its own folder. "
      + "Nothing was installed, and your wall is unchanged. If you made this pack, run pack lint to see what to fix.";
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
    expect(viewSelectOptions().some((o) => o.label === "Unavailable (1)")).toBe(true);

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBeNull();
    expect(viewSelectOptions().some((o) => o.label === "Unavailable (1)")).toBe(true);

    await installPlugins();
    expect(takePackInstallBlockedNotice()).toBeNull();
    expect(viewSelectOptions().some((o) => o.label === "Unavailable (1)")).toBe(true);

    globalThis.fetch = orig;
  });

  it("blocked menu notice includes zip folder path", async () => {
    const {
      blockedViewSelectRow,
      formatBlockedCatalogNotice,
      syncBlockedCatalogFromErrors,
    } = await import("./pack-install-surface");
    syncBlockedCatalogFromErrors([{
      error: "pack_boundary",
      zip: "/data/plugins/local/evil.zip",
      message: "Evil was blocked because it loads code from outside its own folder. Nothing was updated, so version 3 is still installed. If you made this pack, run pack lint to see what to fix.",
    }]);
    const row = blockedViewSelectRow([{
      error: "pack_boundary",
      zipPath: "/data/plugins/local/evil.zip",
      zipDir: "/data/plugins/local",
      message: "Evil was blocked because it loads code from outside its own folder. Nothing was updated, so version 3 is still installed. If you made this pack, run pack lint to see what to fix.",
    }]);
    expect(row?.label).toBe("Unavailable (1)");
    const text = formatBlockedCatalogNotice([{
      error: "pack_boundary",
      zipPath: "/data/plugins/local/evil.zip",
      zipDir: "/data/plugins/local",
      message: "Evil was blocked because it loads code from outside its own folder. Nothing was updated, so version 3 is still installed. If you made this pack, run pack lint to see what to fix.",
    }]);
    expect(text).toContain("Zip folder: /data/plugins/local");
    expect(text).toContain("so version 3 is still installed");
  });

  it("surfaces pack_sdk_contract like pack_boundary (older SDK label)", async () => {
    const { takePackInstallBlockedNotice } = await import("./pack-install-surface");
    const { installPlugins, viewSelectOptions } = await import("./plugin");
    const orig = globalThis.fetch;
    const blocked =
      "Stale was blocked because it was built for an older version of zoto-viz. Its author needs to update it. "
      + "Nothing was installed, and your wall is unchanged.";
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
    expect(viewSelectOptions().some((o) => o.label === "Unavailable (1)")).toBe(true);
    globalThis.fetch = orig;
  });

  it("consumes installNotices from catalog payload exactly once", async () => {
    const {
      consumePackInstallNotices,
      takePackInstallBlockedNotice,
    } = await import("./pack-install-surface");
    const { installPlugins } = await import("./plugin");
    const orig = globalThis.fetch;
    const human = "The update to Probe didn't finish, so nothing changed. You're still on version 1.";
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

  it("toasts again when the blocked zip message changes", async () => {
    const {
      queuePackInstallBlockedNotice,
      takePackInstallBlockedNotice,
    } = await import("./pack-install-surface");
    const base = { error: "pack_boundary" as const, zip: "/tmp/same.zip" };
    queuePackInstallBlockedNotice({ ...base, message: "first block" });
    expect(takePackInstallBlockedNotice()).toBe("first block");
    queuePackInstallBlockedNotice({ ...base, message: "second block" });
    expect(takePackInstallBlockedNotice()).toBe("second block");
  });
});
