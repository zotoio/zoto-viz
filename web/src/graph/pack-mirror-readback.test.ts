/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type ViteDevServer } from "vite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { assertPackMirrorRenderer } from "./pack-mirror-renderer-gate";
import {
  PACK_MIRROR_READBACK_CHROME_PATH,
  requireReadbackChrome,
} from "./pack-mirror-readback-chrome";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SWIFT_SHADER_ARGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--use-angle=swiftshader-webgl",
  "--enable-unsafe-swiftshader",
];

type Case = { dpr: number; antialias: boolean; path: "host" | "sandbox" };

const DPR_MATRIX = [1, 1.5, 2] as const;
const CASES: Case[] = DPR_MATRIX.flatMap((dpr) => ([
  { dpr, antialias: false, path: "host" as const },
  { dpr, antialias: true, path: "host" as const },
  { dpr, antialias: false, path: "sandbox" as const },
  { dpr, antialias: true, path: "sandbox" as const },
]));

requireReadbackChrome();

let vite: ViteDevServer | undefined;
let httpServer: http.Server | undefined;
let browser: Browser | undefined;
let baseUrl = "";
let matrixCasesExecuted = 0;

async function runCase(page: Page, c: Case): Promise<unknown> {
  let pageError = "";
  page.on("pageerror", (err) => { pageError = String(err); });
  const url = `${baseUrl}/pack-mirror-readback.html?dpr=${c.dpr}&aa=${c.antialias ? 1 : 0}&path=${c.path}`;
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  for (let i = 0; i < 100; i++) {
    if (pageError) throw new Error(pageError);
    const state = await page.evaluate(() => ({
      err: (window as unknown as { __readbackError?: string }).__readbackError,
      ok: (window as unknown as { __readbackOk?: unknown }).__readbackOk,
    }));
    if (state.err) throw new Error(state.err);
    if (state.ok) return state.ok;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(pageError || "readback harness did not finish within 10s");
}

beforeAll(async () => {
  httpServer = http.createServer((req, res) => vite!.middlewares(req, res));
  vite = await createServer({
    configFile: path.join(webRoot, "vite.config.mjs"),
    // No live reload, and Vite's WebSocket rides on this suite's own http server: in middleware mode
    // Vite 8 otherwise listens on the fixed port 24678 (even with hmr:false), so two readback suites
    // in one vitest run clash there and the loser's pages fail "WebSocket closed without opened" (#192).
    server: { middlewareMode: true, hmr: false, ws: { server: httpServer } },
  });
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

describe("pack mirror SwiftShader readback", () => {
  for (const c of CASES) {
    it(`dpr=${c.dpr} antialias=${c.antialias} path=${c.path}`, async () => {
      matrixCasesExecuted += 1;
      const page = await browser!.newPage();
      try {
        const result = await runCase(page, c) as {
          contentNonEmpty: boolean;
          mirrorArrowUp: boolean;
          letterboxColored: boolean;
          glRenderer: string;
        };
        console.log(`[pack-mirror-readback] dpr=${c.dpr} aa=${c.antialias} path=${c.path} renderer=${result.glRenderer}`);
        assertPackMirrorRenderer(result.glRenderer);
        expect(result.contentNonEmpty).toBe(true);
        expect(result.mirrorArrowUp).toBe(true);
        expect(result.letterboxColored).toBe(true);
      } finally {
        await page.close();
      }
    }, 90_000);
  }

  it(`reporter: ${CASES.length} matrix cases run, 0 skipped in this file`, () => {
    expect(matrixCasesExecuted).toBe(CASES.length);
  });
});
