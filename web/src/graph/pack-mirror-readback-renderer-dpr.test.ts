/**
 * @vitest-environment node
 *
 * Host readback at browser zoom 100% / 150% / 200% with renderer clamp (min(window, 1.5)).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import {
  PACK_MIRROR_READBACK_CHROME_PATH,
  requireReadbackChrome,
} from "./pack-mirror-readback-chrome";
import { packMirrorReadbackViteServerOptions } from "./pack-mirror-readback-vite-server";

requireReadbackChrome();

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SWIFT_SHADER_ARGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--use-angle=swiftshader-webgl",
  "--enable-unsafe-swiftshader",
];

/** QE browser zoom ↔ harness `windowDpr` (renderer uses min(windowDpr, 1.5)). */
const ZOOM_CASES = [
  { label: "100% zoom", windowDpr: 1, rendererDpr: 1, stubWindowDpr: false },
  { label: "150% zoom", windowDpr: 1.5, rendererDpr: 1.5, stubWindowDpr: false },
  { label: "200% zoom", windowDpr: 2, rendererDpr: 1.5, stubWindowDpr: true },
] as const;

let vite: ViteDevServer | undefined;
let httpServer: http.Server | undefined;
let browser: Browser | undefined;
let baseUrl = "";

async function runQuadrantCase(
  page: Page,
  c: { windowDpr: number; rendererDpr: number; stubWindowDpr: boolean },
): Promise<void> {
  if (c.stubWindowDpr) {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => 2,
      });
    });
  }
  let pageError = "";
  page.on("pageerror", (err) => { pageError = String(err); });
  const url = `${baseUrl}/pack-mirror-readback.html?mode=quadrant&windowDpr=${c.windowDpr}&rendererDpr=${c.rendererDpr}&aa=0&path=host`;
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  for (let i = 0; i < 100; i++) {
    if (pageError) throw new Error(pageError);
    const state = await page.evaluate(() => ({
      err: (window as unknown as { __readbackError?: string }).__readbackError,
      ok: (window as unknown as { __readbackOk?: { quadrantTlOk?: boolean } }).__readbackOk,
    }));
    if (state.err) throw new Error(state.err);
    if (state.ok) {
      expect(state.ok.quadrantTlOk).toBe(true);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(pageError || "quadrant readback did not finish");
}

beforeAll(async () => {
  vite = await createServer({
    configFile: path.join(webRoot, "vite.config.ts"),
    server: packMirrorReadbackViteServerOptions(),
  });
  httpServer = http.createServer((req, res) => vite!.middlewares(req, res));
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  const port = (httpServer!.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await puppeteer.launch({
    executablePath: PACK_MIRROR_READBACK_CHROME_PATH,
    headless: true,
    args: SWIFT_SHADER_ARGS,
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (httpServer) {
    await new Promise<void>((resolve, reject) => httpServer!.close((e) => (e ? reject(e) : resolve())));
  }
  await vite?.close();
});

describe("pack mirror readback renderer DPR boundary", () => {
  for (const c of ZOOM_CASES) {
    it(`${c.label} (windowDpr=${c.windowDpr} rendererDpr=${c.rendererDpr})`, async () => {
      const page = await browser!.newPage();
      try {
        await runQuadrantCase(page, c);
      } finally {
        await page.close();
      }
    }, 90_000);
  }
});
