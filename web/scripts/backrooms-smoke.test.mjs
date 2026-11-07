#!/usr/bin/env node
/**
 * Backrooms first-load smoke (headless Chromium).
 * Fresh storage, Backrooms selected before first mount, feed + chat open.
 * Requires a running monitor UI (7020 after `pnpm build`, or Vite on 5173).
 */
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import {
  SMOKE_STAGE_CANVAS_SELECTORS,
  screenshotBox,
  seedSmokeProfile,
  smokeProfileSettings,
} from "./smoke-profile-util.mjs";

const base = process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/";
const PRESENT_FRAMES = 30;
const PRESENT_WAIT_MS = 300_000;
const NEAR_BLACK = { r: 5, g: 10, b: 22 };
const NEAR_BLACK_TOL = 12;
/** Corridor fluoro yellow (sRGB) with tolerance — not exact pixel match. */
const CORRIDOR_YELLOW = { r: 188, g: 168, b: 78 };
const CORRIDOR_TOL = { r: 75, g: 75, b: 60 };
/** Corridor walls and ceiling fill most of the frame; a near-black or failed sky has none. */
const CORRIDOR_MIN_SHARE = 0.25;

function installFirstLoadProfile() {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("zoto-viz.mic", "off");
  localStorage.setItem("zoto-viz.autoconsent", "1");
  localStorage.setItem("zoto-viz.tsPlugins", "1");
  localStorage.setItem("zoto-viz.mode", "plugin:backrooms");
  localStorage.setItem("zoto-viz.anim.dice", "0");
  localStorage.setItem("zoto-viz.anim.mosaic", "off");
  localStorage.setItem("zoto-viz.feed.on", "1");
  localStorage.setItem("zoto-viz.chat.on", "1");
  localStorage.setItem("zoto-viz.smoke.backrooms", "1");
  window.__zotoCspViolations = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__zotoCspViolations.push({
      blockedURI: e.blockedURI,
      violatedDirective: e.violatedDirective,
      sourceFile: e.sourceFile,
      lineNumber: e.lineNumber,
    });
  });
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

function averageCenterBlock(data, width, height, block = 16) {
  const cx = (width / 2) | 0;
  const cy = (height / 2) | 0;
  const half = (block / 2) | 0;
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const x1 = Math.min(width, x0 + block);
  const y1 = Math.min(height, y0 + block);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (width * y + x) << 2;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n, samples: n };
}

function inCorridorYellowBand(avg) {
  return (
    Math.abs(avg.r - CORRIDOR_YELLOW.r) <= CORRIDOR_TOL.r
    && Math.abs(avg.g - CORRIDOR_YELLOW.g) <= CORRIDOR_TOL.g
    && Math.abs(avg.b - CORRIDOR_YELLOW.b) <= CORRIDOR_TOL.b
    && avg.r > avg.b + 12
    && avg.g > avg.b + 8
  );
}

/** Share of the stage's pixels inside the corridor yellow band. */
function corridorShare(data) {
  let hit = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (inCorridorYellowBand({ r: data[i], g: data[i + 1], b: data[i + 2] })) hit++;
  }
  return hit / n;
}

function isNearBlack(avg) {
  return (
    Math.abs(avg.r - NEAR_BLACK.r) < NEAR_BLACK_TOL
    && Math.abs(avg.g - NEAR_BLACK.g) < NEAR_BLACK_TOL
    && Math.abs(avg.b - NEAR_BLACK.b) < NEAR_BLACK_TOL
  );
}

async function waitPresentedFrames(page, target) {
  try {
    await page.waitForFunction(
      (n) => (window.__zotoSmokePresentedFrames ?? 0) >= n,
      target,
      { timeout: PRESENT_WAIT_MS },
    );
  } catch {
    const seen = await page.evaluate(() => window.__zotoSmokePresentedFrames ?? 0);
    assert.fail(`pack never presented ${target} frames (saw ${seen})`);
  }
}

async function run() {
  // The startup profile load would otherwise replace the localStorage view with topology.
  await seedSmokeProfile(base, smokeProfileSettings("plugin:backrooms", { feed: { on: true }, chat: { on: true } }));
  const browser = await chromium.launch({ headless: true });
  const webglConsole = [];
  const ctx = await browser.newContext({
    // Software GL on a CI runner raymarches the corridor per pixel; at 1280x800 the page's main
    // thread stalls for minutes between frames. The smoke checks that it draws, not at what size.
    viewport: { width: 800, height: 500 },
    storageState: { cookies: [], origins: [] },
  });
  await ctx.addInitScript(installFirstLoadProfile);
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
    () => document.body.classList.contains("feed-open") && document.body.classList.contains("chat-open"),
    { timeout: 30_000 },
  );

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
      mode: localStorage.getItem("zoto-viz.mode"),
    };
  });
  assert.equal(bootMeta.mode, "plugin:backrooms");
  assert.ok(bootMeta.src.includes("plugin-sandbox.html"), `expected plugin-sandbox.html bootstrap, got src=${bootMeta.src || "(none)"}`);
  assert.ok(!bootMeta.srcdoc, "plugin sandbox must not use srcdoc under page CSP");

  await waitPresentedFrames(page, PRESENT_FRAMES);

  const smoke = await page.evaluate(() => ({
    boot: window.__zotoSandboxBoot ?? [],
    presented: window.__zotoSmokePresentedFrames ?? 0,
    glErrors: window.__zotoSmoke?.glErrors ?? [],
    sandboxGlErrors: window.__zotoSmoke?.sandboxGlErrors ?? [],
    csp: window.__zotoCspViolations ?? [],
  }));

  assert.ok(smoke.boot.includes("ready"), "sandbox ready message must reach the host");
  assert.ok(smoke.presented >= PRESENT_FRAMES, `expected at least ${PRESENT_FRAMES} presented frames, saw ${smoke.presented}`);
  assert.equal(smoke.glErrors.length, 0, `expected zero page gl.getError() codes, got ${smoke.glErrors.join(",")}`);
  assert.equal(smoke.sandboxGlErrors.length, 0, `expected zero sandbox gl.getError() codes, got ${smoke.sandboxGlErrors.join(",")}`);
  assert.equal(smoke.csp.length, 0, `expected zero CSP violations, got ${JSON.stringify(smoke.csp)}`);
  const srcdocViolations = smoke.csp.filter((v) => String(v.blockedURI || v.sourceFile || "").includes("srcdoc"));
  assert.equal(srcdocViolations.length, 0, `about:srcdoc CSP violations: ${JSON.stringify(srcdocViolations)}`);

  const sandboxWebgl = webglConsole.filter((line) => /plugin-sandbox|about:srcdoc|srcdoc/i.test(line.frame));
  const pageWebgl = webglConsole.filter((line) => !/plugin-sandbox|about:srcdoc|srcdoc/i.test(line.frame));
  assert.equal(pageWebgl.length, 0, `expected zero page WebGL: console lines, got ${JSON.stringify(pageWebgl)}`);
  assert.equal(sandboxWebgl.length, 0, `expected zero sandbox WebGL: console lines, got ${JSON.stringify(sandboxWebgl)}`);

  // Backrooms draws on the wall render-host canvas (sandbox plugin); #scene is a transparent host shell.
  const stageCanvas = page.locator("#wall canvas.render-host, #scene canvas").first();
  const pngBuffer = await screenshotBox(page, stageCanvas, undefined, SMOKE_STAGE_CANVAS_SELECTORS);
  const png = PNG.sync.read(pngBuffer);
  const avg = averageCenterBlock(png.data, png.width, png.height, Math.min(png.width, png.height));
  assert.ok(!isNearBlack(avg), `stage screenshot is near-black ${JSON.stringify(avg)}`);
  // The entity's chase is not pinned and can stand in front of any one spot, so judge the share of
  // the stage that is corridor yellow rather than a single centre block.
  const yellow = corridorShare(png.data);
  assert.ok(
    yellow >= CORRIDOR_MIN_SHARE,
    `expected >= ${CORRIDOR_MIN_SHARE * 100}% of the stage in the corridor yellow band around ${JSON.stringify(CORRIDOR_YELLOW)} ± ${JSON.stringify(CORRIDOR_TOL)}, got ${(yellow * 100).toFixed(1)}% (centre avg ${JSON.stringify(avg)})`,
  );

  await browser.close();
  console.log("backrooms-smoke: ok", JSON.stringify({ avg, yellow, presented: smoke.presented, boot: smoke.boot }));
}

run().catch((err) => {
  console.error("backrooms-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
