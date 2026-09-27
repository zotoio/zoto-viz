#!/usr/bin/env node
/** Save :7020 screenshots for the three realism packs (no pixel gate). */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/").replace(/\/?$/, "/");
const ART = process.env.ZOTO_VIZ_ARTIFACTS || "/opt/cursor/artifacts";
const PREFIX = process.env.ZOTO_VIZ_SHOT_PREFIX || "after";
const WAIT_MS = 120_000;

const PACKS = [
  { mode: "plugin:rocket-car-soccer", shot: `${PREFIX}-rocket-car-soccer.webp` },
  { mode: "plugin:koi-pond", shot: `${PREFIX}-koi-pond.webp` },
  { mode: "plugin:aquarium", shot: `${PREFIX}-aquarium.webp` },
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
  localStorage.setItem("zoto-viz.feed.on", "0");
  localStorage.setItem("zoto-viz.chat.on", "0");
  sessionStorage.setItem("zoto-viz.mediaDismiss", JSON.stringify({ mic: true, cam: true }));
}

async function applyViewMode(page, mode) {
  await page.waitForFunction(() => !document.body.classList.contains("view-booting"));
  await page.evaluate((m) => {
    localStorage.setItem("zoto-viz.mode", m);
    const box = document.getElementById("modeBox");
    const sel = box?.querySelector("select");
    if (sel) {
      sel.value = m;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, mode);
  await page.waitForTimeout(2000);
}

async function dismissMediaAsk(page) {
  await page.evaluate(() => {
    sessionStorage.setItem("zoto-viz.mediaDismiss", JSON.stringify({ mic: true, cam: true }));
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now");
    btn?.click();
  });
  await page.waitForTimeout(400);
}

async function main() {
  mkdirSync(ART, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage();
  for (const pack of PACKS) {
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.evaluate(installProfile, pack.mode);
    await page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await dismissMediaAsk(page);
    await applyViewMode(page, pack.mode);
    await page.locator("#wall canvas.render-host, #scene canvas").first().waitFor({ state: "attached", timeout: WAIT_MS });
    await page.waitForTimeout(18000);
    await dismissMediaAsk(page);
    const out = path.join(ART, pack.shot);
    await page.screenshot({ path: out, type: "webp", quality: 90, fullPage: false });
    console.log("saved", out);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
