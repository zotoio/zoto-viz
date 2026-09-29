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
  const png = PNG.sync.read(pngBuf);
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
