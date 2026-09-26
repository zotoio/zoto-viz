#!/usr/bin/env node
/**
 * Backrooms stage sky smoke render (headless Chromium).
 * Requires a running monitor UI (7020 after `pnpm build`, or Vite on 5173).
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/";
const NEAR_BLACK = { r: 5, g: 10, b: 22 };
const NEAR_EPS = 10;

function installStorage() {
  localStorage.setItem("zoto-viz.mic", "off");
  localStorage.setItem("zoto-viz.autoconsent", "1");
  localStorage.setItem("zoto-viz.tsPlugins", "1");
  localStorage.setItem("zoto-viz.mode", "plugin:backrooms");
  localStorage.setItem("zoto-viz.anim.dice", "0");
  localStorage.setItem("zoto-viz.anim.mosaic", "off");
}

function installGlErrorHooks() {
  if (window.__zotoGlHooked) return;
  window.__zotoGlHooked = true;
  window.__zotoSmoke ||= { glErrors: [], sandboxGlErrors: [] };
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attrs) {
    const ctx = origGetContext.call(this, type, attrs);
    if (!ctx) return ctx;
    const t = String(type);
    if (t !== "webgl" && t !== "webgl2" && t !== "experimental-webgl") return ctx;
    const gl = ctx;
    const origGetError = gl.getError.bind(gl);
    gl.getError = function patchedGetError() {
      const code = origGetError();
      if (code) {
        if (window.parent !== window) {
          window.parent.postMessage({ source: "zoto-viz-smoke", type: "gl-error", code }, "*");
        } else {
          window.__zotoSmoke.glErrors.push(code);
        }
      }
      return code;
    };
    return ctx;
  };
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d?.source === "zoto-viz-smoke" && d.type === "gl-error") {
      window.__zotoSmoke.sandboxGlErrors.push(d.code);
    }
  });
}

async function waitAnimationFrames(page, count) {
  await page.evaluate(async (n) => {
    let left = n;
    await new Promise((resolve) => {
      const step = () => {
        left -= 1;
        if (left <= 0) resolve(undefined);
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, count);
}

async function readCenterBlock(page) {
  return page.evaluate(({ NEAR_BLACK, NEAR_EPS }) => {
    const canvas = document.querySelector("#scene canvas") ?? document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "no-canvas" };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return { ok: false, reason: "no-gl" };
    const block = 8;
    const cx = (canvas.width / 2) | 0;
    const cy = (canvas.height / 2) | 0;
    const x0 = Math.max(0, cx - (block / 2 | 0));
    const y0 = Math.max(0, cy - (block / 2 | 0));
    const px = new Uint8Array(block * block * 4);
    gl.readPixels(x0, y0, block, block, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n += 1;
    }
    const avg = { r: r / n, g: g / n, b: b / n };
    return { ok: true, avg, samples: n, canvas: { w: canvas.width, h: canvas.height } };
  }, { NEAR_BLACK, NEAR_EPS });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const webglConsole = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(installStorage);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120_000);
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("WebGL:")) {
      webglConsole.push({ frame: msg.location().url || "page", text: t });
    }
  });

  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
  if (await page.getByRole("button", { name: "Not now" }).count()) {
    await page.getByRole("button", { name: "Not now" }).first().click();
  }

  await page.waitForFunction(async () => {
    const r = await fetch("/api/plugins");
    if (!r.ok) return false;
    const body = await r.json();
    return Array.isArray(body.plugins) && body.plugins.some((p) => p.id === "backrooms");
  }, { timeout: 120_000 });

  await page.waitForFunction(
    () => !!document.querySelector('iframe[src*="plugin-sandbox.html"]'),
    { timeout: 120_000 },
  );

  await page.waitForFunction(() => {
    const steps = window.__zotoSandboxBoot ?? [];
    return steps.includes("frame-ready") && steps.includes("ready");
  }, { timeout: 120_000 });

  const bootMeta = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[src*="plugin-sandbox.html"]');
    return {
      src: iframe?.getAttribute("src") ?? "",
      srcdoc: iframe?.getAttribute("srcdoc"),
      boot: window.__zotoSandboxBoot ?? [],
    };
  });
  assert.ok(bootMeta.src.includes("plugin-sandbox.html"), `expected plugin-sandbox.html bootstrap, got src=${bootMeta.src || "(none)"}`);
  assert.ok(!bootMeta.srcdoc, "plugin sandbox must not use srcdoc under page CSP");

  await page.evaluate(installGlErrorHooks);
  await waitAnimationFrames(page, 30);

  const smoke = await page.evaluate(() => ({
    boot: window.__zotoSandboxBoot ?? [],
    glErrors: window.__zotoSmoke?.glErrors ?? [],
    sandboxGlErrors: window.__zotoSmoke?.sandboxGlErrors ?? [],
  }));

  assert.ok(smoke.boot.includes("ready"), "sandbox ready message must reach the host");
  assert.ok(smoke.boot.includes("frame-ready"), "sandbox frame-ready must reach the host");

  assert.equal(smoke.glErrors.length, 0, `expected zero page gl.getError() codes, got ${smoke.glErrors.join(",")}`);
  assert.equal(smoke.sandboxGlErrors.length, 0, `expected zero sandbox gl.getError() codes, got ${smoke.sandboxGlErrors.join(",")}`);

  const sandboxWebgl = webglConsole.filter((line) => /plugin-sandbox|about:srcdoc|srcdoc/i.test(line.frame));
  const pageWebgl = webglConsole.filter((line) => !/plugin-sandbox|about:srcdoc|srcdoc/i.test(line.frame));
  assert.equal(pageWebgl.length, 0, `expected zero page WebGL: console lines, got ${JSON.stringify(pageWebgl)}`);
  assert.equal(sandboxWebgl.length, 0, `expected zero sandbox WebGL: console lines, got ${JSON.stringify(sandboxWebgl)}`);

  const pixels = await readCenterBlock(page);
  assert.ok(pixels.ok, `center pixel read failed: ${pixels.reason ?? "unknown"}`);
  const { avg } = pixels;
  const near =
    Math.abs(avg.r - NEAR_BLACK.r) < NEAR_EPS
    && Math.abs(avg.g - NEAR_BLACK.g) < NEAR_EPS
    && Math.abs(avg.b - NEAR_BLACK.b) < NEAR_EPS;
  assert.ok(!near, `center block average is near-black ${JSON.stringify(avg)}`);
  assert.ok(avg.r > avg.b + 15 && avg.g > avg.b + 10, `expected yellow-ish center (R,G > B), got ${JSON.stringify(avg)}`);
  assert.ok(avg.r >= 35 && avg.g >= 30, `expected warm yellow center, got ${JSON.stringify(avg)}`);

  await browser.close();
  console.log("backrooms-smoke: ok", JSON.stringify({ avg, boot: smoke.boot }));
}

run().catch((err) => {
  console.error("backrooms-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
