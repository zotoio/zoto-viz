#!/usr/bin/env node
/**
 * Pick every view in the header picker (headed Chrome) and check each one shows its own look.
 *
 * Acceptance test for "make this simpler UX and ensure expected behaviour when selecting each".
 * For every catalog view (from /api/plugins, instances expanded, test fixtures excluded) it clicks
 * the header picker with the mouse (chat closed), waits for ready, holds, and records header, active
 * mode, window.zotoviz.pluginSkyId, anim.backdrop, dice, tile-heal lines, mode changes during the
 * hold, a five-patch wall sample, CSP violations, pack-asset token mismatches, /pack-assets 4xx and
 * the catalog consent. Each view lands in one state:
 *   Ready          the view shows its own look
 *   Needs you      consent not granted: 0 sandbox frames and a visible message offering Review
 *   Couldn't start a visible message with Retry
 *   FAIL-silent    the view dropped / never started with nothing on screen saying so
 *   FAIL-other     anything else wrong (wrong sky, black / uniform wall, CSP, fallback heal, ...)
 * Then a reload row (header, mode and pluginSkyId survive a reload, exactly one pack build after
 * it) and leftover checks after a return to Topology (sandbox frames, page listeners, live
 * MessagePorts, same main WebGL context), plus a 2x2 mosaic with Backrooms where no pack-sky pane
 * may show a built-in stand-in sky, and a check that no test fixture is in the picker.
 *
 * Per-view assertions beyond the look (from the zoto sweep of 20fa18a7):
 *   - header and active mode must name the picked view (Cypher CIC / Syscon kept the previous
 *     one), and the picked pack must not be "Preview only" in its own wall;
 *   - a review notice while the previous view stays is FAIL-silent unless it has a Review button
 *     and the header names the picked view (Source web, unconsented packs);
 *   - black while drawing fails via the five-patch sample (Blob Mesh);
 *   - any WebGL VALIDATE_STATUS / shader compile console line fails (Graph cloth);
 *   - module.js 403 (or blocked) while the catalog says consented fails: consent-mismatch;
 *   - carousel instances record the image src + sha256; Earth Observatory must differ from
 *     Commons POTD and APOD from NASA IOTD; upstream 5xx from /api/sources is its own reason.
 *
 * Headed only (no headless switch). Chrome for Testing from --chrome or PACK_MIRROR_CHROME_PATH.
 *
 * Usage (cwd web/):
 *   node scripts/pick-every-view.test.mjs --base-url http://127.0.0.1:7020/ --profile fresh|shipped \
 *     [--autoconsent on|off|keep] [--reload all|sample|none] [--hold-ms 20000] [--ready-ms 120000] \
 *     [--only plugin:a,plugin:b] [--sha 20fa18a7] [--label x] [--out-dir DIR] [--backend-log FILE] \
 *     [--mosaic on|off] [--mosaic-sky-override plugin:backrooms=rain] [--dev-mode]
 *
 * --profile shipped makes the shipped "zoto viz" profile the startup default for the run and puts
 * the previous default back afterwards. --autoconsent on|off flips the live operator toggle over
 * MCP set_settings (on grants consent to shipped packs, and that consent persists); keep (default)
 * leaves the server alone. The mosaic check drives the wall over MCP set_settings anim
 * (mosaic "4", tiles, mosaicSkies) like the operator would; --mosaic off skips it (it changes the
 * live wall on every connected screen). Output: <out-dir>/pickall.json, pickall.md, shots/*.png.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  fivePatchSample,
  orderViews,
  parseArgs,
  qeInstrument,
  qeLeftoverSnapshot,
  viewsFromCatalog,
} from "./pick-every-view-util.mjs";

const argv = process.argv.slice(2);
const extra = { mosaic: "on", skyOverride: {}, devMode: false };
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dev-mode") extra.devMode = true;
  else if (a === "--rescore") extra.rescore = argv[++i];
  else if (a === "--mosaic") extra.mosaic = argv[++i];
  else if (a === "--mosaic-sky-override") {
    const [k, v] = String(argv[++i]).split("=");
    extra.skyOverride[k] = v;
  } else rest.push(a);
}
const opts = parseArgs(rest);
if (opts.help) {
  console.log(readHelp());
  process.exit(0);
}
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const base = opts.baseUrl;
const t0 = Date.now();
const T = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s`;
const log = (...a) => console.log(`[pickall ${T()}]`, ...a);

function readHelp() {
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const m = /\/\*\*([\s\S]*?)\*\//.exec(src);
  return (m ? m[1] : "").split("\n").map((l) => l.replace(/^ \* ?/, "")).join("\n").trim();
}

function gitSha() {
  try {
    return execFileSync("git", ["-C", scriptDir, "rev-parse", "--short=8", "HEAD"], { encoding: "utf8" }).trim();
  } catch { return "unknown"; }
}

if (extra.rescore) {
  // Re-apply the post-sweep rules to a saved pickall.json (no browser), then rewrite json + md.
  const res = JSON.parse(readFileSync(extra.rescore, "utf8"));
  const n = postRules(res);
  res.counts = countStates(res.views);
  res.meta.rescored = { at: new Date().toISOString(), rowsChanged: n, script: gitSha() };
  writeFileSync(extra.rescore, JSON.stringify(res, null, 1));
  writeFileSync(path.join(path.dirname(extra.rescore), "pickall.md"), markdown(res));
  console.log(`rescored ${extra.rescore}: ${n} row(s) changed; counts ${JSON.stringify(res.counts)}`);
  process.exit(0);
}

const sha = opts.sha || gitSha();
const outDir = opts.outDir || `/workspace/qe-logs/pickall-${sha}-${opts.profile}${opts.label ? `-${opts.label}` : ""}`;
const shotDir = path.join(outDir, "shots");
mkdirSync(shotDir, { recursive: true });

const redact = (u) => String(u).replace(/\/pack-assets\/[^/]+\//, "/pack-assets/<T>/").replace(base, "/");
const tok = (u) => {
  const m = /\/pack-assets\/([^/]+)\/([^/]+)\/([^?#]+)/.exec(u || "");
  return m ? { token: decodeURIComponent(m[1]), pack: decodeURIComponent(m[2]), file: m[3] } : null;
};

async function api(p, init) {
  const r = await fetch(new URL(p, base), init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

async function csrfHeaders() {
  const s = await api("api/session");
  return { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": s.body?.csrf ?? "" };
}

async function mcp(name, args) {
  return api("mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  });
}

async function catalogConsent(packId) {
  let r;
  try { r = await api("api/plugins"); } catch (e) { return { consent: `(api/plugins failed: ${String(e.message ?? e).slice(0, 60)})`, consent_state: null }; }
  const row = (r.body?.plugins ?? []).find((p) => p.id === packId);
  if (!row) return { consent: "(missing)", consent_state: null };
  return { consent: row.consent ?? null, consent_state: row.consent_state ?? null };
}

function backendLogSize() {
  if (!opts.backendLog) return null;
  try { return statSync(opts.backendLog).size; } catch { return null; }
}

function backendLogSince(offset) {
  if (!opts.backendLog || offset == null) return [];
  try {
    const size = statSync(opts.backendLog).size;
    if (size <= offset) return [];
    const fd = openSync(opts.backendLog, "r");
    const buf = Buffer.alloc(Math.min(size - offset, 4 << 20));
    readSync(fd, buf, 0, buf.length, offset);
    closeSync(fd);
    return buf.toString("utf8").split("\n");
  } catch { return []; }
}

/** In-page snapshot of what the user sees for the view. */
function pageState() {
  const vis = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity || 1) > 0.05;
  };
  const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const s = window.zotoviz;
  const dialogs = [...document.querySelectorAll("dialog[open], .modal")].filter(vis).map((d) => ({
    cls: String(d.className),
    mediaAsk: d.dataset.mediaAsk ? true : false,
    title: txt(d.querySelector(".mhead, h1, h2, h3, header, .title, [id$='title']")).slice(0, 140),
    text: txt(d).slice(0, 400),
    buttons: [...d.querySelectorAll("button")].filter(vis).map((b) => txt(b)),
  }));
  const actionButtons = [...document.querySelectorAll("button")].filter(vis).map((b) => txt(b))
    .filter((t) => /^(review|retry|try again)\b/i.test(t));
  const notices = [...document.querySelectorAll(".mosaic-pane-notice, .tile-heal-msg, #modeSwitchStatus, .pack-mirror-placeholder, [role=alert]")]
    .filter(vis).map((n) => txt(n)).filter(Boolean);
  const vw = document.querySelector("#wall")?.getBoundingClientRect();
  const bar = document.querySelector("#bar")?.getBoundingClientRect();
  let region = null;
  if (vw) {
    const top = Math.max(vw.top, bar && bar.bottom < vw.bottom - 100 ? bar.bottom : vw.top);
    let right = vw.right; const left = vw.left; let bottom = vw.bottom;
    const foot = document.querySelector("#foot")?.getBoundingClientRect();
    if (foot && foot.height > 0 && foot.top > top + 200) bottom = Math.min(bottom, foot.top);
    for (const id of ["livefeed", "livechat"]) {
      const el = document.getElementById(id);
      if (el && !el.hidden && vis(el) && !el.classList.contains("floated")) {
        const r = el.getBoundingClientRect();
        if (r.left > left + 200) right = Math.min(right, r.left);
      }
    }
    region = { x: left, y: top, w: right - left, h: bottom - top };
  }
  let mode = null;
  try { mode = s?.currentMode?.id ?? null; } catch { mode = null; }
  let sky = null;
  try { sky = s?.pluginSkyId ?? null; } catch { sky = "(threw)"; }
  let backdrop = null;
  try { backdrop = s?.dreamAnim?.backdrop ?? null; } catch { backdrop = null; }
  return {
    header: txt(document.querySelector("#mode .val .txt")),
    mode,
    lsMode: localStorage.getItem("zoto-viz.mode"),
    pluginSkyId: sky,
    backdrop,
    dice: document.querySelector("#dice") ? document.querySelector("#dice").checked : null,
    profile: txt(document.querySelector("#profile .val .txt")),
    brand: txt(document.querySelector("#brandProfile")),
    booting: document.body.classList.contains("view-booting"),
    bootBar: document.querySelector("#bootBar")?.style.width ?? null,
    bootLabel: txt(document.querySelector("#bootLabel")),
    chatOpen: document.body.classList.contains("chat-open"),
    feedOpen: document.body.classList.contains("feed-open"),
    mosaic: document.body.classList.contains("mosaic-on") || !!document.querySelector(".mosaic-pane"),
    sandboxBoot: [...(window.__zotoSandboxBoot ?? [])],
    sandboxIframes: document.querySelectorAll('iframe[src*="plugin-sandbox"]').length,
    glLost: (() => {
      const c = document.querySelector("#wall canvas.render-host");
      const e = (window.__qe?.gl ?? []).filter((x) => x.canvas === c);
      const ctx = e[e.length - 1]?.ctx;
      return ctx ? ctx.isContextLost() : null;
    })(),
    wallMosaic: document.body.dataset.mosaic && document.body.dataset.mosaic !== "off" ? document.body.dataset.mosaic : null,
    previewPanes: [...document.querySelectorAll(".mosaic-pane-preview-caption")].filter(vis).map((c) => c.closest("[data-mode]")?.dataset.mode ?? "?"),
    carousel: (() => {
      const box = document.querySelector("#carousel");
      if (!box || box.hidden || !vis(box)) return null;
      const imgs = [...box.querySelectorAll("figure.carousel-still img")];
      // The two <img> cross-fade and keep the old src; only the one showing counts.
      const front = imgs.filter((i) => i.getAttribute("src") && i.complete && i.naturalWidth > 0 && Number(getComputedStyle(i).opacity) >= 0.5)[0];
      const sampleLine = [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && /sample pictures/i.test(e.textContent || "") && vis(e)).map(txt)[0] ?? null;
      return { src: front?.getAttribute("src") ?? null, all: imgs.map((i) => i.getAttribute("src")).filter(Boolean), title: txt(box.querySelector(".carousel-caption-title")).slice(0, 120), sampleLine };
    })(),
    softgl: document.body.hasAttribute("data-softgl"),
    viewAttrs: (() => {
      // data-view-state / data-view-id (spec rev 2): header, picker option, pane slot, wall notice.
      // #scene already carries data-view-id on 20fa18a7; the rev-2 surfaces are the header, the
      // picker options, the pane slots and the wall notice.
      const els = [...document.querySelectorAll("[data-view-state], #mode[data-view-id], #mode [data-view-id]")];
      if (!els.length) return null;
      return els.map((e) => ({
        surface: e.closest("#mode") ? (e.closest("li[role=option]") ? "picker-option" : "header") : e.closest(".mosaic-pane") ? "pane" : /notice/.test(String(e.className)) ? "wall-notice" : e.tagName.toLowerCase() + (e.id ? `#${e.id}` : ""),
        viewId: e.dataset.viewId ?? e.closest("[data-value]")?.dataset.value ?? e.closest("[data-mode]")?.dataset.mode ?? null,
        state: e.dataset.viewState ?? null,
      }));
    })(),
    sceneViewId: document.querySelector("#scene")?.dataset.viewId ?? null,
    brandText: txt(document.querySelector("#bar .brand")),
    twoD: /\b2D\b/.test(txt(document.querySelector("#bar .brand"))),
    notShowing: [...document.querySelectorAll("body *")].filter((e) => e.children.length <= 2 && /running but not showing anything/i.test(e.textContent || "") && vis(e)).map(txt)[0] ?? null,
    dialogs,
    actionButtons,
    notices,
    region,
  };
}

function reviewPrompt(st) {
  if (st.actionButtons.some((b) => /^review\b/i.test(b))) return { via: "review-button", text: st.notices.join(" | ") || st.actionButtons.join(", ") };
  const d = st.dialogs.find((x) => !x.mediaAsk && /review/i.test(`${x.title} ${x.text}`) && x.buttons.some((b) => /not now/i.test(b)));
  if (d) return { via: "consent-modal", text: `${d.title || d.text.slice(0, 80)} [${d.buttons.join(" / ")}]` };
  return null;
}

function retryPrompt(st) {
  if (st.actionButtons.some((b) => /^(retry|try again)\b/i.test(b))) {
    return { text: st.notices.find((n) => /retry|try again|couldn/i.test(n)) || st.notices.join(" | ") || "Retry button" };
  }
  return null;
}

const skyMatches = (v, sky) => !!sky && [v.packId, v.id, v.id.replace(/^plugin:/, "")].includes(sky);

async function main() {
  log(`base=${base} profile=${opts.profile} autoconsent=${opts.autoconsent} reload=${opts.reload} hold=${opts.holdMs}ms sha=${sha} out=${outDir}`);
  if (!opts.chrome) throw new Error("set --chrome or PACK_MIRROR_CHROME_PATH (Chrome for Testing)");

  const cat = await api("api/plugins");
  if (cat.status !== 200) throw new Error(`/api/plugins ${cat.status}`);
  const { views: allViews, fixtures, hasFixtureField } = viewsFromCatalog(cat.body.plugins ?? []);
  let views = orderViews(allViews);
  if (opts.only) views = views.filter((v) => opts.only.includes(v.id) || opts.only.includes(v.packId));
  const bi = views.findIndex((v) => v.id === "plugin:backrooms");
  log(`${views.length} views (${fixtures.length} fixtures excluded via ${hasFixtureField ? "fixture field" : "explicit list"}); Backrooms at #${bi + 1}, ${bi >= 0 ? views.length - bi - 1 : 0} after it`);

  const setup = { profileDefaultBefore: null, profileDefaultSet: null, autoconsent: null };
  const prof = await api("api/profiles");
  setup.profileDefaultBefore = prof.body?.default ?? null;
  setup.profilesBefore = (prof.body?.profiles ?? []).map((p) => p.id);
  setup.profilesFresh = prof.body?.fresh ?? null;
  if (opts.profile === "shipped" && setup.profileDefaultBefore !== "zoto-viz") {
    const r = await api("api/profiles/default", { method: "PUT", headers: await csrfHeaders(), body: JSON.stringify({ id: "zoto-viz" }) });
    setup.profileDefaultSet = { status: r.status, body: r.body };
    log(`startup profile -> zoto-viz: ${r.status}`);
  }
  if (opts.autoconsent !== "keep") {
    const r = await mcp("set_settings", { autoconsent: opts.autoconsent === "on" });
    setup.autoconsent = { status: r.status, applied: (() => { try { return JSON.parse(r.body?.result?.content?.[0]?.text ?? "{}").applied; } catch { return null; } })() };
    log(`autoconsent ${opts.autoconsent}: ${r.status} ${JSON.stringify(setup.autoconsent.applied)}`);
  }

  const browser = await chromium.launch({
    headless: false,
    executablePath: opts.chrome,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1300,900", "--js-flags=--expose-gc", "--autoplay-policy=no-user-gesture-required"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: { cookies: [], origins: [] } });
  await ctx.addInitScript(qeInstrument);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  // Event streams, indexed so each view slices its own window.
  const ev = { console: [], csp: [], heal: [], mints: [], modules: [], pack4xx: [], profileWrites: [], lastSettings: null, pageErrors: [], shader: [], glWarn: [], moduleResp: [], frameCreates: [], upstream5xx: [] };
  page.on("console", (m) => {
    const t = m.text();
    const at = Date.now();
    if (/^\[qe-csp\]/.test(t) || /Content Security Policy/i.test(t)) ev.csp.push({ at, frame: redact(m.location()?.url || ""), text: redact(t).slice(0, 300) });
    if (/tile-heal/.test(t)) ev.heal.push({ at, text: t.slice(0, 240) });
    if (/VALIDATE_STATUS|Shader Error|shader compil|compile shader|Program Info Log|ERROR: \d+:\d+/i.test(t)) ev.shader.push({ at, text: t.replace(/\s+/g, " ").slice(0, 300) });
    else if (/WebGL: too many errors|WebGL: INVALID|GL_INVALID/i.test(t)) ev.glWarn.push({ at, text: t.slice(0, 200) });
    if (m.type() === "error" || m.type() === "warning") ev.console.push({ at, type: m.type(), text: redact(t).slice(0, 240) });
  });
  page.on("pageerror", (e) => ev.pageErrors.push({ at: Date.now(), text: String(e).slice(0, 240) }));
  page.on("requestfailed", (req) => {
    const mt = tok(req.url());
    if (mt && /module\.js$/.test(mt.file)) ev.moduleResp.push({ at: Date.now(), pack: mt.pack, status: 0, failure: req.failure()?.errorText ?? "failed" });
  });
  page.on("request", (req) => {
    const u = req.url();
    if (/\/api\/pack-assets\/token\//.test(u) && req.method() === "POST") {
      const pack = decodeURIComponent(u.split("/api/pack-assets/token/")[1] || "").replace(/\?.*/, "");
      const row = { at: Date.now(), pack, token: null };
      ev.mints.push(row);
      req.response().then(async (r) => { try { row.status = r?.status(); row.token = (await r?.json())?.token ?? null; } catch { /* ignore */ } }).catch(() => {});
    }
    const t = tok(u);
    if (t && /module\.js$/.test(t.file)) {
      let frameUrl = "";
      try { frameUrl = req.frame()?.url() ?? ""; } catch { frameUrl = ""; }
      const ft = tok(frameUrl);
      ev.modules.push({ at: Date.now(), pack: t.pack, token: t.token, frameToken: ft?.token ?? null, frameIsSandbox: !!ft });
    }
    if (/\/api\/pack-assets\/frames$/.test(u.replace(/\?.*/, "")) && req.method() === "POST") ev.frameCreates.push({ at: Date.now() });
    if (/\/api\/profiles(\/|$)/.test(u) && ["PUT", "POST"].includes(req.method())) {
      try {
        const b = JSON.parse(req.postData() || "{}");
        if (b.settings) ev.lastSettings = { at: Date.now(), url: redact(u), anim: { backdrop: b.settings.anim?.backdrop }, dice: b.settings.dice ? { on: b.settings.dice.on, include: b.settings.dice.include } : null, mode: b.settings.mode };
      } catch { /* ignore */ }
    }
  });
  page.on("response", (r) => {
    const u = r.url();
    const st = r.status();
    if (u.includes("/pack-assets/") && st >= 400 && st < 500) ev.pack4xx.push({ at: Date.now(), status: st, url: redact(u) });
    const mt = tok(u);
    if (mt && /module\.js$/.test(mt.file)) ev.moduleResp.push({ at: Date.now(), pack: mt.pack, status: st });
    if (/\/api\/sources\//.test(u) && st >= 500) ev.upstream5xx.push({ at: Date.now(), status: st, url: redact(u).slice(0, 200) });
    if (/\/api\/profiles(\/|$)/.test(u) && ["PUT", "POST"].includes(r.request().method())) {
      ev.profileWrites.push({ at: Date.now(), method: r.request().method(), url: redact(u), status: st });
    }
  });

  const results = {
    meta: {
      sha, base, profile: opts.profile, autoconsent: opts.autoconsent, reload: opts.reload, holdMs: opts.holdMs, readyMs: opts.readyMs,
      mosaicCheck: extra.mosaic, mosaicSkyOverride: extra.skyOverride, devMode: extra.devMode, chrome: opts.chrome, started: new Date().toISOString(), setup,
      fixturesExcluded: fixtures.map((f) => f.id), fixtureRule: hasFixtureField ? "fixture: true" : "explicit list",
      order: views.map((v) => v.id),
    },
    boot: null, pickerCheck: null, views: [], reloadRows: [], leftover: null, mosaic: null, imagePairs: [], counts: null, flags: [],
  };
  const flush = () => {
    results.meta.elapsedSec = Math.round((Date.now() - t0) / 1000);
    writeFileSync(path.join(outDir, "pickall.json"), JSON.stringify(results, null, 1));
    writeFileSync(path.join(outDir, "pickall.md"), markdown(results));
  };

  const st = () => page.evaluate(pageState);

  async function dismissMediaAsk() {
    const d = page.locator("dialog[open][data-media-ask]");
    if (await d.count()) {
      const nn = d.getByRole("button", { name: "Not now" });
      if (await nn.count()) { await nn.first().click(); await page.waitForTimeout(500); return true; }
    }
    return false;
  }
  async function closeChat() {
    if (await page.evaluate(() => document.body.classList.contains("chat-open"))) {
      await page.locator("#chatBox label").click();
      await page.waitForTimeout(400);
      return true;
    }
    return false;
  }
  async function declineConsentModal() {
    const d = page.locator(".modal[role=dialog], dialog[open].modal").filter({ hasText: /review/i });
    if (await d.count()) {
      const nn = d.first().getByRole("button", { name: /not now/i });
      if (await nn.count()) { await nn.first().click(); return true; }
    }
    return false;
  }

  /** Real mouse clicks: open the header picker, click the option. Returns the option label. */
  /** Real click; when the page is not producing frames, fall back to a mouse click at its box. */
  async function realClick(loc, timeout = 10_000) {
    try { await loc.click({ timeout }); return null; } catch (e) {
      const bb = await loc.boundingBox();
      if (!bb) throw e;
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(500);
      return String(e.message ?? e).split("\n")[0].slice(0, 120);
    }
  }

  async function pickInHeader(id) {
    const btn = page.locator("#mode .field-btn");
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const forcedOpen = await realClick(btn).catch((e) => `open failed: ${String(e.message ?? e).split("\n")[0].slice(0, 80)}`);
      const menuId = await btn.getAttribute("aria-controls");
      const li = page.locator(`[id="${menuId}"] li[role="option"][data-value="${id}"]`);
      if (!(await li.count())) {
        await page.keyboard.press("Escape");
        return { found: false };
      }
      const target = li.last(); // the group entry; RECENT holds a second copy of recent picks
      const label = ((await target.locator(".txt").textContent()) ?? "").trim();
      if (attempt === 3) {
        // Last try: narrow the list with the picker's own filter box, like a person typing.
        const filter = page.locator(`[id="${menuId}"]`).locator("xpath=..").locator("input").first();
        if (await filter.count()) { await filter.fill(label).catch(() => {}); await page.waitForTimeout(500); }
      }
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 8000 });
        await target.click({ timeout: 8000 });
        const extra2 = [forcedOpen && `menu open: ${forcedOpen}`, attempt > 1 && `attempt ${attempt}`].filter(Boolean).join("; ");
        return extra2 ? { found: true, label, forcedClick: extra2 } : { found: true, label };
      } catch (e) {
        // The page is not painting (rAF starved), so actionability never settles. Still a real
        // mouse click at the option's box, recorded on the row.
        await target.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
        const bb = await target.boundingBox().catch(() => null);
        if (bb) {
          await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
          return { found: true, label, forcedClick: `${String(e.message ?? e).split("\n")[0].slice(0, 100)}; attempt ${attempt}` };
        }
        lastErr = e;
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    return { found: false, error: `option never got a box after 3 tries: ${String(lastErr?.message ?? lastErr).split("\n")[0].slice(0, 100)}` };
  }

  async function pickerOptions() {
    const btn = page.locator("#mode .field-btn");
    await btn.click();
    const menuId = await btn.getAttribute("aria-controls");
    const opts2 = await page.evaluate((mid) => [...document.querySelectorAll(`[id="${mid}"] li[role="option"]`)]
      .map((li) => ({ value: li.dataset.value, label: li.querySelector(".txt")?.textContent ?? "" })), menuId);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return opts2;
  }

  /** Wait until the view is up, a prompt shows, or time runs out. */
  async function waitOutcome(v, label, limitMs) {
    const deadline = Date.now() + limitMs;
    let last = null;
    let previewSince = null;
    const seen = new Set();
    while (Date.now() < deadline) {
      last = await st().catch(() => last);
      if (last) {
        seen.add(`${last.mode}|${last.header}`);
        const rp = reviewPrompt(last);
        if (rp) return { kind: "review", prompt: rp, st: last, ms: limitMs - (deadline - Date.now()), seen: [...seen] };
        const tp = retryPrompt(last);
        if (tp) return { kind: "retry", prompt: tp, st: last, ms: limitMs - (deadline - Date.now()), seen: [...seen] };
        const modeOk = last.mode === v.id;
        const headerOk = last.header === label;
        if (!modeOk && last.previewPanes.includes(v.id)) {
          previewSince ??= Date.now();
          if (Date.now() - previewSince > 15_000) return { kind: "preview-only", st: last, ms: limitMs - (deadline - Date.now()), seen: [...seen] };
        } else previewSince = null;
        const bootOk = !v.sandbox || last.sandboxBoot.includes("ready");
        if (modeOk && headerOk && bootOk && !last.booting) return { kind: "ready", st: last, ms: limitMs - (deadline - Date.now()), seen: [...seen] };
      }
      await page.waitForTimeout(1000);
    }
    return { kind: "timeout", st: last, ms: limitMs, seen: [...seen] };
  }

  async function hold(v, label, ms) {
    const samples = [];
    const end = Date.now() + ms;
    let changed = null;
    let skyEver = false;
    const images = new Set();
    let imageTitle = null;
    let glLostAtSec = null;
    let sampleLine = null;
    let notShowing = null;
    const viewAttrs = [];
    while (Date.now() < end) {
      const s = await st().catch(() => null);
      if (s) {
        if (s.glLost && glLostAtSec == null) glLostAtSec = Math.round((ms - (end - Date.now())) / 1000);
        if (s.carousel) { if (s.carousel.src && ms - (end - Date.now()) >= 5000) /* skip the first 5s: cross-fade from the last view */ images.add(s.carousel.src); if (s.carousel.title) imageTitle = s.carousel.title; if (s.carousel.sampleLine) sampleLine ??= s.carousel.sampleLine; }
        if (s.notShowing) notShowing ??= { atSec: Math.round((ms - (end - Date.now())) / 1000), text: s.notShowing };
        if (s.viewAttrs) viewAttrs.push(s.viewAttrs);
        samples.push({ t: Math.round((ms - (end - Date.now())) / 1000), mode: s.mode, header: s.header, sky: s.pluginSkyId });
        if (skyMatches(v, s.pluginSkyId)) skyEver = true;
        if (!changed && (s.mode !== v.id || s.header !== label)) changed = { atSec: samples[samples.length - 1].t, mode: s.mode, header: s.header, notices: s.notices };
      }
      await page.waitForTimeout(1000);
    }
    const distinct = [...new Set(samples.map((x) => `${x.mode} | ${x.header} | ${x.sky}`))];
    return { changed, distinct, skyEver, samples: samples.length, images: [...images], imageTitle, glLostAtSec, sampleLine, notShowing, viewAttrs };
  }

  async function shot(name) {
    const file = path.join(shotDir, `${name}.png`);
    for (const timeout of [45_000, 60_000]) {
      try {
        const buf = await page.screenshot({ path: file, timeout });
        return { file, buf };
      } catch (e) {
        log(`screenshot ${name}: ${String(e.message ?? e).split("\n")[0]} (timeout ${timeout / 1000}s)`);
      }
    }
    // The page stopped producing frames. Grab the whole :7 display as evidence instead.
    const xfile = path.join(shotDir, `${name}-display.png`);
    try {
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "x11grab", "-i", process.env.DISPLAY || ":7", "-frames:v", "1", xfile], { timeout: 20_000 });
    } catch { /* evidence only */ }
    return { file: xfile, buf: null, error: "page screenshot timed out twice (page not producing frames)" };
  }

  // ---- boot on the startup view ----
  log("boot");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const bootStart = Date.now();
  let bootSt = null;
  while (Date.now() - bootStart < 120_000) {
    await dismissMediaAsk();
    bootSt = await st().catch(() => null);
    if (bootSt && !bootSt.booting && bootSt.mode) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  const askDismissed = await dismissMediaAsk();
  const chatClosedAtBoot = await closeChat();
  await page.waitForTimeout(3000);
  bootSt = await st();
  results.boot = {
    ms: Date.now() - bootStart, header: bootSt.header, mode: bootSt.mode, profile: bootSt.profile, brand: bootSt.brand,
    booting: bootSt.booting, bootBar: bootSt.bootBar, bootLabel: bootSt.bootLabel, askDismissed, chatClosedAtBoot,
    softgl: bootSt.softgl, backdrop: bootSt.backdrop, dice: bootSt.dice,
  };
  if (bootSt.booting) results.flags.push(`boot overlay still up after boot (bar ${bootSt.bootBar}, "${bootSt.bootLabel}")`);
  if (bootSt.softgl) results.flags.push("render host fell back to software (data-softgl)");
  await shot("00-boot");
  log(`booted on ${bootSt.mode} header="${bootSt.header}" profile=${bootSt.profile}`);

  const picker = await pickerOptions();
  const pickerIds = new Set(picker.map((o) => o.value));
  results.pickerCheck = {
    options: picker.length,
    fixturesInPicker: fixtures.filter((f) => pickerIds.has(f.id)).map((f) => f.id),
    viewsMissingFromPicker: allViews.filter((v) => !pickerIds.has(v.id)).map((v) => v.id),
    fixtureRule: extra.devMode ? "dev mode: fixtures allowed" : "fail if any fixture id is in the picker",
    pass: extra.devMode || !fixtures.some((f) => pickerIds.has(f.id)),
    pickerNotInCatalog: picker.filter((o) => o.value?.startsWith("plugin:") && !allViews.some((v) => v.id === o.value) && !fixtures.some((f) => f.id === o.value)).map((o) => o.value),
  };
  flush();

  let baseline = await page.evaluate(qeLeftoverSnapshot);
  let baselineTypes = await page.evaluate(listenerTypes);
  results.glRecoveries = [];
  log(`baseline listeners w=${baseline.listeners.window} d=${baseline.listeners.document} other=${baseline.listeners.otherConnected} ports open=${baseline.ports.aliveOpen} sandbox=${baseline.sandboxIframes} gl=${baseline.gl.mainType}`);

  // ---- phase A: the sweep ----
  let n = 0;
  for (const v of views) {
    n++;
    const tag = `${String(n).padStart(2, "0")}-${v.id.replace(/^plugin:/, "").replace(/[^a-z0-9-]+/gi, "_")}`;
    const vStart = Date.now();
    const logOff = backendLogSize();
    const idx = { csp: ev.csp.length, heal: ev.heal.length, mints: ev.mints.length, modules: ev.modules.length, pack4xx: ev.pack4xx.length, profileWrites: ev.profileWrites.length, console: ev.console.length, pageErrors: ev.pageErrors.length, shader: ev.shader.length, glWarn: ev.glWarn.length, moduleResp: ev.moduleResp.length, frameCreates: ev.frameCreates.length, upstream5xx: ev.upstream5xx.length };
    await declineConsentModal();
    await dismissMediaAsk();
    const chatWasOpen = await closeChat();
    const before = await st();
    await page.evaluate(() => { window.__zotoSandboxBoot = []; });
    const row = { n, id: v.id, name: v.name, group: v.group, sandbox: v.sandbox, ownSky: v.ownSky, needsReview: v.needsReview, chatWasOpen, from: before.mode, fromHeader: before.header };
    row.consentBefore = (await catalogConsent(v.packId)).consent ?? null;
    let picked;
    try {
      picked = await pickInHeader(v.id);
    } catch (e) {
      picked = { found: false, error: String(e).slice(0, 200) };
    }
    row.label = picked.label ?? null;
    if (picked.forcedClick) row.forcedClick = picked.forcedClick;
    if (!picked.found) {
      row.state = "FAIL-other";
      row.reason = picked.error ? `pick failed: ${picked.error}` : "not in header picker";
      const s = await shot(tag);
      row.screenshot = s.file;
      results.views.push(row);
      flush();
      log(`${tag}: ${row.state} ${row.reason}`);
      continue;
    }
    if (before.mode === v.id && before.header === picked.label) row.alreadyActive = true;
    const limit = v.sandbox || v.ownSky ? opts.readyMs : opts.hostReadyMs;
    const out = await waitOutcome(v, picked.label, limit);
    row.outcome = out.kind;
    row.readyMs = out.ms;
    row.seenDuringWait = out.seen;
    let h = null;
    let promptShot = null;
    if (out.kind === "review" || out.kind === "retry") {
      promptShot = await shot(tag);
      row.prompt = out.prompt;
      h = await hold(v, picked.label, Math.min(opts.holdMs, 10_000));
    } else {
      if (/^plugin:carousel(:|$)/.test(v.id)) {
        const t = Date.now();
        while (Date.now() - t < 60_000) {
          const c = await st().catch(() => null);
          if (c?.carousel?.src) break;
          await page.waitForTimeout(1000);
        }
        row.stillWaitMs = Date.now() - t;
      }
      h = await hold(v, picked.label, opts.holdMs);
    }
    row.hold = { changed: h.changed, distinct: h.distinct, skyEverMatched: h.skyEver, glLostAtSec: h.glLostAtSec };
    row.glLostDuringWait = out.st?.glLost ?? null;
    const endSt = await st();
    const s = promptShot ?? await shot(tag);
    row.screenshot = s.file;
    if (s.error) row.screenshotError = s.error;
    let sample = s.buf && endSt.region && endSt.region.w > 60 && endSt.region.h > 60 ? fivePatchSample(s.buf, endSt.region) : null;
    // Spec rev 2: anything that samples black/uniform (and Blob Mesh always) is held 35s before
    // scoring, watching for "running but not showing anything"; the health sampler reads ~10s apart.
    row.notShowing = h.notShowing ?? null;
    if (out.kind === "ready" && (v.id === "plugin:blob-mesh" || (sample && (sample.black || sample.uniform)))) {
      const h2 = await hold(v, picked.label, Math.max(0, 35_000 - opts.holdMs));
      row.longHold = { totalSec: 35, firstSample: sample ? (sample.black ? "black" : sample.uniform ? "uniform" : "ok") : null, changed: h2.changed };
      row.notShowing = row.notShowing ?? h2.notShowing ?? null;
      if (h2.changed && !h.changed) h.changed = { ...h2.changed, atSec: h2.changed.atSec + Math.round(opts.holdMs / 1000) };
      h.viewAttrs.push(...h2.viewAttrs);
      const e2 = await st();
      Object.assign(endSt, e2);
      const s2 = await shot(`${tag}-35s`);
      if (s2.buf) { row.screenshot35s = s2.file; sample = e2.region ? fivePatchSample(s2.buf, e2.region) : sample; }
    }
    row.wall = sample ? { ok: sample.ok, black: sample.black, white: sample.white, uniform: sample.uniform, spread: sample.spread, maxSd: sample.maxSd, patches: sample.patches.map((p) => `${p.r},${p.g},${p.b}/sd${p.sd}`) } : null;
    row.header = endSt.header;
    row.mode = endSt.mode;
    row.lsMode = endSt.lsMode;
    row.pluginSkyId = endSt.pluginSkyId;
    row.animBackdrop = endSt.backdrop;
    row.savedSettings = ev.lastSettings && ev.lastSettings.at >= vStart ? ev.lastSettings : null;
    row.dice = { toggle: endSt.dice, saved: ev.lastSettings?.dice?.on ?? null };
    row.profile = endSt.profile;
    row.mosaic = endSt.mosaic;
    row.sandboxIframes = endSt.sandboxIframes;
    row.sandboxBoot = endSt.sandboxBoot;
    row.notices = endSt.notices;
    row.booting = endSt.booting;
    row.tileHeal = ev.heal.slice(idx.heal).map((x) => x.text);
    row.csp = ev.csp.slice(idx.csp).map((x) => x.text);
    const mods = ev.modules.slice(idx.modules);
    row.tokenMismatches = mods.filter((m) => m.frameToken && m.token !== m.frameToken).length;
    row.moduleLoads = mods.length;
    row.pack4xxPage = ev.pack4xx.slice(idx.pack4xx).map((x) => `${x.status} ${x.url}`);
    row.pack4xxBackendLog = backendLogSince(logOff).filter((l) => /pack-assets/.test(l) && /\b4\d\d\b/.test(l)).map((l) => redact(l).slice(0, 240));
    row.profileWriteErrors = ev.profileWrites.slice(idx.profileWrites).filter((w) => w.status >= 400).map((w) => `${w.method} ${w.url} ${w.status}`);
    row.pageErrors = ev.pageErrors.slice(idx.pageErrors).map((x) => x.text);
    row.shaderErrors = ev.shader.slice(idx.shader).map((x) => x.text);
    row.glWarnings = ev.glWarn.slice(idx.glWarn).map((x) => x.text);
    row.moduleResponses = ev.moduleResp.slice(idx.moduleResp).map((x) => ({ pack: x.pack, status: x.status, failure: x.failure }));
    row.frameCreates = ev.frameCreates.length - idx.frameCreates;
    row.upstream5xx = ev.upstream5xx.slice(idx.upstream5xx).map((x) => `${x.status} ${x.url}`);
    row.previewPanes = endSt.previewPanes;
    row.brandText = endSt.brandText;
    row.twoD = endSt.twoD;
    if (endSt.twoD && !results.twoDFirst) {
      results.twoDFirst = { view: v.id, n };
      results.flags.push(`render host in 2D fallback ("${endSt.brandText}"), first seen at the end of #${n} ${v.id}`);
    }
    row.glLost = endSt.glLost;
    if (endSt.glLost) results.glLostAt = [...(results.glLostAt ?? []), `#${n} ${v.id} (after ${row.from})`];
    if (endSt.glLost && !results.glLostFirst) {
      results.glLostFirst = { view: v.id, n };
      results.flags.push(`main WebGL context lost, first seen at the end of #${n} ${v.id} (previous view ${row.from})`);
    }
    row.wallMosaic = endSt.wallMosaic;
    if (endSt.carousel || h.images.length) {
      const srcs = [...new Set([...(h.images ?? []), ...(endSt.carousel?.src ? [endSt.carousel.src] : [])])];
      row.images = [];
      for (const src of srcs.slice(0, 12)) {
        let sha256 = null; let status = null;
        try {
          const r = await fetch(new URL(src, base));
          status = r.status;
          if (r.ok) sha256 = createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex").slice(0, 16);
        } catch (e) { status = `fetch failed: ${String(e.message ?? e).slice(0, 60)}`; }
        row.images.push({ src: redact(src).slice(0, 220), sha256, status });
      }
      row.imageTitle = h.imageTitle ?? endSt.carousel?.title ?? null;
    }
    Object.assign(row, await catalogConsent(v.packId));
    const consentOk = !v.needsReview || ["reviewed", "authored"].includes(row.consent);

    // ---- classify ----
    const fails = [];
    const fallback = row.tileHeal.some((l) => /step=fallback-pack/.test(l));
    if (out.kind === "review") {
      // Needs you = a Review button, the header naming the picked view, and no sandbox frame.
      // A review notice while the previous view stays put is a silent drop.
      const hdr = out.st?.header ?? row.header;
      const okShape = out.prompt.via === "review-button" && hdr === picked.label;
      if (!okShape) {
        row.state = "FAIL-silent";
        row.reason = `review notice (${out.prompt.via === "review-button" ? "Review button" : "consent modal, no Review button"}) while header stays "${hdr}"${hdr === picked.label ? "" : ` (not "${picked.label}")`}: ${out.prompt.text}`;
      } else if (row.sandboxIframes > 0) {
        row.state = "FAIL-other";
        row.reason = `review prompt but ${row.sandboxIframes} sandbox frame(s) up`;
      } else {
        row.state = "Needs you";
        row.reason = `message with Review: ${out.prompt.text}`;
      }
      // Decline like a user who is not ready to review, and note what the page says.
      if (await declineConsentModal()) {
        await page.waitForTimeout(1500);
        const a = await st();
        row.afterNotNow = { header: a.header, mode: a.mode, notices: a.notices };
      }
    } else if (out.kind === "preview-only") {
      const last = out.st ?? endSt;
      row.state = "FAIL-other";
      row.reason = `picked view never became current: header "${last?.header}", mode ${last?.mode} (previous view kept); own pane "Preview only" in its ${last?.wallMosaic ?? "?"}-pane wall`;
    } else if (out.kind === "retry") {
      row.state = "Couldn't start";
      row.reason = `message with Retry: ${out.prompt.text}`;
    } else if (out.kind === "timeout") {
      const last = out.st ?? endSt;
      const what = last?.mode !== v.id
        ? `view never became active (stayed on ${last?.mode}, header "${last?.header}")`
        : v.sandbox && !last?.sandboxBoot?.includes("ready") ? `sandbox never reached ready in ${Math.round(limit / 1000)}s (boot ${JSON.stringify(last?.sandboxBoot)})`
          : last?.header !== picked.label ? `header "${last?.header}" never matched "${picked.label}"` : `still booting after ${Math.round(limit / 1000)}s`;
      const said = (last?.notices ?? []).filter((x) => x && !/^\s*$/.test(x));
      row.state = said.length ? "FAIL-other" : "FAIL-silent";
      row.reason = `${what}${said.length ? `; on screen: ${said.join(" | ")}` : "; nothing on screen"}${consentOk ? "" : `; consent=${row.consent}`}`;
    } else {
      if (h.changed) {
        const said = (h.changed.notices ?? []).filter(Boolean);
        fails.push(`${said.length ? "" : "[silent] "}changed to ${h.changed.mode} ("${h.changed.header}") ${h.changed.atSec}s into the hold${said.length ? ` (on screen: ${said.join(" | ")})` : ""}`);
      }
      if (row.header !== picked.label && !h.changed) fails.push(`header "${row.header}" != "${picked.label}"`);
      if (v.ownSky && !skyMatches(v, row.pluginSkyId)) fails.push(`pluginSkyId=${JSON.stringify(row.pluginSkyId)} (expected ${v.packId})${h.skyEver ? " (matched earlier in hold)" : ""}`);
      if (fallback) fails.push(`tile-heal fallback-pack: ${row.tileHeal.find((l) => /fallback-pack/.test(l))}`);
      if (endSt.glLost) fails.push("main WebGL context lost");
      // In the 2D fallback the host cannot draw a pack's own sky or a 3D stage; the screen shows a
      // host stand-in (matrix rain seen on Kefrens Bars) or "WebGL unavailable — 3D stage idle".
      if (endSt.twoD && v.ownSky) fails.push(`render host in 2D fallback ("${endSt.brandText}"): own sky cannot show; host stand-in on screen`);

      let dark = null;
      if (row.screenshotError) fails.push(row.screenshotError);
      else if (!row.wall) fails.push("no wall region to sample");
      else if (!row.wall.ok) {
        const what = row.wall.black ? "black" : row.wall.white ? "white" : "uniform";
        if (row.longHold && !row.wall.white) dark = `wall ${what} after 35s (${row.wall.patches.join(" ")})`;
        else fails.push(`wall ${what} (${row.wall.patches.join(" ")})`);
      }
      if (row.csp.length) fails.push(`${row.csp.length} CSP violation(s): ${row.csp[0]}`);
      if (row.tokenMismatches) fails.push(`${row.tokenMismatches} pack-asset token mismatch(es)`);
      if (!consentOk) fails.push(`ran without consent (consent=${row.consent})`);
      if (row.previewPanes.includes(v.id)) fails.push(`own pane "Preview only" in its wall`);
      if (row.shaderErrors.length) fails.push(`WebGL shader error (${row.shaderErrors.length}): ${row.shaderErrors[0]}`);
      if (dark && row.notShowing && !fails.length) {
        row.state = "Couldn't start";
        row.reason = `${dark}; notice at ${row.notShowing.atSec}s: ${row.notShowing.text}`;
      } else if (dark && !row.notShowing) {
        row.state = "FAIL-silent";
        row.reason = [`${dark}, no "running but not showing anything" notice by 35s`, ...fails].join("; ");
      } else if (fails.length || dark) {
        if (dark) fails.unshift(dark);
        row.state = fails.length === 1 && /^\[silent\]/.test(fails[0]) ? "FAIL-silent" : "FAIL-other";
        row.reason = fails.join("; ");
      } else {
        row.state = "Ready";
        row.reason = `ready in ${(row.readyMs / 1000).toFixed(0)}s${v.ownSky ? `, sky ${row.pluginSkyId}` : ""}`;
      }
    }
    const blockedModules = row.moduleResponses.filter((m) => m.pack === v.packId && (m.status === 403 || m.status === 0));
    const consented = (c) => ["authored", "reviewed"].includes(c);
    if (blockedModules.length && (consented(row.consent) || consented(row.consentBefore))) {
      const why = `consent-mismatch: module.js ${blockedModules.map((m) => m.status || m.failure).join(",")} while catalog consent=${row.consentBefore ?? "?"}→${row.consent}`;
      row.state = row.state === "FAIL-silent" ? "FAIL-silent" : "FAIL-other";
      row.reason = row.reason && !/^ready in/.test(row.reason) ? `${why}; ${row.reason}` : why;
    }
    if (row.upstream5xx.length) {
      const why = `upstream-5xx: ${row.upstream5xx.length}x ${row.upstream5xx[0]}`;
      if (row.state === "Ready") { row.state = "FAIL-other"; row.reason = why; } else row.reason = `${row.reason}; ${why}`;
    }
    if (out.kind !== "ready" && row.shaderErrors.length) row.reason = `${row.reason}; WebGL shader error: ${row.shaderErrors[0]}`;
    const failAdd = (why) => {
      if (row.state === "Ready" || row.state === "Needs you" || row.state === "Couldn't start") { row.reason = `${why}; was ${row.state}: ${row.reason}`; row.state = "FAIL-other"; } else row.reason = `${row.reason}; ${why}`;
    };
    // (c) data-view-state / data-view-id: every surface must agree.
    const attrsSeen = [...h.viewAttrs, ...(endSt.viewAttrs ? [endSt.viewAttrs] : [])];
    row.sceneViewId = endSt.sceneViewId;
    if (!attrsSeen.length) row.viewState = "absent";
    else {
      const last = endSt.viewAttrs ?? attrsSeen[attrsSeen.length - 1];
      const mine = last.filter((a) => a.viewId === v.id || a.surface === "header" || a.surface === "wall-notice");
      const hdr = last.find((a) => a.surface === "header");
      const states = [...new Set(mine.filter((a) => a.state).map((a) => a.state))];
      row.viewState = { surfaces: mine, states };
      const dis = [];
      if (hdr && hdr.viewId && hdr.viewId !== v.id) dis.push(`header data-view-id ${hdr.viewId}`);
      if (states.length > 1) dis.push(`data-view-state differs across surfaces: ${mine.map((a) => `${a.surface}=${a.state}`).join(", ")}`);
      if (dis.length) failAdd(`view-state disagreement: ${dis.join("; ")}`);
    }
    // (d) carousels: own source only; when upstream 5xx, note a "sample pictures" line.
    if (/^plugin:carousel(:|$)/.test(v.id)) {
      const fam = { "plugin:carousel": /(^|\.)nasa\.gov$/, "plugin:carousel:apod": /(^|\.)nasa\.gov$/, "plugin:carousel:earth-iotd": /(^|\.)nasa\.gov$/, "plugin:carousel:commons-potd": /(^|\.)wikimedia\.org$/, "plugin:carousel:met": /(^|\.)metmuseum\.org$/ }[v.id];
      const hostOf = (src) => { try { const u = new URL(src, base); const inner = u.pathname === "/api/sources/image" ? u.searchParams.get("url") : null; return inner ? new URL(inner).hostname : null; } catch { return null; } };
      row.imageHosts = (row.images ?? []).map((i) => hostOf(i.src) ?? "(local)");
      const foreign = fam ? (row.images ?? []).map((i) => ({ i, host: hostOf(i.src) })).filter((x) => x.host && !fam.test(x.host)) : [];
      row.sampleLine = h.sampleLine ?? endSt.carousel?.sampleLine ?? null;
      if (row.upstream5xx.length) row.upstreamSampleLine = row.sampleLine ? `shown: ${row.sampleLine}` : "not shown";
      if (foreign.length) failAdd(`another feed's image: ${foreign.map((x) => x.host).join(", ")}${row.upstream5xx.length ? ` (upstream 5xx; sample-pictures line ${row.upstreamSampleLine})` : ""}`);
      else if (row.upstream5xx.length) row.reason = `${row.reason}; sample-pictures line ${row.upstreamSampleLine}`;
    }
    const warn = [];
    if (row.twoD) warn.push(`render host in 2D fallback ("${row.brandText}")`);
    if (row.glWarnings.length) warn.push(`${row.glWarnings.length} WebGL warning line(s): ${row.glWarnings[0]}`);
    if (row.pack4xxPage.length || row.pack4xxBackendLog.length) warn.push(`/pack-assets 4xx: ${[...row.pack4xxPage, ...row.pack4xxBackendLog].slice(0, 3).join(", ")}`);
    if (row.profileWriteErrors.length) warn.push(`profile writes: ${[...new Set(row.profileWriteErrors)].join(", ")}`);
    if (row.tileHeal.length && !fallback) warn.push(`${row.tileHeal.length} tile-heal line(s): ${row.tileHeal[0]}`);
    if (row.wall?.white) warn.push("wall white");
    row.warnings = warn;
    row.secs = Math.round((Date.now() - vStart) / 1000);
    results.views.push(row);
    const prevRow = results.views[results.views.length - 2];
    if (prevRow?.id === "plugin:graph-fabric") {
      const tooMany = [...(row.glWarnings ?? []), ...(row.shaderErrors ?? [])];
      const rendered = row.wall?.ok === true && !row.glLost;
      prevRow.sharedContextAfter = { nextView: v.id, nextState: row.state, webglWarnings: tooMany.length, tooManyErrors: tooMany.some((x) => /too many errors/i.test(x)), nextRendered: rendered, sample: tooMany[0] ?? null };
      const why = [];
      if (tooMany.length) why.push(`${tooMany.length} WebGL warning(s) on the shared context during the next view (${v.id})${prevRow.sharedContextAfter.tooManyErrors ? ", incl. 'too many errors'" : ""}`);
      if (!rendered) why.push(`next view ${v.id} did not render (wall ${row.wall ? (row.wall.ok ? "ok" : "flat") : "n/a"}${row.glLost ? ", context lost" : ""})`);
      if (why.length) {
        if (prevRow.state === "Ready") { prevRow.state = "FAIL-other"; prevRow.reason = why.join("; "); } else prevRow.reason = `${prevRow.reason}; ${why.join("; ")}`;
      }
      log(`graph-fabric shared-context check: ${JSON.stringify(prevRow.sharedContextAfter)}`);
    }
    if (v.id === "plugin:graph-fabric" && (row.glWarnings ?? []).some((x) => /too many errors/i.test(x))) {
      row.reason = `${row.reason}; 'WebGL: too many errors' on the shared context`;
      if (row.state === "Ready") row.state = "FAIL-other";
    }
    flush();
    log(`${tag}: ${row.state} — ${row.reason}${warn.length ? ` [warn: ${warn.join("; ")}]` : ""} (${row.secs}s)`);
    if (endSt.glLost) {
      // A lost main context does not come back on its own; reload like a user would so the
      // rest of the sweep is judged on a live wall. Leftover checks re-baseline from here.
      log(`main WebGL context lost after ${v.id}: reloading the page and re-taking the leftover baseline`);
      const rec = { afterView: v.id, n };
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      const t = Date.now();
      let s3 = null;
      while (Date.now() - t < 120_000) {
        await dismissMediaAsk();
        s3 = await st().catch(() => null);
        if (s3 && !s3.booting && s3.mode) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(3000);
      await dismissMediaAsk(); await closeChat();
      s3 = await st();
      rec.afterReload = { mode: s3.mode, header: s3.header, glLost: s3.glLost };
      if (s3.mode !== "plugin:topology") {
        // Re-take the baseline on a host view, as at boot, not on a pack with its sandbox up.
        const tv = views.find((x) => x.id === "plugin:topology") ?? { id: "plugin:topology", sandbox: false, ownSky: false };
        const tp = await pickInHeader(tv.id);
        if (tp.found) await waitOutcome(tv, tp.label, opts.hostReadyMs);
        await page.waitForTimeout(5000);
      }
      baseline = await page.evaluate(qeLeftoverSnapshot);
      baselineTypes = await page.evaluate(listenerTypes);
      results.glRecoveries.push(rec);
      flush();
    }
  }

  // ---- carousel image pairs: different sources must not be showing the same picture ----
  const imgPairs = [["plugin:carousel:earth-iotd", "plugin:carousel:commons-potd"], ["plugin:carousel:apod", "plugin:carousel"]];
  for (const [a, b] of imgPairs) {
    const ra = results.views.find((r) => r.id === a);
    const rb = results.views.find((r) => r.id === b);
    const pr = { a, b };
    if (!ra || !rb) { pr.state = "n/a"; pr.reason = "one of the pair was not swept"; results.imagePairs.push(pr); continue; }
    const imgs = (r) => (r.images ?? []).filter((i) => i.src);
    const sa = imgs(ra); const sb = imgs(rb);
    pr.aImages = sa; pr.bImages = sb; pr.aTitle = ra.imageTitle ?? null; pr.bTitle = rb.imageTitle ?? null;
    const sameSrc = sa.filter((x) => sb.some((y) => y.src === x.src)).map((x) => x.src);
    const sameHash = sa.filter((x) => x.sha256 && sb.some((y) => y.sha256 === x.sha256)).map((x) => x.sha256);
    const up = [ra, rb].filter((r) => r.upstream5xx?.length || (r.images ?? []).some((i) => typeof i.status === "number" && i.status >= 500));
    if (sameSrc.length || sameHash.length) {
      pr.state = "FAIL"; pr.reason = `same image${sameSrc.length ? ` src ${sameSrc[0]}` : ""}${sameHash.length ? ` sha256 ${sameHash[0]}` : ""}`;
      for (const r of [ra]) { // the later/derived source is the one showing the wrong picture
        const why = `same image as ${b}: ${pr.reason}`;
        if (r.state === "Ready") { r.state = "FAIL-other"; r.reason = why; } else r.reason = `${r.reason}; ${why}`;
      }
    } else if (!sa.length || !sb.length) {
      pr.state = up.length ? "FAIL" : "n/a";
      pr.reason = up.length ? `upstream-5xx on ${up.map((r) => r.id).join(", ")}` : `no image recorded (${!sa.length ? a : b})`;
    } else { pr.state = "PASS"; pr.reason = "different src and hash"; }
    results.imagePairs.push(pr);
    log(`image pair ${a} vs ${b}: ${pr.state} ${pr.reason}`);
  }
  flush();

  // ---- leftover checks: back to Topology ----
  log("return to Topology for leftover checks");
  await declineConsentModal();
  await dismissMediaAsk();
  await closeChat();
  const topo = views.find((v) => v.id === "plugin:topology") ?? { id: "plugin:topology", packId: "topology", sandbox: false, ownSky: false };
  const cur = await st();
  let topoLabel = cur.header;
  if (cur.mode !== topo.id) {
    const p = await pickInHeader(topo.id);
    topoLabel = p.label;
    await waitOutcome(topo, p.label, opts.hostReadyMs);
  }
  await page.waitForTimeout(10_000);
  const after = await page.evaluate(qeLeftoverSnapshot);
  const afterTypes = await page.evaluate(listenerTypes);
  const endTopo = await st();
  await shot("99-leftover-topology");
  const sandboxOk = after.sandboxIframes === 0 || (after.sandboxIframes === 1 && baseline.sandboxIframes === 1);
  results.leftover = {
    topology: { mode: endTopo.mode, header: endTopo.header, expectedHeader: topoLabel },
    before: baseline,
    baselineRetakenAfterGlLoss: results.glRecoveries.length ? results.glRecoveries.map((r) => `#${r.n} ${r.afterView}`) : null,
    after,
    listenerTypeDelta: diffTypes(baselineTypes, afterTypes),
    checks: {
      sandboxFrames: { pass: sandboxOk, before: baseline.sandboxIframes, after: after.sandboxIframes },
      windowListeners: { pass: after.listeners.window === baseline.listeners.window, before: baseline.listeners.window, after: after.listeners.window },
      documentListeners: { pass: after.listeners.document === baseline.listeners.document, before: baseline.listeners.document, after: after.listeners.document },
      otherConnectedListeners: { pass: after.listeners.otherConnected === baseline.listeners.otherConnected, before: baseline.listeners.otherConnected, after: after.listeners.otherConnected, detachedAfter: after.listeners.otherDetached },
      messagePorts: { pass: after.ports.aliveOpen === baseline.ports.aliveOpen, before: baseline.ports.aliveOpen, after: after.ports.aliveOpen, createdDuringSweep: after.ports.created - baseline.ports.created, closedDuringSweep: after.ports.closed - baseline.ports.closed },
      webglContext: { pass: after.gl.mainSameAsStart && after.gl.mainLost === false, sameObject: after.gl.mainSameAsStart, isContextLost: after.gl.mainLost, contextsCreatedDuringSweep: after.gl.contextsCreated - baseline.gl.contextsCreated },
    },
  };
  flush();
  log(`leftover: ${JSON.stringify(Object.fromEntries(Object.entries(results.leftover.checks).map(([k, c]) => [k, c.pass])))}`);

  // ---- mosaic stand-in check: 2x2 with Backrooms, pack-sky panes must not show a stand-in sky ----
  if (extra.mosaic === "on" && views.some((v) => v.id === "plugin:backrooms")) {
    results.mosaic = await mosaicCheck();
    flush();
    log(`mosaic: ${results.mosaic.state} ${results.mosaic.reason}`);
  } else results.mosaic = { state: "skipped", reason: extra.mosaic === "on" ? "Backrooms not in this run" : "--mosaic off" };

  async function mosaicCheck() {
    // Koi Pond top-left so its "Open full view" is clear of the feed dock on the right.
    const m = { tiles: ["plugin:koi-pond", "plugin:air-ssid", "plugin:backrooms", "plugin:topology"], skyOverride: extra.skyOverride };
    const bv = views.find((v) => v.id === "plugin:backrooms");
    const packOf = (mode) => views.find((v) => v.id === mode)?.packId ?? mode.replace(/^plugin:/, "").split(":")[0];
    const consentNow = async () => Object.fromEntries(await Promise.all(m.tiles.map(async (t) => [t, (await catalogConsent(packOf(t))).consent ?? null])));
    m.consentBefore = await consentNow();
    await declineConsentModal(); await dismissMediaAsk(); await closeChat();
    // Grant consent mid-session where it is missing, the way Andrew would: pick the view and
    // answer the review with "I examined the source". Koi Pond first, then Backrooms (current view).
    m.midSessionConsent = [];
    for (const id of ["plugin:koi-pond", "plugin:backrooms"]) {
      if (["authored", "reviewed"].includes(m.consentBefore[id])) continue;
      const vv = views.find((x) => x.id === id);
      if (!vv) continue;
      const pk = await pickInHeader(id);
      const o = await waitOutcome(vv, pk.label, opts.readyMs);
      const rec = { id, first: o.kind };
      if (o.kind === "review") {
        const b2 = page.locator(".modal[role=dialog]").getByRole("button", { name: /I examined the source/i });
        if (await b2.count()) {
          await b2.first().click();
          const o2 = await waitOutcome(vv, pk.label, opts.readyMs);
          rec.afterApprove = o2.kind; rec.header = o2.st?.header;
        } else { rec.afterApprove = "no approve button"; await declineConsentModal(); }
      }
      rec.consent = (await catalogConsent(vv.packId)).consent ?? null;
      m.midSessionConsent.push(rec);
    }
    if (!m.midSessionConsent.length) delete m.midSessionConsent;
    const p = await pickInHeader(bv.id);
    const bo = await waitOutcome(bv, p.label, opts.readyMs);
    m.backroomsPick = bo.kind;
    if (bo.kind === "review") await declineConsentModal();
    await page.evaluate(registerScenes);
    const anim = { mosaic: "4", mosaicTiles: m.tiles, mosaicUniqueSkies: true };
    if (Object.keys(extra.skyOverride).length) anim.mosaicSkies = extra.skyOverride;
    const r = await mcp("set_settings", { anim });
    m.setSettings = { status: r.status, applied: (() => { try { return JSON.parse(r.body?.result?.content?.[0]?.text ?? "{}").applied; } catch { return null; } })() };
    // Wait for the panes (slow under load), then watch them for 30s.
    const tw = Date.now();
    while (Date.now() - tw < 60_000) {
      const n0 = await page.evaluate(() => document.querySelectorAll(".mosaic-pane[data-mode]").length).catch(() => 0);
      if (n0 >= 4) break;
      await page.waitForTimeout(1000);
    }
    m.panesAfterMs = Date.now() - tw;
    const standIns = new Map();
    const reviewOnConsented = new Map();
    const polls = [];
    const pollErrors = [];
    const packSky = new Set(views.filter((v) => v.ownSky).map((v) => v.id));
    let consent = await consentNow();
    const t1 = Date.now();
    let k = 0;
    while (Date.now() - t1 < 30_000) {
      await page.waitForTimeout(1000);
      if (++k % 5 === 0) consent = await consentNow();
      const panes = await page.evaluate(readPaneSkies).catch((e) => { pollErrors.push(String(e).slice(0, 120)); return null; });
      if (!panes) continue;
      polls.push(panes);
      for (const pn of panes) {
        if (/needs review/i.test(pn.text) && ["authored", "reviewed"].includes(consent[pn.mode])) reviewOnConsented.set(`${pn.mode} (consent ${consent[pn.mode]})`, pn.text.slice(0, 80));
        if (!packSky.has(pn.mode)) continue;
        const bd = pn.backdrop;
        const standIn = bd && bd !== "plugin" && bd !== "none" && !pn.previewBackdrop;
        if (standIn) standIns.set(`${pn.mode}=${bd}`, (standIns.get(`${pn.mode}=${bd}`) ?? 0) + 1);
      }
    }
    const shotM = await shot("mosaic-2x2-backrooms");
    m.panesAtEnd = await page.evaluate(readPaneSkies).catch(() => []);
    m.pollsWithPanes = polls.filter((x) => x.length).length;
    m.pollErrors = pollErrors.slice(0, 3);
    m.screenshot = shotM.file;
    m.standIns = Object.fromEntries(standIns);
    m.consentAtEnd = await consentNow();
    if (!m.pollsWithPanes) { m.state = "FAIL"; m.reason = `no mosaic panes appeared in ${Math.round(m.panesAfterMs / 1000)}s (set_settings ${m.setSettings.status} ${JSON.stringify(m.setSettings.applied)})`; }
    else if (standIns.size) { m.state = "FAIL"; m.reason = `pack-sky pane showed a built-in stand-in sky: ${[...standIns.keys()].join(", ")}`; }
    else { m.state = "PASS"; m.reason = "no stand-in sky on pack-sky panes over 30s"; }

    // Row: no "needs review" on a pane whose pack is consented (incl. consent granted this session).
    const nr = { consentBefore: m.consentBefore, consentAtEnd: m.consentAtEnd, midSessionConsent: m.midSessionConsent ?? null };
    if (!m.pollsWithPanes) { nr.state = "n/a"; nr.reason = "no panes"; }
    else if (reviewOnConsented.size) { nr.state = "FAIL"; nr.reason = `"needs review" on consented pane(s): ${[...reviewOnConsented.keys()].join(", ")}`; }
    else { nr.state = "PASS"; nr.reason = `no "needs review" on a consented pane over 30s (consent at end ${JSON.stringify(m.consentAtEnd)})`; }
    m.reviewOnConsented = nr;

    // Row: "Open full view" on a newly consented pack has a frame within 10s with no heal step.
    const of = {};
    const cands = (m.panesAtEnd ?? []).filter((pn) => pn.previewCaption && ["authored", "reviewed"].includes(m.consentAtEnd[pn.mode]));
    if (!cands.length) { of.state = "n/a"; of.reason = `no consented pane offered "Open full view" (preview panes: ${(m.panesAtEnd ?? []).filter((x) => x.previewCaption).map((x) => x.mode).join(", ") || "none"})`; }
    else {
      const target = cands[0].mode;
      of.pane = target; of.consentBefore = m.consentBefore[target]; of.consentAtEnd = m.consentAtEnd[target];
      of.newlyConsented = !["authored", "reviewed"].includes(m.consentBefore[target]) || opts.autoconsent === "on";
      const i0 = { heal: ev.heal.length, frames: ev.frameCreates.length, modules: ev.modules.length };
      await page.evaluate(() => { window.__zotoSandboxBoot = []; });
      const btn = page.locator(`.mosaic-pane[data-mode="${target}"] .mosaic-pane-preview-open`).first();
      const tc = Date.now();
      try { await btn.click({ timeout: 5000 }); } catch (e) {
        const bb = await btn.boundingBox();
        if (bb) { await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); of.forcedClick = String(e.message ?? e).split("\n")[0].slice(0, 100); }
      }
      let got = null;
      while (Date.now() - tc < 10_000) {
        const q = await page.evaluate(() => ({ boot: window.__zotoSandboxBoot ?? [], frames: document.querySelectorAll('iframe[src*="plugin-sandbox"]').length })).catch(() => null);
        if (q && q.frames > 0 && q.boot.includes("frame-ready")) { got = { ms: Date.now() - tc, ...q }; break; }
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(Math.max(0, 10_000 - (Date.now() - tc)));
      const heal = ev.heal.slice(i0.heal).filter((l) => l.text.includes(`pack=${packOf(target)}`) || !/pack=/.test(l.text)).map((l) => l.text);
      of.frame = got; of.heal = heal; of.frameCreates = ev.frameCreates.length - i0.frames;
      of.moduleLoads = ev.modules.slice(i0.modules).filter((x) => x.pack === packOf(target)).length;
      of.screenshot = (await shot("mosaic-open-full-view")).file;
      const f = [];
      if (!got) f.push("no sandbox frame-ready within 10s");
      if (heal.length) f.push(`heal step: ${heal[0]}`);
      of.state = f.length ? "FAIL" : "PASS";
      of.reason = f.join("; ") || `frame-ready in ${(got.ms / 1000).toFixed(1)}s, no heal step`;
    }
    m.openFullView = of;
    const off = await mcp("set_settings", { anim: { mosaic: "off" } });
    m.mosaicOff = off.status;
    await page.waitForTimeout(3000);
    log(`needs-review-on-consented: ${nr.state} ${nr.reason}`);
    log(`open-full-view: ${of.state} ${of.reason}`);
    return m;
  }

  // ---- phase B: reload rows ----
  const readyIds = new Set(results.views.filter((r) => r.state === "Ready").map((r) => r.id));
  let reloadViews = [];
  if (opts.reload === "all") reloadViews = views;
  else if (opts.reload === "sample") {
    const pref = ["plugin:backrooms", "plugin:koi-pond", "plugin:talkers", "plugin:doom", "plugin:hn-rain:lobsters", "plugin:fractal-zoom", "plugin:voxel-world", "plugin:protocols", "plugin:tetris"];
    reloadViews = pref.map((id) => views.find((v) => v.id === id)).filter(Boolean);
    const want = 6;
    const pickable = reloadViews.filter((v) => v.id === "plugin:backrooms" || readyIds.has(v.id));
    // Backrooms always has a row (n/a when it was not Ready); the other five are Ready views.
    reloadViews = [...new Set([...pickable, ...views.filter((v) => readyIds.has(v.id))])];
    const b = views.find((v) => v.id === "plugin:backrooms");
    reloadViews = [...new Set([...(b ? [b] : []), ...reloadViews])].slice(0, want);
  }
  results.meta.reloadScope = opts.reload === "all" ? "every view" : opts.reload === "sample" ? `sample: ${reloadViews.map((v) => v.id).join(", ")}` : "none";
  for (const v of reloadViews) {
    const r0 = Date.now();
    const rr = { id: v.id, phaseA: results.views.find((x) => x.id === v.id)?.state ?? null };
    if (rr.phaseA !== "Ready") {
      rr.state = "n/a"; rr.reason = `not Ready in the sweep (${rr.phaseA})`;
      results.reloadRows.push(rr); flush(); continue;
    }
    await declineConsentModal();
    await dismissMediaAsk();
    await closeChat();
    await page.evaluate(() => { window.__zotoSandboxBoot = []; });
    const cur2 = await st();
    let label = cur2.header;
    if (cur2.mode !== v.id) {
      const p = await pickInHeader(v.id);
      if (!p.found) { rr.state = "FAIL"; rr.reason = "not in picker"; results.reloadRows.push(rr); flush(); continue; }
      label = p.label;
    }
    const pre = await waitOutcome(v, label, v.sandbox || v.ownSky ? opts.readyMs : opts.hostReadyMs);
    await page.waitForTimeout(3000);
    rr.before = { outcome: pre.kind, mode: pre.st?.mode, header: pre.st?.header, pluginSkyId: pre.st?.pluginSkyId };
    if (pre.kind !== "ready") {
      rr.state = "FAIL"; rr.reason = `re-pick before reload did not take (${pre.kind}: header "${pre.st?.header}", mode ${pre.st?.mode})`;
      rr.secs = Math.round((Date.now() - r0) / 1000);
      results.reloadRows.push(rr); flush(); log(`reload ${v.id}: ${rr.state} ${rr.reason}`); continue;
    }
    const pw = ev.profileWrites.length;
    const b0 = { modules: ev.modules.length, frames: ev.frameCreates.length };
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    const rStart = Date.now();
    let s2 = null;
    while (Date.now() - rStart < opts.readyMs) {
      await dismissMediaAsk();
      s2 = await st().catch(() => s2);
      if (s2 && !s2.booting && s2.mode && (s2.mode !== v.id || !v.sandbox || s2.sandboxBoot.includes("ready"))
        && (!v.ownSky || s2.mode !== v.id || skyMatches(v, s2.pluginSkyId) || Date.now() - rStart > 60_000)) break;
      await page.waitForTimeout(1000);
    }
    // Settle: the zoto sweep saw a second frame created then torn down ~5s later, then a third.
    await page.waitForTimeout(12_000);
    s2 = await st();
    const packMods = ev.modules.slice(b0.modules).filter((x) => x.pack === v.packId).length;
    const frames = ev.frameCreates.length - b0.frames;
    rr.builds = { moduleLoads: packMods, frameCreates: frames };
    const shotR = await shot(`reload-${v.id.replace(/^plugin:/, "").replace(/[^a-z0-9-]+/gi, "_")}`);
    rr.after = { mode: s2.mode, header: s2.header, pluginSkyId: s2.pluginSkyId, profile: s2.profile, booting: s2.booting, bootBar: s2.bootBar, notices: s2.notices, dialogs: s2.dialogs.map((d) => d.title || d.text.slice(0, 80)) };
    rr.profileWriteErrors = ev.profileWrites.slice(pw).filter((w) => w.status >= 400).map((w) => `${w.method} ${w.url} ${w.status}`);
    rr.screenshot = shotR.file;
    const f = [];
    if (s2.header !== label) f.push(`header "${s2.header}" (want "${label}")`);
    if (s2.mode !== v.id) f.push(`mode ${s2.mode}`);
    if (v.ownSky && !skyMatches(v, s2.pluginSkyId)) f.push(`pluginSkyId=${JSON.stringify(s2.pluginSkyId)}`);
    if (s2.booting) f.push(`boot overlay up (bar ${s2.bootBar})`);
    if (v.sandbox && (packMods !== 1 || frames > 1)) f.push(`${Math.max(packMods, frames)} pack builds after reload (module.js ${packMods}, frame creates ${frames}; want 1)`);
    rr.state = f.length ? "FAIL" : "PASS";
    rr.reason = f.join("; ") || `header, mode and pluginSkyId kept${v.sandbox ? ", 1 pack build" : ""}`;
    rr.secs = Math.round((Date.now() - r0) / 1000);
    results.reloadRows.push(rr);
    flush();
    log(`reload ${v.id}: ${rr.state} ${rr.reason} (${rr.secs}s)`);
  }

  // ---- Backrooms after explicitly loading the shipped "zoto viz" profile ----
  if (views.some((v) => v.id === "plugin:backrooms")) {
    results.shippedBackrooms = await shippedBackroomsRow();
    flush();
    log(`backrooms-after-zoto-viz-profile: ${results.shippedBackrooms.state} ${results.shippedBackrooms.reason}`);
  }

  async function shippedBackroomsRow() {
    const row = {};
    await declineConsentModal(); await dismissMediaAsk();
    const btn = page.locator("#profile .field-btn");
    await realClick(btn);
    const menuId = await btn.getAttribute("aria-controls");
    const li = page.locator(`[id="${menuId}"] li[role="option"][data-value="zoto-viz"]`);
    if (!(await li.count())) { await page.keyboard.press("Escape"); return { state: "FAIL", reason: "no zoto viz entry in the profile picker" }; }
    await realClick(li.first());
    await page.waitForTimeout(4000);
    await dismissMediaAsk(); // not closing chat/feed here: that edit would autosave into "user"
    const s1 = await st();
    row.profileAfterLoad = s1.profile;
    const bv = views.find((v) => v.id === "plugin:backrooms");
    const i0 = { heal: ev.heal.length, shader: ev.shader.length };
    await page.evaluate(() => { window.__zotoSandboxBoot = []; });
    const p = await pickInHeader(bv.id);
    const out = await waitOutcome(bv, p.label, opts.readyMs);
    row.outcome = out.kind;
    if (out.kind === "review") { await declineConsentModal(); return { ...row, state: "n/a", reason: "Backrooms not consented on this backend (review prompt)" }; }
    const h = await hold(bv, p.label, opts.holdMs);
    const s2 = await st();
    // "Still drawing": the page keeps getting animation frames and the main context is live.
    row.rafTicks3s = await page.evaluate(() => new Promise((res) => { let n = 0; const f = () => { n++; }; const loop = () => { f(); id = requestAnimationFrame(loop); }; let id = requestAnimationFrame(loop); setTimeout(() => { cancelAnimationFrame(id); res(n); }, 3000); })).catch(() => null);
    const sh = await shot("backrooms-after-zoto-viz-profile");
    row.screenshot = sh.file;
    const sample = sh.buf && s2.region ? fivePatchSample(sh.buf, s2.region) : null;
    row.wall = sample ? { black: sample.black, white: sample.white, uniform: sample.uniform, patches: sample.patches.map((q) => `${q.r},${q.g},${q.b}/sd${q.sd}`) } : null;
    Object.assign(row, { header: s2.header, mode: s2.mode, profile: s2.profile, pluginSkyId: s2.pluginSkyId, animBackdrop: s2.backdrop, dice: s2.dice, glLost: s2.glLost, glLostAtSec: h.glLostAtSec, heal: ev.heal.slice(i0.heal).map((x) => x.text), shader: ev.shader.slice(i0.shader).map((x) => x.text) });
    const f = [];
    if (row.profileAfterLoad !== "zoto viz") f.push(`profile read "${row.profileAfterLoad}" right after loading zoto viz`);
    if (out.kind === "review") { await declineConsentModal(); return { ...row, state: "n/a", reason: "Backrooms not consented on this backend (review prompt)" }; }
    if (out.kind !== "ready") f.push(`Backrooms pick ${out.kind} (header "${out.st?.header}")`);
    if (sample?.white) f.push("wall white");
    if (sh.error) f.push(sh.error);
    if (s2.glLost) f.push("main WebGL context lost");
    if (!row.rafTicks3s) f.push("main page not drawing (no animation frames in 3s)");
    row.state = f.length ? "FAIL" : "PASS";
    row.reason = f.join("; ") || `drawing, not white; sky ${row.pluginSkyId}, profile now "${row.profile}"`;
    if (s2.glLost) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForTimeout(8000);
    }
    return row;
  }

  // ---- totals ----
  postRules(results);
  const counts = countStates(results.views);
  results.counts = counts;
  results.reloadCounts = results.reloadRows.reduce((a, r) => { a[r.state] = (a[r.state] ?? 0) + 1; return a; }, {});
  results.meta.finished = new Date().toISOString();
  if (results.pickerCheck.fixturesInPicker.length) results.flags.push(`${extra.devMode ? "" : "FAIL: "}test fixtures in the picker: ${results.pickerCheck.fixturesInPicker.join(", ")}`);
  flush();
  await browser.close();

  if (opts.profile === "shipped" && setup.profileDefaultSet && setup.profileDefaultBefore) {
    const r = await api("api/profiles/default", { method: "PUT", headers: await csrfHeaders(), body: JSON.stringify({ id: setup.profileDefaultBefore }) });
    log(`startup profile restored to ${setup.profileDefaultBefore}: ${r.status}`);
  }
  log(`counts ${JSON.stringify(counts)} reload ${JSON.stringify(results.reloadCounts)} in ${results.meta.elapsedSec}s -> ${outDir}`);
  const leftoverOk = Object.values(results.leftover.checks).every((c) => c.pass);
  const checksFail = !results.pickerCheck.pass || results.mosaic?.state === "FAIL" || results.imagePairs.some((p) => p.state === "FAIL")
    || results.mosaic?.openFullView?.state === "FAIL" || results.mosaic?.reviewOnConsented?.state === "FAIL" || results.shippedBackrooms?.state === "FAIL";
  process.exit(counts["FAIL-silent"] || counts["FAIL-other"] || !leftoverOk || checksFail || results.reloadRows.some((r) => r.state === "FAIL") ? 1 : 0);
}

/** Register every NetScene instance by wrapping prototype methods the wall calls each frame. */
function registerScenes() {
  const z = window.zotoviz;
  if (!z || window.__qeScenes) return !!window.__qeScenes;
  const set = new Set([z]);
  window.__qeScenes = set;
  const proto = Object.getPrototypeOf(z);
  for (const k of ["setAnim", "update", "render", "tick", "frame"]) {
    const f = proto[k];
    if (typeof f !== "function" || f.__qe) continue;
    const w = function (...a) { set.add(this); return f.apply(this, a); };
    w.__qe = true;
    proto[k] = w;
  }
  return true;
}

function readPaneSkies() {
  const out = [];
  for (const pane of document.querySelectorAll(".mosaic-pane[data-mode]")) {
    const r = pane.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) continue;
    let scene = null;
    for (const s of window.__qeScenes ?? []) if (s?.viewEl && pane.contains(s.viewEl)) { scene = s; break; }
    const pb = pane.querySelector(".mosaic-pane-preview-backdrop");
    out.push({
      mode: pane.dataset.mode,
      fault: pane.dataset.fault ?? null,
      backdrop: scene?.dreamAnim?.backdrop ?? null,
      pluginSkyId: scene?.pluginSkyId ?? null,
      previewBackdrop: !!(pb && pb.getBoundingClientRect().width > 0 && getComputedStyle(pb).display !== "none"),
      previewCaption: !!pane.querySelector(".mosaic-pane-preview-caption"),
      text: (() => { const c = pane.cloneNode(true); c.querySelectorAll("select, option, .field-menu, [role=listbox]").forEach((x) => x.remove()); return (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200); })(),
      sceneFound: !!scene,
    });
  }
  return out;
}

function countStates(views) {
  const counts = { Ready: 0, "Needs you": 0, "Couldn't start": 0, "FAIL-silent": 0, "FAIL-other": 0 };
  for (const r of views) counts[r.state] = (counts[r.state] ?? 0) + 1;
  return counts;
}

/**
 * Rules applied after the sweep (also via --rescore). A Retry / Review / "not showing" notice must
 * name the picked view: on 20fa18a7 the previous view's notice carries over to the next pick
 * (Aquarium showing "Ant Colony is running but not showing anything").
 */
function postRules(res) {
  let changed = 0;
  const norm = (x) => String(x ?? "").toLowerCase().replace(/^(air|bt|cpu|net|src|sys|arc)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const r of res.views ?? []) {
    if (!["Couldn't start", "Needs you"].includes(r.state) || r.staleNotice) continue;
    const text = r.prompt?.text ?? r.notShowing?.text ?? "";
    const m = /^(?:Review\s+[“"])?(.+?)(?:[”"]\s+before activating|\s+is running but not showing anything|\s+couldn't start|\s+needs (?:your OK|you))/i.exec(text.trim());
    if (!m) continue;
    const named = norm(m[1]);
    const mine = [norm(r.name), norm(r.label)].filter(Boolean);
    if (mine.some((x) => x === named || x.includes(named) || named.includes(x))) continue;
    r.staleNotice = m[1];
    r.reason = `notice names "${m[1]}", not the picked view (${r.label}); was ${r.state}: ${r.reason}`;
    r.state = "FAIL-other";
    changed++;
  }
  return changed;
}

function listenerTypes() {
  const qe = window.__qe;
  const hist = (t) => {
    const m = qe.listenerReg.get(t);
    const h = {};
    if (m) for (const type of m.values()) h[type] = (h[type] ?? 0) + 1;
    return h;
  };
  return { window: hist(window), document: hist(document) };
}

function diffTypes(a, b) {
  const out = {};
  for (const k of ["window", "document"]) {
    const keys = new Set([...Object.keys(a[k] ?? {}), ...Object.keys(b[k] ?? {})]);
    for (const t of keys) {
      const d = (b[k]?.[t] ?? 0) - (a[k]?.[t] ?? 0);
      if (d) out[`${k}:${t}`] = d;
    }
  }
  return out;
}

function mdCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function markdown(res) {
  const L = [];
  const m = res.meta;
  L.push(`# pick-every-view — ${m.sha} — profile ${m.profile} — autoconsent ${m.autoconsent}`);
  L.push("");
  L.push(`base ${m.base} · started ${m.started} · elapsed ${m.elapsedSec}s · hold ${m.holdMs / 1000}s · reload scope: ${m.reloadScope ?? "(pending)"}`);
  if (res.counts) L.push("", `**Counts:** ${Object.entries(res.counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (res.boot) L.push("", `Boot: ${res.boot.mode} "${res.boot.header}" profile ${res.boot.profile} in ${Math.round(res.boot.ms / 1000)}s; backdrop ${res.boot.backdrop}; dice ${res.boot.dice}`);
  if (res.pickerCheck) L.push("", `Picker: ${res.pickerCheck.pass === false ? "**FAIL** — " : ""}${res.pickerCheck.options} options; fixtures in picker: ${res.pickerCheck.fixturesInPicker.join(", ") || "none"} (${res.pickerCheck.fixtureRule}); catalog views missing from picker: ${res.pickerCheck.viewsMissingFromPicker.join(", ") || "none"}`);
  L.push("", "| # | id | group | state | reason | pluginSkyId | anim.backdrop | dice | consent | screenshot |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of res.views) {
    L.push(`| ${r.n} | ${mdCell(r.id)} | ${r.group} | ${r.state} | ${mdCell(r.reason)}${r.warnings?.length ? ` ⚠ ${mdCell(r.warnings.join("; "))}` : ""} | ${mdCell(r.pluginSkyId)} | ${mdCell(r.animBackdrop)} | ${mdCell(r.dice?.toggle)} | ${mdCell(r.consent)} | ${mdCell(path.basename(r.screenshot ?? ""))} |`);
  }
  const withImg = res.views.filter((r) => r.images?.length);
  if (withImg.length) {
    L.push("", "## Carousel images", "", "| id | caption | src (sha256) |", "|---|---|---|");
    for (const r of withImg) L.push(`| ${mdCell(r.id)} | ${mdCell(r.imageTitle)} | ${mdCell(r.images.map((i) => `${i.src} (${i.sha256 ?? i.status})`).join("<br>"))} |`);
  }
  if (res.imagePairs?.length) {
    L.push("", "| pair | state | reason |", "|---|---|---|");
    for (const p of res.imagePairs) L.push(`| ${p.a} vs ${p.b} | ${p.state} | ${mdCell(p.reason)} |`);
  }
  if (res.mosaic) {
    L.push("", `## Mosaic 2x2 with Backrooms: ${res.mosaic.state}`, "", mdCell(res.mosaic.reason));
    if (res.mosaic.panesAtEnd?.length) L.push("", `Panes at end: ${res.mosaic.panesAtEnd.map((p) => `${p.mode}=${p.backdrop}${p.pluginSkyId ? `/${p.pluginSkyId}` : ""}${p.fault ? ` fault ${p.fault}` : ""}${p.previewCaption ? " (preview)" : ""}`).join(", ")}${res.mosaic.skyOverride && Object.keys(res.mosaic.skyOverride).length ? ` · mosaicSkies override ${JSON.stringify(res.mosaic.skyOverride)}` : ""}`);
  }
  const gc = res.views.find((r) => r.id === "plugin:graph-fabric");
  if (gc?.sharedContextAfter) L.push("", `**Graph cloth → next view on the shared context (${gc.sharedContextAfter.nextView}):** WebGL warnings ${gc.sharedContextAfter.webglWarnings}${gc.sharedContextAfter.tooManyErrors ? " (incl. too many errors)" : ""}, next view rendered ${gc.sharedContextAfter.nextRendered ? "yes" : "no"}`);
  const vsAbsent = res.views.filter((r) => r.viewState === "absent").length;
  L.push("", `**data-view-state / data-view-id:** ${vsAbsent === res.views.length ? "absent on every view" : `present on ${res.views.length - vsAbsent} of ${res.views.length} views; disagreements fail the row`}`);
  if (res.mosaic?.reviewOnConsented) L.push("", `**No "needs review" on a consented pane:** ${res.mosaic.reviewOnConsented.state} — ${mdCell(res.mosaic.reviewOnConsented.reason)}`);
  if (res.mosaic?.openFullView) L.push("", `**Open full view on a newly consented pack (frame ≤10s, no heal):** ${res.mosaic.openFullView.state} — ${mdCell(res.mosaic.openFullView.pane ?? "")} ${mdCell(res.mosaic.openFullView.reason)}`);
  if (res.shippedBackrooms) L.push("", `**Backrooms after loading the shipped "zoto viz" profile:** ${res.shippedBackrooms.state} — ${mdCell(res.shippedBackrooms.reason)} (profile after load "${res.shippedBackrooms.profileAfterLoad}", after pick "${res.shippedBackrooms.profile}", backdrop ${res.shippedBackrooms.animBackdrop}, dice ${res.shippedBackrooms.dice})`);
  if (res.reloadRows.length) {
    L.push("", `## Reload row (${m.reloadScope})`, "", "| id | state | reason | builds (module.js / frames) | after reload (mode / header / sky / profile) |", "|---|---|---|---|---|");
    for (const r of res.reloadRows) L.push(`| ${mdCell(r.id)} | ${r.state} | ${mdCell(r.reason)} | ${r.builds ? `${r.builds.moduleLoads} / ${r.builds.frameCreates}` : ""} | ${mdCell(r.after ? `${r.after.mode} / ${r.after.header} / ${r.after.pluginSkyId} / ${r.after.profile}` : "")} |`);
  }
  if (res.leftover) {
    L.push("", "## Leftover checks (after the sweep and a return to Topology)", "", "| check | pass | before | after | note |", "|---|---|---|---|---|");
    for (const [k, c] of Object.entries(res.leftover.checks)) {
      const note = Object.entries(c).filter(([x]) => !["pass", "before", "after"].includes(x)).map(([x, y]) => `${x}=${y}`).join(" ");
      L.push(`| ${k} | ${c.pass ? "PASS" : "FAIL"} | ${mdCell(c.before)} | ${mdCell(c.after)} | ${mdCell(note)} |`);
    }
    const d = res.leftover.listenerTypeDelta;
    if (Object.keys(d).length) L.push("", `Listener type delta (window/document): ${Object.entries(d).map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
  }
  if (res.glLostAt?.length) L.push("", `Main WebGL context lost at the end of: ${res.glLostAt.join(", ")}; page reloaded ${res.glRecoveries?.length ?? 0}x to continue.`);
  if (res.flags.length) L.push("", "## Flags", "", ...res.flags.map((f) => `- ${f}`));
  return `${L.join("\n")}\n`;
}

main().catch((err) => {
  console.error("pick-every-view: FAIL", err?.stack ?? err);
  process.exit(2);
});
