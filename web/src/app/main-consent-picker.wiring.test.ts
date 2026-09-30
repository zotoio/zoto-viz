/**
 * After #169: every header-picker refresh goes through setHeaderPickerOptions() (options AND the
 * unavailable-pack setup banner). A consent change used to call modeSel.setOptions() directly, so
 * the banner stayed stale. Boots the real main.ts entry (same harness as main.wiring.test.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(here, "../../index.html"), "utf8");
const bodyHtml = (indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "").replace(
  /<script[\s\S]*?<\/script>/gi,
  "",
);
const FIX = "Run `pnpm install` in `web/` on the server, then reload.";

class MockWebSocket {
  constructor(_url: string) {}
  close() {}
  addEventListener() {}
}

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
    vi.resetModules();
    document.body.innerHTML = "";
  });

  beforeEach(async () => {
    expect.hasAssertions();
    document.body.innerHTML = bodyHtml;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.resetModules();
    await import("./main");
    await vi.waitFor(() => document.querySelector("#modeBox #mode button") !== null, { timeout: 10_000, interval: 20 });
    await ticks(48);
  });

  it("after a consent change, the header picker's options and its unavailable banner both refresh", { timeout: 20_000 }, async () => {
    // Same module instances main.ts bound to (imported after it, no reset in between).
    const { setUnavailableCatalog } = await import("../plugins/plugin-unavailable");
    const { noteConsentGranted } = await import("./consent-store");
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
