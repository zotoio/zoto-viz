/**
 * After #169: every header-picker refresh goes through setHeaderPickerOptions() (options AND the
 * unavailable-pack setup banner). A consent change used to call modeSel.setOptions() directly, so
 * the banner stayed stale. Boots the real main.ts entry (same harness as main.wiring.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// #252, as #239: the page first, then main.ts, both while the file is collected (see main-entry-env.ts).
import "../../test-support/main-entry-env";
import "./main";
// Same module instances main.ts bound to (one registry for the file, never reset).
import { setUnavailableCatalog } from "../plugins/plugin-unavailable";
import { noteConsentGranted } from "./consent-store";

const FIX = "Run `pnpm install` in `web/` on the server, then reload.";

async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The header view picker's listbox (rendered even while closed). */
function headerMenu(): HTMLElement {
  const btn = document.querySelector<HTMLButtonElement>("#modeBox #mode button")!;
  return document.getElementById(btn.getAttribute("aria-controls")!)!;
}

function menuState(): { banner: string | null; koiRow: boolean } {
  const menu = headerMenu();
  return {
    banner: menu.querySelector("li.menu-banner[role='note']")?.textContent ?? null,
    koiRow: !!menu.querySelector("li[data-value='__unavailable__:koi-pond']"),
  };
}

describe("main entry: consent change refreshes the header picker through one path", () => {
  afterEach(async () => {
    await ticks(8);
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  beforeEach(async () => {
    expect.hasAssertions();
    await vi.waitFor(() => document.querySelector("#modeBox #mode button") !== null);
    await ticks(48);
  });

  it("after a consent change, the header picker's options and its unavailable banner both refresh", async () => {
    expect(menuState()).toEqual({ banner: null, koiRow: false });
    // The catalog now says a pack can't load, but nothing has refreshed the picker yet.
    setUnavailableCatalog([{ id: "koi-pond", name: "Koi Pond", reason: "esbuild_unavailable" }]);
    expect(menuState()).toEqual({ banner: null, koiRow: false });
    noteConsentGranted({ id: "pulse-ts" }, "reviewed");
    await ticks(2); // the listener refreshes on a microtask
    expect(menuState(), "options and banner refresh together").toEqual({
      banner: `1 pack can't load until setup is finished. ${FIX}`,
      koiRow: true,
    });
  });
});
