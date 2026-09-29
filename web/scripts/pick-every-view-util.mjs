/**
 * Helpers for pick-every-view.test.mjs: view list, ordering, wall sampling, arg parsing,
 * and the in-page instrumentation installed with addInitScript.
 */
import { PNG } from "pngjs";

/** Test fixtures that ship in plugins/src but are not user views (until `fixture: true` exists). */
export const FIXTURE_IDS = new Set([
  "tile-health-black",
  "tile-health-detail",
  "tile-health-lose-ctx",
  "tile-health-stall",
  "tile-health-static",
  "sandbox-fixture-multi",
  "host-mesh-demo",
]);

export function parseArgs(argv) {
  const out = {
    baseUrl: "http://127.0.0.1:7020/",
    profile: "fresh",
    autoconsent: "keep",
    reload: "sample",
    holdMs: 20_000,
    readyMs: 120_000,
    hostReadyMs: 45_000,
    only: null,
    outDir: null,
    sha: null,
    label: "",
    backendLog: null,
    chrome: process.env.PACK_MIRROR_CHROME_PATH || "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, null];
    const val = () => (inline ?? argv[++i]);
    switch (k) {
      case "--base-url": out.baseUrl = val(); break;
      case "--profile": out.profile = val(); break;
      case "--autoconsent": out.autoconsent = val(); break;
      case "--reload": out.reload = val(); break;
      case "--hold-ms": out.holdMs = Number(val()); break;
      case "--ready-ms": out.readyMs = Number(val()); break;
      case "--only": out.only = val().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--out-dir": out.outDir = val(); break;
      case "--sha": out.sha = val(); break;
      case "--label": out.label = val(); break;
      case "--backend-log": out.backendLog = val(); break;
      case "--chrome": out.chrome = val(); break;
      case "-h": case "--help": out.help = true; break;
      default: throw new Error(`unknown argument ${a}`);
    }
  }
  out.baseUrl = out.baseUrl.replace(/\/?$/, "/");
  if (!["fresh", "shipped"].includes(out.profile)) throw new Error("--profile must be fresh or shipped");
  if (!["on", "off", "keep"].includes(out.autoconsent)) throw new Error("--autoconsent must be on, off or keep");
  if (!["all", "sample", "none"].includes(out.reload)) throw new Error("--reload must be all, sample or none");
  return out;
}

export function viewId(packId, instId) {
  return !instId || instId === packId ? `plugin:${packId}` : `plugin:${packId}:${instId}`;
}

const GROUP_RANK = { graph: 0, demo: 1, arcade: 2 };

export function catalogGroup(p) {
  const caps = p.capabilities ?? [];
  const look = p.visualisation?.look ?? p.look ?? {};
  if (caps.includes("viz.read") || caps.includes("viz.write") || look.backdrop === "plugin") return "demo";
  const engine = p.visualisation?.engine ?? p.engine;
  if (engine && engine !== "graph") return "arcade";
  return "graph";
}

/** Every picker view the catalog describes (instances expanded), fixtures split out. */
export function viewsFromCatalog(plugins) {
  const hasFixtureField = plugins.some((p) => typeof p.fixture === "boolean");
  const isFixture = (p) => (hasFixtureField ? p.fixture === true : FIXTURE_IDS.has(p.id));
  const views = [];
  const fixtures = [];
  for (const p of plugins) {
    const engine = p.visualisation?.engine ?? p.engine;
    if (!engine) continue; // data sources are not views
    const look = p.visualisation?.look ?? p.look ?? {};
    const insts = Array.isArray(p.instances) && p.instances.length ? p.instances : [{ id: p.id, name: p.name }];
    for (const inst of insts) {
      const id = viewId(p.id, inst.id || p.id);
      const row = {
        id,
        packId: p.id,
        instanceId: inst.id && inst.id !== p.id ? inst.id : null,
        name: inst.name || p.name || p.id,
        group: catalogGroup(p),
        engine,
        sandbox: !!(p.has_frontend || p.runtime === "typescript"),
        ownSky: !!(p.has_sky_shader || look.backdrop === "plugin"),
        needsReview: !!(p.has_frontend || p.runtime === "typescript" || p.service || p.backend_sha256
          || p.collector || p.collector_sha256 || p.shader_sha256 || p.has_sky_shader),
        fixtureSource: hasFixtureField ? "fixture-field" : "explicit-list",
      };
      (isFixture(p) ? fixtures : views).push(row);
    }
  }
  return { views, fixtures, hasFixtureField };
}

/** Picker order (graph, demo, arcade; by name), then Backrooms moved to the middle. */
export function orderViews(views, middleId = "plugin:backrooms", startId = "plugin:topology") {
  const sorted = [...views].sort((a, b) => (GROUP_RANK[a.group] ?? 9) - (GROUP_RANK[b.group] ?? 9)
    || a.name.localeCompare(b.name));
  // The page boots on Topology; picking it first would be a no-op, so it goes last-but-safe.
  const start = sorted.findIndex((v) => v.id === startId);
  if (start === 0 && sorted.length > 1) sorted.push(sorted.shift());
  const mi = sorted.findIndex((v) => v.id === middleId);
  if (mi < 0) return sorted;
  const [mid] = sorted.splice(mi, 1);
  const at = Math.min(Math.floor(sorted.length / 2), Math.max(0, sorted.length - 3));
  sorted.splice(at, 0, mid);
  // Graph cloth mid-list with views after it (its shader errors hit the shared context).
  const gi = sorted.findIndex((v) => v.id === "plugin:graph-fabric");
  if (gi >= 0 && sorted.length > 4 && (gi === 0 || gi >= sorted.length - 2)) {
    const [g] = sorted.splice(gi, 1);
    let to = Math.max(1, Math.floor(sorted.length / 4));
    if (sorted[to]?.id === middleId) to++;
    sorted.splice(to, 0, g);
  }
  return sorted;
}

function patchStats(png, x0, y0, size) {
  const n0 = [];
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let y = y0; y < Math.min(png.height, y0 + size); y++) {
    for (let x = x0; x < Math.min(png.width, x0 + size); x++) {
      const i = (y * png.width + x) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++;
      n0.push(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  }
  const mean = { r: r / n, g: g / n, b: b / n };
  const lum = n0.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(n0.reduce((s, v) => s + (v - lum) ** 2, 0) / n);
  return { x: x0, y: y0, r: Math.round(mean.r), g: Math.round(mean.g), b: Math.round(mean.b), lum: +lum.toFixed(1), sd: +sd.toFixed(1) };
}

/**
 * Five 24px patches (centre + four quarter points) inside `region` of a viewport PNG.
 * black: at least four patches darker than lum 24 with sd < 4 (a HUD or badge can sit on one).
 * white: at least four patches brighter than lum 235. uniform: at least four patches within 6 of
 * the median colour with sd < 2.5 (one flat colour with maybe one overlay patch).
 */
export function fivePatchSample(pngBuf, region, size = 24) {
  const png = Buffer.isBuffer(pngBuf) || pngBuf instanceof Uint8Array ? PNG.sync.read(pngBuf) : pngBuf;
  const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  const patches = pts.map(([fx, fy]) => patchStats(png,
    Math.max(0, Math.round(region.x + region.w * fx - size / 2)),
    Math.max(0, Math.round(region.y + region.h * fy - size / 2)), size));
  const med = (k) => [...patches.map((p) => p[k])].sort((a, b) => a - b)[2];
  const m = { r: med("r"), g: med("g"), b: med("b") };
  const near = patches.filter((p) => Math.max(Math.abs(p.r - m.r), Math.abs(p.g - m.g), Math.abs(p.b - m.b)) < 6 && p.sd < 2.5).length;
  const spread = Math.max(...["r", "g", "b"].map((c) => Math.max(...patches.map((p) => p[c])) - Math.min(...patches.map((p) => p[c]))));
  const maxSd = Math.max(...patches.map((p) => p.sd));
  const black = patches.filter((p) => p.lum < 24 && p.sd < 4).length >= 4;
  const white = patches.filter((p) => p.lum > 235).length >= 4;
  const uniform = near >= 4;
  return { patches, spread, maxSd, black, white, uniform, ok: !black && !white && !uniform };
}

/** Luminance at or above this counts as a lit pixel (the carousel still backdrop #07090f is ~9). */
export const LIT_LUM = 40;
/** Below this share of the tile left after masking overlays, the row carries a harness warning. */
export const MIN_UNMASKED = 0.4;
/** Below this share there is too little content area to judge; the five-patch verdict stands. */
export const MIN_JUDGED = 0.05;

function clipRect(r, region) {
  const x0 = Math.max(region.x, r.x); const y0 = Math.max(region.y, r.y);
  const x1 = Math.min(region.x + region.w, r.x + r.w); const y1 = Math.min(region.y + region.h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Content-area sample: judge only the pixels the view draws, not the text and chrome over it.
 *
 * `masks` are viewport rects ({x, y, w, h}) of the caption, title, notices, HUD, fps badge, header,
 * feed/chat panels and any other DOM text over the tile (qeOverlayRects collects them in the page).
 * Pixels under a mask (grown by `pad` px for anti-aliasing) are left out; the rest is read on a
 * `stride` grid and in `cell` px cells.
 *   contentLit     share of content pixels at or above LIT_LUM
 *   varied         share of content pixels more than 16 away from the median luminance (structure)
 *   flatCells      share of content cells that are one flat colour near the median cell colour
 *   maskedFraction share of the region under a mask; remaining = 1 - maskedFraction
 * black:   dark (median lum < 24), contentLit < 1% and varied < 1% (no drawn structure left)
 * white:   90% of content pixels brighter than lum 235
 * uniform: not black, flatCells >= 95% and varied < 1% (one flat colour of any shade)
 * ok is null (not judged) when less than MIN_JUDGED of the region is left; lowCoverage is set when
 * less than MIN_UNMASKED is left (a harness warning, not a view failure).
 * `png` is a PNG buffer or a decoded pngjs PNG.
 */
export function maskedWallSample(png, region, masks = [], { pad = 2, stride = 2, cell = 16 } = {}) {
  const img = Buffer.isBuffer(png) || png instanceof Uint8Array ? PNG.sync.read(png) : png;
  const reg = clipRect(region, { x: 0, y: 0, w: img.width, h: img.height });
  if (!reg) return { region, masks: 0, maskedFraction: 1, remaining: 0, contentLit: null, ok: null, lowCoverage: true, reason: "region outside the screenshot" };
  const rx = Math.floor(reg.x); const ry = Math.floor(reg.y);
  const rw = Math.max(1, Math.floor(reg.w)); const rh = Math.max(1, Math.floor(reg.h));
  const covered = new Uint8Array(rw * rh);
  let used = 0;
  for (const m of masks) {
    const c = clipRect({ x: m.x - pad, y: m.y - pad, w: m.w + 2 * pad, h: m.h + 2 * pad }, { x: rx, y: ry, w: rw, h: rh });
    if (!c) continue;
    used++;
    const x0 = Math.floor(c.x - rx); const x1 = Math.min(rw, Math.ceil(c.x + c.w - rx));
    const y0 = Math.floor(c.y - ry); const y1 = Math.min(rh, Math.ceil(c.y + c.h - ry));
    for (let y = y0; y < y1; y++) covered.fill(1, y * rw + x0, y * rw + x1);
  }
  let maskedPx = 0;
  for (let i = 0; i < covered.length; i++) maskedPx += covered[i];
  const maskedFraction = maskedPx / covered.length;
  const hist = new Uint32Array(256);
  let n = 0; let lit = 0; let bright = 0; let lumSum = 0;
  const cx = Math.ceil(rw / cell); const cy = Math.ceil(rh / cell);
  const cn = new Uint32Array(cx * cy); const ct = new Uint32Array(cx * cy);
  const cr = new Float64Array(cx * cy); const cg = new Float64Array(cx * cy); const cb = new Float64Array(cx * cy);
  const cl = new Float64Array(cx * cy); const cl2 = new Float64Array(cx * cy);
  for (let y = 0; y < rh; y += stride) {
    for (let x = 0; x < rw; x += stride) {
      const k = Math.floor(y / cell) * cx + Math.floor(x / cell);
      ct[k]++;
      if (covered[y * rw + x]) continue;
      const i = ((ry + y) * img.width + (rx + x)) * 4;
      const r = img.data[i]; const g = img.data[i + 1]; const b = img.data[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      hist[Math.min(255, Math.round(l))]++;
      n++; lumSum += l;
      if (l >= LIT_LUM) lit++;
      if (l > 235) bright++;
      cn[k]++; cr[k] += r; cg[k] += g; cb[k] += b; cl[k] += l; cl2[k] += l * l;
    }
  }
  const remaining = +(1 - maskedFraction).toFixed(3);
  const base = { region: { x: rx, y: ry, w: rw, h: rh }, masks: used, maskedFraction: +maskedFraction.toFixed(3), remaining, lowCoverage: remaining < MIN_UNMASKED };
  if (!n || remaining < MIN_JUDGED) return { ...base, contentLit: null, ok: null, reason: `only ${Math.round(remaining * 100)}% of the tile left after masking overlays` };
  let acc = 0; let median = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= n) { median = v; break; } }
  let varied = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(v - median) > 16) varied += hist[v];
  const cells = [];
  for (let k = 0; k < cn.length; k++) {
    if (!ct[k] || cn[k] * 2 < ct[k]) continue; // a cell counts when at least half of it is content
    const m = cl[k] / cn[k];
    cells.push({ r: cr[k] / cn[k], g: cg[k] / cn[k], b: cb[k] / cn[k], sd: Math.sqrt(Math.max(0, cl2[k] / cn[k] - m * m)) });
  }
  const med = (key) => { const a = cells.map((c) => c[key]).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 0; };
  const mc = { r: med("r"), g: med("g"), b: med("b") };
  const flat = cells.filter((c) => c.sd < 2.5 && Math.max(Math.abs(c.r - mc.r), Math.abs(c.g - mc.g), Math.abs(c.b - mc.b)) < 6).length;
  const contentLit = lit / n; const variedF = varied / n; const flatCells = cells.length ? flat / cells.length : 0;
  const black = median < 24 && contentLit < 0.01 && variedF < 0.01;
  const white = bright / n >= 0.9;
  const uniform = !black && cells.length > 0 && flatCells >= 0.95 && variedF < 0.01;
  return {
    ...base,
    contentLit: +contentLit.toFixed(4),
    varied: +variedF.toFixed(4),
    flatCells: +flatCells.toFixed(3),
    cells: cells.length,
    meanLum: +(lumSum / n).toFixed(1),
    medianLum: median,
    median: { r: Math.round(mc.r), g: Math.round(mc.g), b: Math.round(mc.b) },
    black, white, uniform,
    ok: !black && !white && !uniform,
  };
}

/** Short word for a sample verdict: ok / black / white / uniform / unjudged. */
export function sampleVerdict(s) {
  if (!s) return "n/a";
  if (s.ok === null || s.ok === undefined) return "unjudged";
  return s.ok ? "ok" : s.black ? "black" : s.white ? "white" : "uniform";
}

/**
 * Carousel content rule: the picture the carousel shows must be loaded and lit. `image` is the
 * visible <img> as pageState reports it (null when no <img> is showing); `imgSample` is
 * maskedWallSample over that image's rect with the overlay rects masked out.
 * Returns { blank, imgLoaded, why }.
 */
export function carouselContentVerdict(image, imgSample) {
  const imgLoaded = !!(image && image.src && image.complete && image.naturalWidth > 0 && !image.errored);
  const why = [];
  if (!image) why.push("no carousel image showing");
  else if (!image.src) why.push("carousel <img> has no src");
  else if (image.errored) why.push(`carousel image failed to load (${image.errored})`);
  else if (!image.complete) why.push("carousel image still loading");
  else if (!(image.naturalWidth > 0)) why.push("carousel image broken (naturalWidth 0)");
  const v = sampleVerdict(imgSample);
  if (imgSample && (imgSample.black || imgSample.uniform)) why.push(`image area ${v} (contentLit ${imgSample.contentLit}, varied ${imgSample.varied}, ${Math.round(imgSample.maskedFraction * 100)}% masked)`);
  return { blank: why.length > 0, imgLoaded, why: why.join("; ") };
}

/**
 * Wall score for a row. The five-patch sample is kept as it was (legacyOk); the content-area sample
 * can only add a failure (overlay text no longer passes a dark wall), and for carousel views the
 * visible image must be loaded and lit (carouselContentVerdict).
 *   five:     fivePatchSample over the region (whole tile, overlays included)
 *   content:  maskedWallSample over the region with overlay rects masked
 *   carousel: { image, imgSample } for carousel views, else null
 * Returns { ok, what, by, legacyOk, contentOk, contentVerdict, carousel, warnings, note }.
 */
export function scoreWall({ five = null, content = null, carousel = null } = {}) {
  const legacyOk = five ? five.ok : null;
  let ok = !!(five || content);
  let what = null; const by = [];
  if (five && !five.ok) { ok = false; what = five.black ? "black" : five.white ? "white" : "uniform"; by.push("five-patch"); }
  if (content && content.ok === false) { ok = false; what ??= sampleVerdict(content); by.push("content"); }
  const car = carousel ? carouselContentVerdict(carousel.image, carousel.imgSample) : null;
  if (car?.blank) { ok = false; what ??= "blank"; by.push("carousel-image"); }
  const warnings = [];
  if (content?.lowCoverage) warnings.push(`only ${Math.round((content.remaining ?? 0) * 100)}% of the tile left after masking ${content.masks ?? 0} overlay rect(s)${content.ok === null ? " (content not judged)" : ""}`);
  if (carousel?.imgSample?.lowCoverage) warnings.push(`only ${Math.round((carousel.imgSample.remaining ?? 0) * 100)}% of the carousel image left after masking overlays`);
  const note = five && content && five.ok === false && content.ok === true ? `five-patch ${what} but content area has structure (contentLit ${content.contentLit}, varied ${content.varied})` : null;
  return { ok, what, by: by.join("+") || null, legacyOk, contentOk: content ? content.ok : null, contentVerdict: sampleVerdict(content), carousel: car, warnings, note };
}

const normName = (x) => String(x ?? "").toLowerCase().replace(/^(air|bt|cpu|net|src|sys|arc)\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The view/source a wall notice or caption line is about ("X isn't responding", "X couldn't start", ...). */
export function noticeSubject(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const m = /(?:^|\.\s)(?:Showing sample pictures\.\s*)?(.+?)\s+isn['’]t responding/i.exec(t)
    || /^(?:Review\s+[“"])?(.+?)(?:[”"]\s+before activating|\s+is running but not showing anything|\s+couldn['’]t start|\s+needs (?:your OK|you))/i.exec(t);
  return m ? m[1].replace(/^Showing sample pictures\.\s*/i, "").trim() : null;
}

/** Loose match of a notice subject to a view name ("NASA" ~ "NASA IOTD", "Wikimedia Commons" ~ "Commons POTD"). */
export function subjectIsView(subject, name) {
  const a = normName(subject); const b = normName(name);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const at = new Set(a.split(" "));
  return b.split(" ").some((w) => w.length >= 4 && at.has(w));
}

/** First notice text whose subject is another view (and not this one), else null. */
export function noticeNamingOtherView(texts, view, allViews) {
  for (const t of texts ?? []) {
    const subj = noticeSubject(t);
    if (!subj) continue;
    if ([view.name, view.label].some((n) => subjectIsView(subj, n))) continue;
    const other = (allViews ?? []).find((u) => u.id !== view.id && subjectIsView(subj, u.name));
    if (other) return { text: t, subject: subj, view: other.id };
  }
  return null;
}

/**
 * In-page: viewport rects of everything drawn over the wall that is not the view's own content:
 * header, foot/legend/hint, feed and chat panels, captions, notices, HUD, fps badges, dialogs,
 * node labels, plus the line boxes of every other visible DOM text node. Element opacity is ignored
 * (a caption mid-fade still gets masked). Canvases, images and sandbox iframes are content.
 */
export function qeOverlayRects() {
  const CHROME = [
    "#bar", "#foot", "#hint", "#legend", "#panel", "#livefeed", "#livechat", "#debuglog", "#boot",
    ".pane-fps", ".label", ".overlay", ".viz-hud", ".carousel-caption", ".carousel-sample",
    ".mosaic-pane-notice", ".mosaic-wall-notice", ".mosaic-pane-preview-caption", ".wall-notice-region",
    ".gfx-wall-notice", ".tile-heal-msg", "#modeSwitchStatus", ".pack-mirror-placeholder",
    "[role=alert]", "[role=status]", "[role=dialog]", "dialog[open]", ".modal", "[role=listbox]",
  ].join(",");
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden";
  };
  const name = (el) => (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : ""}`);
  const rects = [];
  const add = (r, kind, what) => {
    const x0 = Math.max(0, r.left); const y0 = Math.max(0, r.top);
    const x1 = Math.min(innerWidth, r.right); const y1 = Math.min(innerHeight, r.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    rects.push({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), kind, what });
  };
  const chromeEls = [...document.querySelectorAll(CHROME)].filter((el) => !el.closest("[hidden]") && shown(el));
  for (const el of chromeEls) add(el.getBoundingClientRect(), "chrome", name(el));
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "TITLE", "CANVAS", "IFRAME"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let t; let k = 0;
  while ((t = walker.nextNode()) && k < 3000) {
    if (!/\S/.test(t.nodeValue || "")) continue;
    const el = t.parentElement;
    if (!el || skipTags.has(el.tagName) || el.closest(CHROME) || !shown(el)) continue;
    range.selectNodeContents(t);
    for (const r of range.getClientRects()) { add(r, "text", name(el)); k++; }
  }
  return { rects, vw: innerWidth, vh: innerHeight };
}

/** Runs in every frame before page scripts. Top frame also counts listeners, ports, GL contexts. */
export function qeInstrument() {
  if (window.__qe) return;
  let isTop = false;
  try { isTop = window.top === window; } catch { isTop = false; }
  const qe = (window.__qe = { top: isTop });
  document.addEventListener("securitypolicyviolation", (e) => {
    console.warn(`[qe-csp] ${e.effectiveDirective || e.violatedDirective} blocked=${e.blockedURI} src=${e.sourceFile || ""}:${e.lineNumber || ""} disp=${e.disposition}`);
  }, true);
  if (!isTop) return;
  // <img> load errors (carousel stills): the element's own error event does not bubble, so capture.
  const imgErrors = (qe.imgErrors = []);
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && imgErrors.length < 200) imgErrors.push({ src: t.getAttribute("src") || "", at: Math.round(performance.now()) });
  }, true);

  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;
  const fnIds = new WeakMap();
  let nextId = 1;
  const fid = (f) => {
    if (!f || (typeof f !== "function" && typeof f !== "object")) return 0;
    let id = fnIds.get(f);
    if (!id) { id = nextId++; fnIds.set(f, id); }
    return id;
  };
  const reg = new WeakMap();
  const targets = [];
  qe.listenerTargets = targets;
  qe.listenerReg = reg;
  const counts = (qe.listeners = { window: 0, document: 0, other: 0, onceAdded: 0, external: 0 });
  const bucket = (t) => (t === window ? "window" : t === document ? "document" : "other");
  const cap = (o) => (typeof o === "boolean" ? o : !!(o && o.capture));
  EventTarget.prototype.addEventListener = function qeAdd(type, listener, opts) {
    try {
      const sig = opts && typeof opts === "object" ? opts.signal : null;
      const b0 = bucket(this);
      // Only count listeners the app adds: window/document adds from test-driver code (Playwright
      // hit-target checks, page.evaluate) carry no http(s) frame in their stack.
      const external = b0 !== "other" && (String(type).startsWith("__playwright") || !/https?:\/\//.test(new Error().stack || ""));
      if (external) counts.external++;
      if (!external && listener && !(opts && typeof opts === "object" && opts.once) && !(sig && sig.aborted)) {
        let m = reg.get(this);
        if (!m) { m = new Map(); reg.set(this, m); if (bucket(this) === "other") targets.push(new WeakRef(this)); }
        const key = `${type}|${fid(listener)}|${cap(opts)}`;
        if (!m.has(key)) {
          m.set(key, type);
          counts[bucket(this)]++;
          if (sig) {
            const self = this;
            origAdd.call(sig, "abort", () => { if (m.delete(key)) counts[bucket(self)]--; }, { once: true });
          }
        }
      } else if (listener) counts.onceAdded++;
    } catch { /* never break the page */ }
    return origAdd.call(this, type, listener, opts);
  };
  EventTarget.prototype.removeEventListener = function qeRemove(type, listener, opts) {
    try {
      const m = reg.get(this);
      const key = `${type}|${fid(listener)}|${cap(opts)}`;
      if (m && m.delete(key)) counts[bucket(this)]--;
    } catch { /* ignore */ }
    return origRemove.call(this, type, listener, opts);
  };

  const OrigMC = window.MessageChannel;
  const portRefs = (qe.portRefs = []);
  const closed = new WeakSet();
  qe.portsCreated = 0;
  qe.portsClosed = 0;
  function QeMessageChannel() {
    const mc = new OrigMC();
    qe.portsCreated += 2;
    portRefs.push(new WeakRef(mc.port1), new WeakRef(mc.port2));
    return mc;
  }
  QeMessageChannel.prototype = OrigMC.prototype;
  window.MessageChannel = QeMessageChannel;
  qe.portClosed = closed;
  const origClose = MessagePort.prototype.close;
  MessagePort.prototype.close = function qeClose() {
    if (!closed.has(this)) { closed.add(this); qe.portsClosed++; }
    return origClose.call(this);
  };

  const gl = (qe.gl = []);
  const origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function qeGetContext(t, a) {
    const c = origGet.call(this, t, a);
    if (c && /webgl/.test(String(t)) && !gl.some((e) => e.ctx === c)) gl.push({ ctx: c, canvas: this, type: String(t), at: Math.round(performance.now()) });
    return c;
  };
}

/** In-page: counts for the leftover check (call after window.gc when exposed). */
export function qeLeftoverSnapshot() {
  const qe = window.__qe;
  if (typeof window.gc === "function") { window.gc(); window.gc(); }
  let otherConnected = 0; let otherDetached = 0; let otherTargetsAlive = 0;
  for (const ref of qe.listenerTargets) {
    const t = ref.deref();
    if (!t) continue;
    const m = qe.listenerReg.get(t);
    const n = m ? m.size : 0;
    if (!n) continue;
    otherTargetsAlive++;
    if (typeof Node !== "undefined" && t instanceof Node && !t.isConnected) otherDetached += n; else otherConnected += n;
  }
  let portsAlive = 0; let portsAliveOpen = 0;
  for (const ref of qe.portRefs) {
    const p = ref.deref();
    if (!p) continue;
    portsAlive++;
    if (!qe.portClosed.has(p)) portsAliveOpen++;
  }
  const canvas = document.querySelector("#wall canvas.render-host");
  const entries = qe.gl.filter((e) => e.canvas === canvas);
  const cur = entries[entries.length - 1]?.ctx ?? null;
  if (!window.__qeMainGl && cur) window.__qeMainGl = cur;
  const sandboxIframes = document.querySelectorAll('iframe[src*="plugin-sandbox"]').length;
  return {
    listeners: { window: qe.listeners.window, document: qe.listeners.document, otherConnected, otherDetached, otherTargetsAlive, onceAdded: qe.listeners.onceAdded, externalIgnored: qe.listeners.external },
    ports: { created: qe.portsCreated, closed: qe.portsClosed, alive: portsAlive, aliveOpen: portsAliveOpen },
    gl: {
      contextsCreated: qe.gl.length,
      mainSameAsStart: !!cur && cur === window.__qeMainGl,
      mainLost: cur ? cur.isContextLost() : null,
      mainType: entries[entries.length - 1]?.type ?? null,
      softgl: document.body.hasAttribute("data-softgl"),
    },
    sandboxIframes,
    iframes: document.querySelectorAll("iframe").length,
    gcExposed: typeof window.gc === "function",
  };
}
