import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Harness = {
  reset(): void;
  openMicAsk(): Promise<unknown>;
};

let server: ViteDevServer;
let baseUrl = "";
let browser: Browser;

async function harnessPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/test-pages/media-ask-focus.html`);
  await page.waitForFunction(() => (window as Window & { __mediaAskFocusHarness?: Harness }).__mediaAskFocusHarness);
  return page;
}

describe("media ask UX (chromium)", () => {
  beforeAll(async () => {
    server = await createServer({
      configFile: path.join(webRoot, "vite.config.mjs"),
      server: { port: 0, strictPort: false },
    });
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("vite server has no local URL");
    baseUrl = url.replace(/\/$/, "");
    browser = await chromium.launch({ headless: true });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("blocks focus and click on elements behind the open dialog", async () => {
    expect.hasAssertions();
    const page = await harnessPage();
    await page.evaluate(() => {
      const h = (window as Window & { __mediaAskFocusHarness?: Harness }).__mediaAskFocusHarness!;
      h.reset();
      void h.openMicAsk();
    });
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    const behind = await page.evaluate(() => {
      const reload = document.querySelector(".wall-notice-action") as HTMLButtonElement | null;
      reload?.focus();
      const focusedReload = document.activeElement?.classList.contains("wall-notice-action") ?? false;
      reload?.click();
      const dialogOpen = document.querySelector("[data-media-ask]") !== null;
      return { focusedReload, dialogOpen };
    });
    expect(behind.focusedReload).toBe(false);
    expect(behind.dialogOpen).toBe(true);
    await page.close();
  });
});
