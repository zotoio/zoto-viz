/**
 * #240 plain guard (the primary red/green pin is tests/test_pack_refusal_reason_code_240.py): a pack
 * block is recognised by its stable code, `reasonCode: "pack_blocked"` (service/pack_block_copy.py
 * REASON_PACK_BLOCKED), never by the words "was blocked". The three surface callers that used to match
 * those words (isPackInstallBlockedPayload, formatPackInstallBlocked's words-in-`error` fallback, and
 * catalogErrorLooksBlocked, read here through plugin.ts installPlugins) all take the block from the code. The
 * surface shows the service's words as is; it has no copy of its own for them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ZIP = "/home/op/.zoto-viz/plugins/local/upgrade-probe.zip";
/** The code as the service sends it (service/pack_block_copy.py REASON_PACK_BLOCKED). */
const CODE = "pack_blocked";
/** Block words that don't say "was blocked" (nor any other phrase the surface knows). */
const WORDS = "Upgrade probe v1 got stopped because it tries to reach outside its sandbox. Nothing was installed, "
  + "and your wall is unchanged. If you made this pack, run pack lint to see what to fix.";

describe("#240 pack block: the surface branches on reasonCode, not on \"was blocked\"", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a block whose words lack \"was blocked\" is still a block, from the code alone", async () => {
    const surface = await import("./pack-install-surface");
    const {
      blockedCatalogEntries,
      catalogErrorLooksBlocked,
      formatBlockedCatalogNotice,
      formatPackInstallBlocked,
      isPackInstallBlockedPayload,
      takePackInstallBlockedNotice,
    } = surface;
    const { installPlugins } = await import("./plugin");
    expect(WORDS).not.toContain("was blocked");

    // The catalog's fallback row shape (service/plugins.py): the words in `error`, no `message`.
    const row = { file: ZIP, zip: ZIP, error: WORDS, reasonCode: CODE };
    expect(isPackInstallBlockedPayload(row), "reasonCode pack_blocked alone makes it a block").toBe(true);
    expect(formatPackInstallBlocked(row), "the service's words, as is").toBe(WORDS);
    expect(formatPackInstallBlocked({ ...row, error: "pack_install_blocked", message: WORDS })).toBe(WORDS);
    // Without the code the same words are not a block (they don't carry the old phrase either).
    expect(isPackInstallBlockedPayload({ ...row, reasonCode: "" })).toBe(false);
    expect(catalogErrorLooksBlocked(WORDS)).toBe(false);

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ dir: "", schema: "", plugins: [], errors: [row] }),
    }));
    await installPlugins();
    expect(takePackInstallBlockedNotice(), "catalog notice").toBe(WORDS);
    expect(formatBlockedCatalogNotice(blockedCatalogEntries()), "Blocked menu entry").toBe(
      `${WORDS}\nZip folder: /home/op/.zoto-viz/plugins/local`,
    );
    expect(Reflect.get(surface, "PACK_BLOCKED"), "the surface's name for the code").toBe(CODE);
  });
});
