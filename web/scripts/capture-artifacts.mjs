#!/usr/bin/env node
/**
 * Functional PR artifacts: mosaic tile switch, pack smoke, consent notice.
 * No frame-time / fps pass lines (VM has no real GPU).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const outDir = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts";
mkdirSync(outDir, { recursive: true });
const base = process.env.ZOTO_VIZ_URL || "http://127.0.0.1:5173/";

const NEAR_BLACK = { r: 5, g: 10, b: 22 };

async function waitPlugins(page) {
  await page.waitForFunction(async () => {
    const r = await fetch("/api/plugins");
    return r.ok;
  }, { timeout: 60_000 }).catch(() => {});
}

async function captureMosaicSwitch() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    recordVideo: { dir: outDir, size: { width: 1400, height: 900 } },
  });
  await ctx.addInitScript(() => {
    localStorage.setItem("zoto-viz.mic", "off");
    localStorage.setItem("zoto-viz.autoconsent", "1");
    localStorage.setItem("zoto-viz.mode", "plugin:star-sines");
    localStorage.setItem("zoto-viz.anim.mosaic", "2");
    localStorage.setItem(
      "zoto-viz.anim.mosaicTiles",
      JSON.stringify(["plugin:star-sines", "plugin:kefrens-bars"]),
    );
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push(String(e.violatedDirective));
    });
  });
  const page = await ctx.newPage();
  const webglSpam = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("Content Security Policy") || t.includes("about:srcdoc")) webglSpam.push(t);
    if (t.includes("WebGL:")) webglSpam.push(t);
  });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (await page.getByRole("button", { name: "Not now" }).count()) {
    await page.getByRole("button", { name: "Not now" }).first().click();
  }
  await waitPlugins(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "set_settings",
          arguments: {
            autoconsent: true,
            mode: "plugin:star-sines",
            anim: { mosaic: "2", mosaicTiles: ["plugin:star-sines", "plugin:kefrens-bars"] },
          },
        },
      }),
    });
  });
  await page.waitForTimeout(12_000);
  const picks = page.locator(".mosaic-pick");
  const n = await picks.count();
  if (n >= 1) {
    const pick = picks.first();
    const opts = await pick.locator("option").evaluateAll((els) => els.map((o) => o.value));
    const start = await pick.inputValue();
    const alt = opts.find((v) => v.startsWith("plugin:") && v !== start) ?? opts[1];
    for (let i = 0; i < 20; i++) {
      const to = i % 2 === 0 ? alt : start;
      if (to) await pick.selectOption(to).catch(() => {});
      await page.waitForTimeout(350);
    }
  }
  await page.keyboard.press("2");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "mosaic-switch-after.png") });
  const cspCount = await page.evaluate(() => window.__cspViolations?.length ?? 0);
  const smoke = await page.evaluate(({ NEAR_BLACK }) => {
    const canvases = [...document.querySelectorAll("canvas")];
    const samples = canvases.map((c) => {
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      if (!gl) return { ok: true, reason: "no-gl" };
      const px = new Uint8Array(4);
      gl.readPixels((c.width / 2) | 0, (c.height / 2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const near = Math.abs(px[0] - NEAR_BLACK.r) < 8
        && Math.abs(px[1] - NEAR_BLACK.g) < 8
        && Math.abs(px[2] - NEAR_BLACK.b) < 8;
      return { ok: !near || px[3] > 0, rgb: [...px] };
    });
    return { tileLabels: [...document.querySelectorAll(".mosaic-pick")].map((p) => p.value), samples };
  }, { NEAR_BLACK });
  console.log(JSON.stringify({ cspCount, webglSpam: webglSpam.length, smoke }, null, 2));
  const video = page.video();
  await ctx.close();
  if (video) {
    await video.saveAs(path.join(outDir, "mosaic-switch-demo.webm"));
    console.log("wrote", path.join(outDir, "mosaic-switch-demo.webm"));
  }
  await browser.close();
}

async function captureUnconsented() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("zoto-viz.mic", "off");
    localStorage.setItem("zoto-viz.autoconsent", "0");
    localStorage.setItem("zoto-viz.anim.mosaic", "2");
    localStorage.setItem("zoto-viz.anim.mosaicTiles", JSON.stringify(["plugin:topology", "plugin:wifi"]));
  });
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  if (await page.getByRole("button", { name: "Not now" }).count()) {
    await page.getByRole("button", { name: "Not now" }).first().click();
  }
  await waitPlugins(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    await fetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "set_settings", arguments: { autoconsent: false } },
      }),
    });
  });
  await page.waitForTimeout(6000);
  const pick = page.locator(".mosaic-pick").first();
  if (await pick.count()) {
    await pick.selectOption("plugin:hn-rain").catch(async () => {
      const hn = await pick.locator("option").evaluateAll((els) => els.find((o) => o.value.includes("hn-rain"))?.value);
      if (hn) await pick.selectOption(hn);
    });
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: path.join(outDir, "unconsented-tile-notice.png") });
  const notice = await page.locator(".mosaic-pane-notice").first().textContent().catch(() => null);
  console.log("unconsented notice:", notice?.slice(0, 120) ?? "(none)");
  await browser.close();
}

await captureMosaicSwitch();
await captureUnconsented();
