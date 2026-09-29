#!/usr/bin/env node
/**
 * Check for zoto-viz#166: an optional prompt whose "Not now" button detaches mid-click must not
 * crash pick-every-view at boot.
 *
 * Part A (no browser, always): dismissOptionalPrompt from the util module against a fake page
 * whose button detaches mid-click, keeps re-rendering, vanishes, or whose page throws. Each row
 * must dismiss or give up within its budget, and never throw.
 *
 * Part B (--e2e, headed Chrome for Testing on $DISPLAY): runs the real harness against a tiny stub
 * server on 127.0.0.1:<port> whose page shows the mic/camera sheet ("dialog[open][data-media-ask]")
 * and re-renders it every 15ms and on pointerdown, so the button detaches mid-click:
 *   detach  modal sheet; "Not now" on the current node closes it. The harness must boot, dismiss it
 *           and carry on (no crash, no "still up" flag).
 *   stuck   non-modal sheet that ignores "Not now". The harness must boot and carry on with a
 *           "still up after boot" flag instead of crashing.
 * A row is red when the harness exits 2 (crash) or never logs "booted on".
 *
 * Usage (cwd web/):
 *   node scripts/pick-every-view-prompt.check.mjs [--util scripts/pick-every-view-util.mjs]
 *     [--e2e --harness scripts/pick-every-view.test.mjs --chrome PATH --port 7492 --modes detach,stuck]
 *     [--json OUT]
 * The harness and util paths can point at an older checkout (for the red run on 60f49a4b; the
 * harness directory needs node_modules with playwright + pngjs).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = { util: path.join(here, "pick-every-view-util.mjs"), e2e: false, harness: path.join(here, "pick-every-view.test.mjs"), chrome: process.env.PACK_MIRROR_CHROME_PATH || "", port: 7492, modes: ["detach", "stuck"], json: null, e2eTimeoutMs: 180_000 };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--util") args.util = path.resolve(process.argv[++i]);
  else if (a === "--e2e") args.e2e = true;
  else if (a === "--harness") args.harness = path.resolve(process.argv[++i]);
  else if (a === "--chrome") args.chrome = process.argv[++i];
  else if (a === "--port") args.port = Number(process.argv[++i]);
  else if (a === "--modes") args.modes = process.argv[++i].split(",").filter(Boolean);
  else if (a === "--json") args.json = process.argv[++i];
  else throw new Error(`unknown argument ${a}`);
}

const rows = [];
const row = (part, name, pass, detail) => { rows.push({ part, name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  [${part}] ${name} — ${detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Part A: fake page ----------------
/**
 * Minimal stand-in for the Playwright API dismissOptionalPrompt uses. The DOM is one prompt with a
 * button node id; `onClick(kind)` decides what a real/mouse/dom click does to it.
 */
function fakePage(sc) {
  const dom = { open: true, node: 1 };
  const connected = (id) => dom.open && dom.node === id;
  const detachedErr = () => new Error("elementHandle.click: Element is not attached to the DOM\nCall log: ...");
  const page = {
    dom,
    mouse: { click: async () => { await sleep(5); sc.onClick("mouse", dom); } },
    waitForTimeout: (ms) => sleep(Math.min(ms, 50)),
    evaluate: async () => { if (sc.pageGone) throw new Error("Target page, context or browser has been closed"); if (!dom.open) return "gone"; sc.onClick("dom", dom); return "clicked"; },
    locator: () => {
      if (sc.pageGone) { const t = () => { throw new Error("Target page, context or browser has been closed"); }; return { filter: t, last: t, first: t, count: async () => t(), getByRole: t }; }
      const box = { filter: () => box, last: () => box, first: () => box, count: async () => (dom.open ? 1 : 0), getByRole: () => btn };
      const btn = {
        first: () => btn,
        count: async () => (dom.open ? 1 : 0),
        elementHandle: async () => { if (!dom.open) throw new Error("timeout"); const id = dom.node; return {
          click: async () => { await sleep(10); if (sc.detachOnHandleClick) { dom.node++; throw detachedErr(); } if (!connected(id)) throw detachedErr(); sc.onClick("click", dom); },
          evaluate: async () => connected(id),
          dispose: async () => {},
        }; },
        click: async () => { if (!dom.open) throw new Error("timeout"); sc.onClick("click", dom); },
        boundingBox: async () => (dom.open ? { x: 10, y: 10, width: 80, height: 30 } : null),
      };
      return box;
    },
  };
  return page;
}

async function partA() {
  let dismissOptionalPrompt;
  try { ({ dismissOptionalPrompt } = await import(pathToFileURL(args.util).href)); } catch (e) { row("A", "load util", false, String(e.message ?? e).slice(0, 120)); return; }
  if (typeof dismissOptionalPrompt !== "function") { row("A", "dismissOptionalPrompt exported", false, `not exported by ${args.util} (the harness has no detach-tolerant dismiss)`); return; }
  const cases = [
    { name: "detach mid-click, mouse click on the re-rendered button closes it", sc: { detachOnHandleClick: true, onClick: (k, d) => { if (k === "mouse") d.open = false; } }, want: { dismissed: true } },
    { name: "detach mid-click, then the prompt is gone (node gone after the click)", sc: { detachOnHandleClick: true, onClick: () => {} , after: (d) => { d.open = false; } }, want: { dismissed: true } },
    { name: "re-renders on every click; only a DOM click on the current node lands", sc: { onClick: (k, d) => { if (k === "dom") d.open = false; else d.node++; } }, want: { dismissed: true } },
    { name: "never goes away (every click re-renders it): bounded, not dismissed, no throw", sc: { onClick: (k, d) => { d.node++; } }, want: { dismissed: false, maxMs: 2600 }, budgetMs: 2000 },
    { name: "no prompt on screen", sc: { onClick: () => {} }, start: (d) => { d.open = false; }, want: { dismissed: false, present: false } },
    { name: "page/context gone: no throw", sc: { pageGone: true, onClick: () => {} }, want: { dismissed: false } },
  ];
  for (const c of cases) {
    const page = fakePage(c.sc);
    if (c.start) c.start(page.dom);
    if (c.sc.after) { const orig = c.sc.onClick; c.sc.onClick = (k, d) => orig(k, d); setTimeout(() => c.sc.after(page.dom), 20); }
    const t = Date.now();
    let r; let threw = null;
    try { r = await dismissOptionalPrompt(page, { container: "dialog[open][data-media-ask]", name: "Not now", budgetMs: c.budgetMs ?? 3000, clickTimeoutMs: 200, settleMs: 40 }); } catch (e) { threw = e; }
    const ms = Date.now() - t;
    const bad = [];
    if (threw) bad.push(`threw: ${String(threw.message ?? threw).split("\n")[0]}`);
    else {
      if (r.dismissed !== c.want.dismissed) bad.push(`dismissed=${r.dismissed}`);
      if (c.want.present === false && r.present !== false) bad.push(`present=${r.present}`);
      if (ms > (c.want.maxMs ?? 3600)) bad.push(`took ${ms}ms`);
    }
    row("A", c.name, !bad.length, bad.length ? bad.join("; ") : `dismissed=${r.dismissed} via=${r.via ?? "-"} attempts=${r.attempts} ${ms}ms${r.stillUp ? " stillUp" : ""}`);
  }
}

// ---------------- Part B: real harness vs stub server ----------------
function stubHtml(mode) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>pick-every-view prompt stub</title>
<style>body{margin:0;background:#101418;color:#eee;font:14px sans-serif}#bar{position:fixed;top:0;left:0;right:0;height:56px;background:#222;z-index:5}
#mode{position:absolute;left:12px;top:12px}#mode .field-btn{font:inherit;padding:6px 10px}#wall{position:absolute;top:56px;left:0;right:0;bottom:0;background:linear-gradient(45deg,#2a4060,#a0602a)}
dialog[data-media-ask]{position:fixed;inset:auto 24px 24px auto;margin:0;padding:16px;background:#333;color:#eee;border:1px solid #888}</style></head>
<body><header id="bar"><div id="mode"><button type="button" class="field-btn" aria-controls="modeMenu"><span class="val"><span class="txt">NET Topology</span></span></button>
<ul id="modeMenu" role="listbox" hidden><li role="option" data-value="plugin:topology"><span class="txt">NET Topology</span></li></ul></div></header>
<div id="wall"></div>
<script>
window.zotoviz = { currentMode: { id: "plugin:topology" }, pluginSkyId: null, dreamAnim: { backdrop: "none" } };
localStorage.setItem("zoto-viz.mode", "plugin:topology");
const MODE = ${JSON.stringify(mode)};
let done = false; let dlg = null; window.__stub = { renders: 0, notNowClicks: 0 };
function render() {
  if (done) return;
  const d = document.createElement("dialog");
  d.className = "modal ask"; d.setAttribute("data-media-ask", "1");
  d.innerHTML = '<div class="sheet"><div class="mhead"><strong>Allow the microphone</strong></div><div class="ask-actions"><button type="button" class="btn">Not now</button> <button type="button" class="btn primary">Allow</button></div></div>';
  const nn = d.querySelector("button");
  nn.addEventListener("click", () => { window.__stub.notNowClicks++; if (MODE === "stuck") return; done = true; d.close(); d.remove(); dlg = null; });
  d.addEventListener("pointerdown", () => render(), { once: true }); // re-render mid-click
  if (dlg) dlg.remove();
  document.body.appendChild(d);
  if (MODE === "stuck") d.show(); else d.showModal();
  dlg = d; window.__stub.renders++;
}
setTimeout(() => { render(); const iv = setInterval(() => { if (done) clearInterval(iv); else render(); }, 15); }, 300);
</script></body></html>`;
}

function startStub(mode, port) {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const json = (o, st = 200) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(stubHtml(mode)); return; }
    if (u.pathname === "/api/plugins") return json({ plugins: [{ id: "topology", name: "Topology", visualisation: { engine: "graph" } }] });
    if (u.pathname === "/api/profiles") return json({ default: "user", profiles: [{ id: "user" }], fresh: true });
    if (u.pathname === "/api/session") return json({ csrf: "stub" });
    return json({ error: "stub: not found" }, 404);
  });
  return new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", () => resolve(srv)); });
}

async function runHarness(mode) {
  const srv = await startStub(mode, args.port);
  const out = mkdtempSync(path.join(tmpdir(), `pickall-prompt-${mode}-`));
  const cmd = [args.harness, "--base-url", `http://127.0.0.1:${args.port}/`, "--profile", "fresh", "--autoconsent", "keep", "--reload", "none", "--mosaic", "off", "--only", "plugin:none", "--hold-ms", "1000", "--out-dir", out, "--chrome", args.chrome];
  const t = Date.now();
  const res = await new Promise((resolve) => {
    const ch = spawn(process.execPath, cmd, { cwd: path.dirname(args.harness), env: process.env });
    let log = "";
    ch.stdout.on("data", (b) => { log += b; });
    ch.stderr.on("data", (b) => { log += b; });
    const timer = setTimeout(() => { ch.kill("SIGTERM"); }, args.e2eTimeoutMs);
    ch.on("exit", (code, sig) => { clearTimeout(timer); resolve({ code, sig, log }); });
  });
  await new Promise((r) => srv.close(r));
  let pj = null;
  try { pj = JSON.parse(readFileSync(path.join(out, "pickall.json"), "utf8")); } catch { pj = null; }
  return { ...res, ms: Date.now() - t, out, pj };
}

async function partB() {
  if (!args.chrome || !existsSync(args.chrome)) { row("B", "e2e", false, `no Chrome for Testing at "${args.chrome}"`); return; }
  for (const mode of args.modes) {
    const r = await runHarness(mode);
    writeFileSync(path.join(r.out, "harness.log"), r.log);
    const booted = /booted on plugin:topology/.test(r.log);
    const crash = r.code === 2 || /pick-every-view: FAIL/.test(r.log);
    const errLine = (r.log.match(/pick-every-view: FAIL[^\n]*\n?[^\n]*/) || [""])[0].replace(/\s+/g, " ").slice(0, 220);
    const stillUpFlag = (r.pj?.flags ?? []).some((f) => /prompt still up after boot/.test(f));
    const prompts = r.pj?.prompts ?? null;
    const bad = [];
    if (crash) bad.push(`harness crashed (exit ${r.code}): ${errLine}`);
    if (!booted) bad.push("never logged 'booted on'");
    if (!crash && booted && mode === "detach" && stillUpFlag) bad.push("prompt still up after boot");
    if (!crash && booted && mode === "stuck" && !stillUpFlag) bad.push("no 'still up after boot' flag");
    const okDetail = `booted, exit ${r.code}, ${Math.round(r.ms / 1000)}s; prompts ${prompts ? JSON.stringify(prompts.slice(0, 2).map((p) => ({ where: p.where, dismissed: p.dismissed, via: p.via, stillUp: p.stillUp }))) : "n/a"}${stillUpFlag ? "; flag: still up after boot" : ""}`;
    row("B", `harness boot with a ${mode === "detach" ? "sheet whose Not now detaches mid-click" : "sheet that never goes away"} (${path.relative(process.cwd(), args.harness) || args.harness})`, !bad.length, bad.length ? `${bad.join("; ")} (${Math.round(r.ms / 1000)}s; log ${r.out}/harness.log)` : `${okDetail} (log ${r.out}/harness.log)`);
  }
}

await partA();
if (args.e2e) await partB();
if (args.json) writeFileSync(args.json, JSON.stringify({ util: args.util, harness: args.e2e ? args.harness : null, rows }, null, 1));
const failed = rows.filter((r) => !r.pass).length;
console.log(failed ? `\nFAIL: ${failed} row(s)` : "\nPASS: every row");
process.exit(failed ? 1 : 0);
