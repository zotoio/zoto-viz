#!/usr/bin/env node
/**
 * Opaque-origin plugin sandbox smoke (headless Chromium).
 * Revert proof: revert sandbox CSP + access null-origin allowlist, then
 * `pnpm test:sandbox-plugin-smoke` → fails (no frame-ready / CORS 403).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const monitor = (process.env.ZOTO_VIZ_URL || "http://127.0.0.1:7020/").replace(/\/?$/, "/");
const WAIT_MS = 60_000;
const webRoot = path.dirname(fileURLToPath(import.meta.url));

function sandboxJsName() {
  const html = readFileSync(path.join(webRoot, "../dist/plugin-sandbox.html"), "utf8");
  const m = html.match(/assets\/(plugin-sandbox-[^"]+\.js)/);
  assert.ok(m, "built plugin-sandbox bundle missing from dist");
  return m[1];
}

async function main() {
  const jsName = sandboxJsName();
  const mod = await fetch(`${monitor}assets/${jsName}`, {
    headers: { Origin: "null", Host: "127.0.0.1:7020" },
  });
  assert.equal(mod.status, 200, `module bootstrap ${mod.status}`);
  assert.equal(mod.headers.get("access-control-allow-origin"), "null");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (/blocked by CORS policy/i.test(msg.text())) {
      throw new Error(msg.text());
    }
  });
  await page.setContent(`<!doctype html><meta charset="utf-8"><iframe id="sb" sandbox="allow-scripts"></iframe>
<script>
  window.__sandboxBoot = [];
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d?.source === "zoto-viz-plugin") window.__sandboxBoot.push(d.type);
  });
  document.getElementById("sb").src = ${JSON.stringify(`${monitor}plugin-sandbox.html`)};
</script>`, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => (window.__sandboxBoot ?? []).includes("frame-ready"),
    undefined,
    { timeout: WAIT_MS },
  );
  const boot = await page.evaluate(() => window.__sandboxBoot ?? []);
  assert.ok(boot.includes("frame-ready"), boot.join(","));
  await browser.close();
  console.log("sandbox-plugin-smoke: ok", JSON.stringify({ boot, jsName }));
}

main().catch((err) => {
  console.error("sandbox-plugin-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
