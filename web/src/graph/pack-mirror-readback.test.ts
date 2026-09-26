/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { assertPackMirrorRenderer } from "./pack-mirror-renderer-gate";
import {
  PACK_MIRROR_READBACK_CHROME_PATH,
  requireReadbackChrome,
} from "../../test/node/pack-mirror-readback-chrome";
import {
  acquirePackMirrorReadbackVite,
  releasePackMirrorReadbackVite,
} from "../../test/node/pack-mirror-readback-vite";

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
  vite = await acquirePackMirrorReadbackVite();
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
  await releasePackMirrorReadbackVite();
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

/** QE browser zoom ↔ harness `windowDpr` (renderer uses min(windowDpr, 1.5)). */
const ZOOM_CASES = [
  { label: "100% zoom", windowDpr: 1, rendererDpr: 1, stubWindowDpr: true },
  { label: "150% zoom", windowDpr: 1.5, rendererDpr: 1.5, stubWindowDpr: true },
  { label: "200% zoom", windowDpr: 2, rendererDpr: 1.5, stubWindowDpr: true },
] as const;

async function runQuadrantCase(
  page: Page,
  c: { windowDpr: number; rendererDpr: number; stubWindowDpr: boolean },
): Promise<void> {
  if (c.stubWindowDpr) {
    const dpr = c.windowDpr;
    await page.evaluateOnNewDocument((wDpr) => {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => wDpr,
      });
    }, dpr);
  }
  let pageError = "";
  page.on("pageerror", (err) => { pageError = String(err); });
  const url = `${baseUrl}/pack-mirror-readback.html?mode=quadrant&windowDpr=${c.windowDpr}&rendererDpr=${c.rendererDpr}&aa=0&path=host`;
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  for (let i = 0; i < 100; i++) {
    if (pageError) throw new Error(pageError);
    const state = await page.evaluate(() => ({
      err: (window as unknown as { __readbackError?: string }).__readbackError,
      ok: (window as unknown as { __readbackOk?: { quadrantTlOk?: boolean; quadrantBrOk?: boolean } }).__readbackOk,
    }));
    if (state.err) throw new Error(state.err);
    if (state.ok) {
      expect(state.ok.quadrantTlOk).toBe(true);
      expect(state.ok.quadrantBrOk).toBe(true);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(pageError || "quadrant readback did not finish");
}

function rgbaNear(
  px: [number, number, number, number],
  ref: [number, number, number, number],
  tol = 12,
): boolean {
  return (
    Math.abs(px[0] - ref[0]) <= tol
    && Math.abs(px[1] - ref[1]) <= tol
    && Math.abs(px[2] - ref[2]) <= tol
  );
}

const LETTERBOX_READBACK_PRS = [1, 1.5] as const;

async function runLetterbox16x9Case(page: Page, pr: number): Promise<void> {
  let pageError = "";
  page.on("pageerror", (err) => { pageError = String(err); });
  const url = `${baseUrl}/pack-mirror-readback.html?mode=letterbox16x9&windowDpr=${pr}&rendererDpr=${pr}&aa=0`;
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  for (let i = 0; i < 100; i++) {
    if (pageError) throw new Error(pageError);
    const state = await page.evaluate(() => ({
      err: (window as unknown as { __readbackError?: string }).__readbackError,
      ok: (window as unknown as {
        __readbackOk?: {
          topBarRgba?: [number, number, number, number];
          bottomBarRgba?: [number, number, number, number];
          firstSceneRowRgba?: [number, number, number, number];
          firstSceneRowDeviceY?: number;
          expectedFirstSceneRowDeviceY?: number;
          expectedBarRgba?: [number, number, number, number];
        };
      }).__readbackOk,
    }));
    if (state.err) throw new Error(state.err);
    if (state.ok) {
      const ok = state.ok;
      expect(rgbaNear(ok.topBarRgba!, ok.expectedBarRgba!)).toBe(true);
      expect(rgbaNear(ok.bottomBarRgba!, ok.expectedBarRgba!)).toBe(true);
      expect(ok.firstSceneRowDeviceY).toBe(ok.expectedFirstSceneRowDeviceY);
      expect(ok.firstSceneRowRgba![1]).toBeGreaterThan(150);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(pageError || "letterbox16x9 readback did not finish");
}

describe("pack mirror readback 16:9 letterbox (SwiftShader)", () => {
  for (const pr of LETTERBOX_READBACK_PRS) {
    it(`1:1 mirror tile pr ${pr}: bar pixels match surface panel colour, first scene row at offset`, async () => {
      const page = await browser!.newPage();
      try {
        await runLetterbox16x9Case(page, pr);
      } finally {
        await page.close();
      }
    }, 90_000);
  }
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
