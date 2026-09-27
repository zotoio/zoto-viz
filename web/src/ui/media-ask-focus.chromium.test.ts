import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Harness = {
  reset(): void;
  openMicAsk(): Promise<unknown>;
  activeSelector(): string;
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

async function openMicAsk(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as Window & { __mediaAskFocusHarness: Harness }).__mediaAskFocusHarness;
    h.reset();
    void h.openMicAsk();
  });
}

function activeSelector(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __mediaAskFocusHarness: Harness }).__mediaAskFocusHarness.activeSelector());
}

describe("media ask focus (chromium)", () => {
  beforeAll(async () => {
    server = await createServer({
      configFile: path.join(webRoot, "vite.config.ts"),
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

  it("cycles Tab from Not now back to Allow while the dialog is open", async () => {
    expect.hasAssertions();
    const page = await harnessPage();
    await openMicAsk(page);
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    expect(await activeSelector(page)).toBe("allow");
    await page.keyboard.press("Shift+Tab");
    expect(await activeSelector(page)).toBe("not-now");
    await page.keyboard.press("Tab");
    expect(await activeSelector(page)).toBe("allow");
    await page.close();
  });

  it("keeps the Reload notice action unreachable while the dialog is open", async () => {
    expect.hasAssertions();
    const page = await harnessPage();
    await openMicAsk(page);
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      expect(await activeSelector(page)).not.toBe(".wall-notice-action");
    }
    await page.close();
  });

  it("never focuses the Reload notice across ten Tab presses", async () => {
    expect.hasAssertions();
    const page = await harnessPage();
    await openMicAsk(page);
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press("Tab");
      expect(await activeSelector(page)).not.toBe(".wall-notice-action");
    }
    await page.close();
  });

  it("closes on Escape with no microphone request", async () => {
    expect.hasAssertions();
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/test-pages/media-ask-focus.html`);
    await page.waitForFunction(() => (window as Window & { __mediaAskFocusHarness?: Harness }).__mediaAskFocusHarness);
    await page.evaluate(() => {
      (window as Window & { __gumCalls?: number }).__gumCalls = 0;
      navigator.mediaDevices.getUserMedia = () => {
        (window as Window & { __gumCalls?: number }).__gumCalls = ((window as Window & { __gumCalls?: number }).__gumCalls ?? 0) + 1;
        return new Promise(() => { /* hang */ });
      };
      void (window as Window & { __mediaAskFocusHarness: Harness }).__mediaAskFocusHarness.openMicAsk();
    });
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    await page.keyboard.press("Escape");
    await expect.poll(async () => await page.locator("[data-media-ask]").count()).toBe(0);
    const gumCalls = await page.evaluate(() => (window as Window & { __gumCalls?: number }).__gumCalls ?? 0);
    expect(gumCalls).toBe(0);
    await page.evaluate(() => {
      void (window as Window & { __mediaAskFocusHarness: Harness }).__mediaAskFocusHarness.openMicAsk();
    });
    await expect.poll(async () => await page.locator("[data-media-ask]").count()).toBe(0);
    await page.reload();
    await page.waitForFunction(() => (window as Window & { __mediaAskFocusHarness?: Harness }).__mediaAskFocusHarness);
    await page.evaluate(() => {
      void (window as Window & { __mediaAskFocusHarness: Harness }).__mediaAskFocusHarness.openMicAsk();
    });
    await expect.poll(async () => await page.locator("[data-media-ask]").count()).toBe(0);
    await page.close();
  });

  it("returns focus to the header mic toggle on a fresh load after Escape", async () => {
    expect.hasAssertions();
    const page = await harnessPage();
    await openMicAsk(page);
    await page.waitForSelector("[data-media-ask]", { state: "attached" });
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-media-ask]", { state: "detached" });
    expect(await activeSelector(page)).toBe("#mic");
    await page.close();
  });
});
