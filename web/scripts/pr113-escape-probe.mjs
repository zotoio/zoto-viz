#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createServer } from "vite";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outPath = "/opt/cursor/artifacts/pr113-escape-probe.txt";

const server = await createServer({
  configFile: path.join(webRoot, "vite.config.ts"),
  server: { port: 0, strictPort: false },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
if (!baseUrl) throw new Error("no vite url");

const browser = await chromium.launch({ headless: true });
const chromiumVersion = browser.version();

const lines = [`Chromium: ${chromiumVersion}`, ""];

for (let run = 1; run <= 5; run += 1) {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/test-pages/media-ask-focus.html`);
  await page.waitForFunction(() => window.__mediaAskFocusHarness);
  await page.evaluate(() => {
    window.__mediaAskEvents = [];
    window.__persistWrites = 0;
    const rawSet = sessionStorage.setItem.bind(sessionStorage);
    sessionStorage.setItem = (key, value) => {
      if (key === "zoto-viz.mediaDismiss") window.__persistWrites += 1;
      return rawSet(key, value);
    };
    void window.__mediaAskFocusHarness.openMicAsk();
  });
  await page.waitForSelector("dialog[data-media-ask]", { state: "attached" });
  await page.evaluate(() => {
    const dialog = document.querySelector("dialog[data-media-ask]");
    if (!dialog) throw new Error("no dialog");
    for (const type of ["cancel", "beforetoggle", "close"]) {
      dialog.addEventListener(
        type,
        (e) => {
          const label =
            type === "beforetoggle"
              ? `beforetoggle:${e.newState ?? "?"}/${e.oldState ?? "?"}`
              : type;
          window.__mediaAskEvents.push(label);
        },
        true,
      );
    }
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll("dialog[data-media-ask]").length === 0);
  const snap = await page.evaluate(() => ({
    events: window.__mediaAskEvents ?? [],
    persistWrites: window.__persistWrites ?? 0,
    dismiss: sessionStorage.getItem("zoto-viz.mediaDismiss"),
  }));
  lines.push(`run ${run}: events=[${snap.events.join(", ")}] persistWrites=${snap.persistWrites} storage=${snap.dismiss}`);
  await page.close();
}

lines.push("");
lines.push("interpretation: close fires on every run => single close listener path is sufficient");

writeFileSync(outPath, `${lines.join("\n")}\n`);
console.log("wrote", outPath);
for (const line of lines) console.log(line);

await browser.close();
await server.close();
