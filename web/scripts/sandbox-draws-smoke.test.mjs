#!/usr/bin/env node
/**
 * Sandbox pack draws-or-not smoke (headless Chromium + running monitor).
 * On failure, logs CSP violations, CORS console lines, bootstrap/module status separately.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import {
  fetchPackAssetToken,
  packAssetNullOriginGetHeaders,
  packAssetUrl,
} from "./pack-asset-smoke-util.mjs";

const base = (process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/").replace(/\/?$/, "/");
const WAIT_MS = 120_000;
const NEAR_BLACK = { r: 5, g: 10, b: 22 };
const NEAR_BLACK_TOL = 14;
const webRoot = path.dirname(fileURLToPath(import.meta.url));

const PACKS = [
  { mode: "plugin:talker-storm", label: "talker-storm" },
  { mode: "plugin:blob-mesh", label: "blob-mesh" },
  { mode: "plugin:marble-run", label: "marble-run" },
  { mode: "plugin:sandbox-fixture-multi", label: "sandbox-fixture-multi", multiFile: true },
];

function sandboxJsName() {
  const html = readFileSync(path.join(webRoot, "../dist/plugin-sandbox.html"), "utf8");
  const m = html.match(/assets\/(plugin-sandbox-[^"]+\.js)/);
  return m?.[1] ?? null;
}

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
  return {
    center: avgBlock(png.data, w, h, w / 2, h / 2),
    side: avgBlock(png.data, w, h, Math.floor(w * 0.2), Math.floor(h * 0.35)),
  };
}

async function waitForDraw(page, label) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const { center, side } = await sampleScene(page);
    if (!nearBlack(center) || !nearBlack(side)) return { center, side };
    await page.waitForTimeout(500);
  }
  throw new Error(`${label}: canvas stayed near-black`);
}

async function main() {
  const { token: sandboxTok, csrf: sandboxCsrf } = await fetchPackAssetToken(base, "_sandbox");
  const { token: multiTok, csrf: multiCsrf } = await fetchPackAssetToken(base, "sandbox-fixture-multi");
  const jsName = sandboxJsName();
  let bootstrapJsStatus = null;
  let moduleJsStatus = null;
  if (jsName) {
    const boot = await fetch(packAssetUrl(base, sandboxTok, "_sandbox", jsName), {
      headers: packAssetNullOriginGetHeaders(sandboxCsrf),
    });
    bootstrapJsStatus = boot.status;
  }

  const multiMod = await fetch(packAssetUrl(base, multiTok, "sandbox-fixture-multi", "module.js"), {
    headers: packAssetNullOriginGetHeaders(multiCsrf),
  });
  const multiHelper = await fetch(packAssetUrl(base, multiTok, "sandbox-fixture-multi", "helper.js"), {
    headers: packAssetNullOriginGetHeaders(multiCsrf),
  });
  assert.equal(multiMod.status, 200, `fixture module.js ${multiMod.status}`);
  assert.equal(multiHelper.status, 200, `fixture helper.js ${multiHelper.status}`);
  assert.equal(multiMod.headers.get("referrer-policy"), "no-referrer");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const diag = { cspViolations: [], corsConsole: [], bootstrapJsStatus, moduleJsStatus, jsName, pack403: [] };

  page.on("response", (resp) => {
    const u = resp.url();
    if (u.includes("/pack-assets/") && resp.status() === 403) {
      diag.pack403.push({ url: u.replace(/\/pack-assets\/[^/]+/, "/pack-assets/<sandbox-token>"), status: 403 });
    }
  });

  page.on("console", (msg) => {
    const t = msg.text();
    if (/blocked by CORS policy/i.test(t)) diag.corsConsole.push(t);
    const m = t.match(/module (\d{3})/i);
    if (m) moduleJsStatus = Number(m[1]);
  });
  await page.addInitScript(() => {
    window.__zotoCspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__zotoCspViolations.push({
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
      });
    });
  });

  for (const pack of PACKS) {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.evaluate(installProfile, pack.mode);
    await page.reload({ waitUntil: "networkidle", timeout: WAIT_MS });
    try {
      await waitForDraw(page, pack.label);
      if (pack.multiFile) {
        assert.equal(diag.pack403.length, 0, JSON.stringify(diag.pack403));
      }
    } catch (err) {
      diag.cspViolations = await page.evaluate(() => window.__zotoCspViolations ?? []);
      diag.moduleJsStatus = moduleJsStatus;
      const srcdoc = diag.cspViolations.filter((v) => String(v.blockedURI || "").includes("srcdoc"));
      console.error("sandbox-draws-smoke: FAIL", JSON.stringify({
        pack: pack.label,
        ...diag,
        srcdocViolations: srcdoc,
        message: err?.message,
      }, null, 2));
      await browser.close();
      process.exit(1);
    }
    console.log("sandbox-draws-smoke:", pack.label, "ok");
  }

  await browser.close();
  console.log("sandbox-draws-smoke: ok", PACKS.map((p) => p.label).join(", "));
}

main().catch((err) => {
  console.error("sandbox-draws-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
