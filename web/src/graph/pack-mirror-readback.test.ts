/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACK_MIRROR_READBACK_CHROME_PATH = process.env.PACK_MIRROR_CHROME_PATH || "/usr/local/bin/google-chrome";
export const PACK_MIRROR_READBACK_CHROME_VERSION = "148.0.7778.96";

const SWIFT_SHADER_ARGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--use-angle=swiftshader-webgl",
  "--enable-unsafe-swiftshader",
];

type Case = { dpr: number; antialias: boolean; path: "host" | "sandbox" };

const CASES: Case[] = [
  { dpr: 1, antialias: false, path: "host" },
  { dpr: 1, antialias: true, path: "host" },
  { dpr: 2, antialias: false, path: "host" },
  { dpr: 2, antialias: true, path: "host" },
  { dpr: 1, antialias: false, path: "sandbox" },
  { dpr: 1, antialias: true, path: "sandbox" },
  { dpr: 2, antialias: false, path: "sandbox" },
  { dpr: 2, antialias: true, path: "sandbox" },
];

let vite: ViteDevServer;
let httpServer: http.Server;
let browser: Browser;
let baseUrl = "";

function chromeVersion(): string {
  const out = execFileSync(PACK_MIRROR_READBACK_CHROME_PATH, ["--version"], { encoding: "utf8" }).trim();
  const m = out.match(/(\d+\.\d+\.\d+\.\d+)/);
  return m?.[1] ?? out;
}

async function runCase(page: Page, c: Case): Promise<unknown> {
  const url = `${baseUrl}/pack-mirror-readback.html?dpr=${c.dpr}&aa=${c.antialias ? 1 : 0}&path=${c.path}`;
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.waitForFunction(
    () => (window as unknown as { __readbackOk?: unknown; __readbackError?: string }).__readbackOk
      || (window as unknown as { __readbackError?: string }).__readbackError,
    { timeout: 60_000 },
  );
  const err = await page.evaluate(() => (window as unknown as { __readbackError?: string }).__readbackError);
  if (err) throw new Error(err);
  return page.evaluate(() => (window as unknown as { __readbackOk: unknown }).__readbackOk);
}

beforeAll(async () => {
  const ver = chromeVersion();
  expect(ver).toContain(PACK_MIRROR_READBACK_CHROME_VERSION.split(".").slice(0, 2).join("."));
  vite = await createServer({
    configFile: path.join(webRoot, "vite.config.ts"),
    server: { middlewareMode: true },
  });
  httpServer = http.createServer((req, res) => vite.middlewares(req, res));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await puppeteer.launch({
    executablePath: PACK_MIRROR_READBACK_CHROME_PATH,
    headless: true,
    args: SWIFT_SHADER_ARGS,
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => httpServer?.close((e) => (e ? reject(e) : resolve())));
  await vite?.close();
});

describe("pack mirror SwiftShader readback", () => {
  for (const c of CASES) {
    it(`dpr=${c.dpr} antialias=${c.antialias} path=${c.path}`, async () => {
      const page = await browser.newPage();
      try {
        const result = await runCase(page, c) as {
          primaryTopLeft: number[];
          mirrorTopLeft: number[];
          letterboxBar: number[];
          contentNonEmpty: boolean;
        };
        expect(result.contentNonEmpty).toBe(true);
        expect(result.primaryTopLeft[0]).toBeGreaterThan(40);
        expect(result.mirrorTopLeft[0]).toBeGreaterThan(40);
        expect(result.letterboxBar[0]).toBeGreaterThan(5);
      } finally {
        await page.close();
      }
    }, 90_000);
  }
});
