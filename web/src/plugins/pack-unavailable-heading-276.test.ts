/**
 * The view picker's group heading counts lint blocks, checks that couldn't run,
 * and packs that didn't build. Only a lint block is a block, so the heading is
 * "Unavailable (n)". Each row keeps the line it already has.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const LINT = "Probe was blocked because it loads code from outside its own folder. "
  + "Nothing was installed, and your wall is unchanged. If you made this pack, run pack lint to see what to fix.";
const BUILT = "Star Sines couldn't be built, so it wasn't installed.";
const CHECK = "Couldn't safety-check Marble, so it wasn't installed.";

describe("view picker: Unavailable (n), each row keeps its own line", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("counts all three kinds under Unavailable, and only the lint row says blocked", async () => {
    const {
      blockedCatalogEntries,
      blockedViewSelectRow,
      formatBlockedCatalogNotice,
      syncBlockedCatalogFromErrors,
    } = await import("./pack-install-surface");
    const { viewSelectOptions } = await import("./plugin");
    syncBlockedCatalogFromErrors([
      {
        error: "pack_install_blocked",
        reasonCode: "pack_blocked",
        name: "Probe",
        message: LINT,
        zip: "/tmp/probe.zip",
      },
      {
        error: "pack_install_blocked",
        reasonCode: "pack_build_failed",
        name: "Star Sines",
        message: BUILT,
        zip: "/tmp/star.zip",
      },
      {
        error: "pack_install_blocked",
        reasonCode: "install_unchecked",
        name: "Marble",
        message: CHECK,
        zip: "/tmp/marble.zip",
      },
    ]);
    const entries = blockedCatalogEntries();
    expect(entries).toHaveLength(3);
    expect(blockedViewSelectRow(entries)?.label).toBe("Unavailable (3)");
    expect(viewSelectOptions().some((o) => o.label === "Unavailable (3)")).toBe(true);

    const notice = formatBlockedCatalogNotice(entries);
    const parts = notice.split("\n\n");
    const lint = parts.find((p) => p.includes("was blocked"));
    const built = parts.find((p) => p.includes("couldn't be built"));
    const check = parts.find((p) => p.startsWith("Couldn't safety-check"));
    expect(lint).toContain(LINT);
    expect(built).toBe(`${BUILT}\nZip folder: /tmp`);
    expect(built?.toLowerCase()).not.toContain("blocked");
    expect(built).not.toContain("pack lint");
    expect(check).toBe(`${CHECK}\nZip folder: /tmp`);
    expect(check?.toLowerCase()).not.toContain("blocked");
  });
});
