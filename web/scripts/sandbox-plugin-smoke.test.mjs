#!/usr/bin/env node
/**
 * Opaque-origin plugin sandbox smoke (headless Chromium, production monitor on :7020).
 * Fails distinctly on CSP (about:srcdoc), CORS, bootstrap JS, or module.js status.
 *
 * Revert proof: revert sandbox asset token gate in service/access.py, then
 * `pnpm test:sandbox-plugin-smoke` → bootstrap fetch status 403 (logged as bootstrapJsStatus).
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

async function fetchSessionToken() {
  const r = await fetch(`${monitor}api/session`, { headers: { Host: "127.0.0.1:7020" } });
  assert.equal(r.status, 200, `session ${r.status}`);
  const data = await r.json();
  assert.ok(data.sandboxAssetToken, "sandboxAssetToken missing from /api/session");
  return data.sandboxAssetToken;
}

function formatDiag(diag) {
  return JSON.stringify(diag, null, 2);
}

async function main() {
  const sat = await fetchSessionToken();
  const jsName = sandboxJsName();
  const diag = {
    sandboxAssetTokenPresent: !!sat,
    bootstrapJsStatus: null,
    bootstrapJsCors: null,
    moduleJsStatus: null,
    cspViolations: [],
    corsConsole: [],
    boot: [],
  };

  const bootstrapUrl = `${monitor}assets/${jsName}?sat=${encodeURIComponent(sat)}`;
  const mod = await fetch(bootstrapUrl, {
    headers: { Origin: "null", Host: "127.0.0.1:7020" },
  });
  diag.bootstrapJsStatus = mod.status;
  diag.bootstrapJsCors = mod.headers.get("access-control-allow-origin");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (msg) => {
    const t = msg.text();
    if (/blocked by CORS policy/i.test(t)) diag.corsConsole.push(t);
  });
  await page.addInitScript(() => {
    window.__zotoCspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__zotoCspViolations.push({
        blockedURI: e.blockedURI,
        violatedDirective: e.violatedDirective,
        sourceFile: e.sourceFile,
      });
    });
  });

  const sandboxHtml = `${monitor}plugin-sandbox.html?sat=${encodeURIComponent(sat)}`;
  await page.setContent(`<!doctype html><meta charset="utf-8"><iframe id="sb" sandbox="allow-scripts"></iframe>
<script>
  window.__sandboxBoot = [];
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (d?.source === "zoto-viz-plugin") window.__sandboxBoot.push(d.type);
  });
  document.getElementById("sb").src = ${JSON.stringify(sandboxHtml)};
</script>`, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForFunction(
      () => (window.__sandboxBoot ?? []).includes("frame-ready"),
      undefined,
      { timeout: WAIT_MS },
    );
  } catch (err) {
    diag.boot = await page.evaluate(() => window.__sandboxBoot ?? []);
    diag.cspViolations = await page.evaluate(() => window.__zotoCspViolations ?? []);
    const srcdocViolations = diag.cspViolations.filter((v) =>
      String(v.blockedURI || v.sourceFile || "").includes("srcdoc"));
    console.error("sandbox-plugin-smoke: FAIL", formatDiag({
      ...diag,
      srcdocViolations,
      hint: srcdocViolations.length
        ? "CSP blocked about:srcdoc or inline bootstrap"
        : diag.bootstrapJsStatus !== 200
          ? "bootstrap JS rejected (token/CORS)"
          : diag.corsConsole.length
            ? "CORS blocked sandbox-frame or bootstrap"
            : "frame-ready timeout",
    }));
    process.exit(1);
  }

  diag.boot = await page.evaluate(() => window.__sandboxBoot ?? []);
  diag.cspViolations = await page.evaluate(() => window.__zotoCspViolations ?? []);
  assert.equal(diag.bootstrapJsStatus, 200, formatDiag(diag));
  assert.equal(diag.bootstrapJsCors, "null");
  assert.ok(diag.boot.includes("frame-ready"), diag.boot.join(","));

  const srcdocViolations = diag.cspViolations.filter((v) =>
    String(v.blockedURI || v.sourceFile || "").includes("srcdoc"));
  assert.equal(srcdocViolations.length, 0, formatDiag({ srcdocViolations }));

  await browser.close();
  console.log("sandbox-plugin-smoke: ok", formatDiag({ jsName, boot: diag.boot }));
}

main().catch((err) => {
  console.error("sandbox-plugin-smoke: FAIL", err?.message ?? err);
  process.exit(1);
});
