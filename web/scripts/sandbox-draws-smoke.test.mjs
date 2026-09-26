#!/usr/bin/env node
/**
 * Sandbox pack draws-or-not smoke (headless Chromium + running monitor).
 * Revert proof: revert `plugin-pack-feed.ts` startup-failure branch, then
 * `pnpm test:sandbox-draws-smoke` → `plugin-pack-feed.test.ts` red first;
 * locally: `pnpm vitest run src/plugins/plugin-pack-feed.test.ts` after reverting
 * the startup-failure assertion → expect "shows startup failure copy" to fail.
 */
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { chromium } from "playwright";

const base = (process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/").replace(/\/?$/, "/");
const WAIT_MS = 120_000;
const NEAR_BLACK = { r: 5, g: 10, b: 22 };
const NEAR_BLACK_TOL = 14;

/** Shipped sandbox viz packs exercised after opaque-origin bootstrap (koi not in catalog). */
const PACKS = [
  { mode: "plugin:talker-storm", label: "talker-storm" },
  { mode: "plugin:blob-mesh", label: "blob-mesh" },
  { mode: "plugin:marble-run", label: "marble-run" },
];

function installProfile(mode) {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("zoto-viz.mic", "off");
  localStorage.setItem("zoto-viz.autoconsent", "1");
  localStorage.setItem("zoto-viz.tsPlugins", "1");
  localStorage.setItem("zoto-viz.mode", mode);
  localStorage.setItem("zoto-viz.anim.dice", "0");
  localStorage.setItem("zoto-viz.anim.mosaic", "off");
}

function avgBlock(data, width, height, cx, cy, block = 12) {
  const half = (block / 2) | 0;
  const x0 = Math.max(0, ((cx | 0) - half));
  const y0 = Math.max(0, ((cy | 0) - half));
  const x1 = Math.min(width, x0 + block);
  const y1 = Math.min(height, y0 + block);
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function nearBlack(rgb) {
  return (
    Math.abs(rgb.r - NEAR_BLACK.r) <= NEAR_BLACK_TOL
    && Math.abs(rgb.g - NEAR_BLACK.g) <= NEAR_BLACK_TOL
    && Math.abs(rgb.b - NEAR_BLACK.b) <= NEAR_BLACK_TOL
  );
}

async function sampleScene(page) {
  const canvas = page.locator("#scene canvas").first();
  await canvas.waitFor({ state: "visible", timeout: WAIT_MS });
  const png = PNG.sync.read(await canvas.screenshot({ type: "png" }));
  const w = png.width;
  const h = png.height;
  const center = avgBlock(png.data, w, h, w / 2, h / 2);
  const side = avgBlock(png.data, w, h, Math.floor(w * 0.2), Math.floor(h * 0.35));
  return { center, side, w, h };
}

async function waitForDraw(page, label) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { center, side } = await sampleScene(page);
    if (!nearBlack(center) || !nearBlack(side)) {
      return { center, side };
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${label}: canvas stayed near-black (sandbox likely did not draw)`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (/blocked by CORS policy/i.test(msg.text())) {
      throw new Error(msg.text());
    }
  });

  for (const pack of PACKS) {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.evaluate(installProfile, pack.mode);
    await page.reload({ waitUntil: "networkidle", timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector("#mode")?.textContent?.length,
      undefined,
      { timeout: WAIT_MS },
    );
    const pixels = await waitForDraw(page, pack.label);
    console.log("sandbox-draws-smoke:", pack.label, JSON.stringify(pixels));
  }

  await browser.close();
  console.log("sandbox-draws-smoke: ok", PACKS.map((p) => p.label).join(", "));
}

main().catch((err) => {
  console.error("sandbox-draws-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
