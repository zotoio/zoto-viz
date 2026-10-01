/**
 * #248: the wall notice (and its Reload) and a tile's "couldn't draw." line (and its Retry) are drawn
 * above #livefeed / #livechat (fixed, z 6), never under them, and graph labels never cover them.
 *
 * The DOM doesn't compute stacking, so these rows rebuild it from structure: the page's own style.css
 * rules (cascaded by specificity and order, inline style on top) decide which boxes form a stacking
 * context and at what z, and two elements are compared at the first stacking context they don't share,
 * the way a browser paints them. The page's skeleton follows index.html (#wall first, then the header,
 * the side panel, the feed and chat); notices and lines come from the real GfxWallNotice,
 * paintCantDrawSurface and LabelLayer. No clocks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paintCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver } from "../app/view-state";
import { GfxWallNotice } from "./gfx-wall-notice";
import { LabelItem, LabelLayer } from "./labels";

type CssRule = { selectors: string[]; decls: Map<string, { value: string; important: boolean }>; order: number };

/** Split a selector list at its top-level commas (not inside :not(...) / :is(...) / [..]). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Every `selector { decls }` rule in style.css (rules inside @media included), comments dropped. */
function cssRules(): CssRule[] {
  const css = readFileSync(resolve(__dirname, "../style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let order = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, { value: string; important: boolean }>();
    for (const d of (m[2] ?? "").split(";")) {
      const i = d.indexOf(":");
      if (i <= 0) continue;
      const raw = d.slice(i + 1).trim();
      decls.set(d.slice(0, i).trim(), { value: raw.replace(/\s*!important$/, ""), important: /!important$/.test(raw) });
    }
    rules.push({ selectors: splitSelectors((m[1] ?? "").replace(/\s+/g, " ").trim()), decls, order: order++ });
  }
  return rules;
}

const RULES = cssRules();

/** Selector specificity as [ids, classes/attributes/pseudo-classes, types]. */
function specificity(sel: string): number {
  const s = sel.replace(/:(not|is|has|where)\(/g, " (");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length;
  const types = (s.match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 10_000 + cls * 100 + types;
}

function matches(el: Element, sel: string): boolean {
  if (sel.includes("::") || sel.startsWith("@") || /^(from|to|\d+%)$/.test(sel)) return false;
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
}

/** The value `prop` has on `el`: its inline style, else the winning style.css declaration. */
function styleOf(el: Element, prop: string): string {
  if (el instanceof HTMLElement && el.style.getPropertyValue(prop)) return el.style.getPropertyValue(prop);
  let best: { value: string; rank: number } | null = null;
  for (const r of RULES) {
    const d = r.decls.get(prop);
    if (!d) continue;
    for (const sel of r.selectors) {
      if (!matches(el, sel)) continue;
      const rank = (d.important ? 1e12 : 0) + specificity(sel) * 1e4 + r.order;
      if (!best || rank >= best.rank) best = { value: d.value, rank };
    }
  }
  return best?.value ?? "";
}

/** Does this box form a stacking context (CSS 2.1 + positioned layout 3 + the properties that force one)? */
function formsStackingContext(el: Element): boolean {
  const pos = styleOf(el, "position") || "static";
  const z = styleOf(el, "z-index") || "auto";
  if (pos === "fixed" || pos === "sticky") return true;
  if ((pos === "absolute" || pos === "relative") && z !== "auto") return true;
  const parent = el.parentElement;
  if (parent && /^(inline-)?(flex|grid)$/.test(styleOf(parent, "display")) && z !== "auto") return true;
  if (styleOf(el, "isolation") === "isolate") return true;
  const opacity = styleOf(el, "opacity");
  if (opacity && Number.parseFloat(opacity) < 1) return true;
  for (const p of ["transform", "filter", "backdrop-filter", "perspective", "clip-path", "mask"]) {
    const v = styleOf(el, p);
    if (v && v !== "none") return true;
  }
  const mix = styleOf(el, "mix-blend-mode");
  if (mix && mix !== "normal") return true;
  if (/\b(paint|layout|strict|content)\b/.test(styleOf(el, "contain"))) return true;
  return /\b(transform|opacity|filter|isolation|z-index)\b/.test(styleOf(el, "will-change"));
}

const zOf = (el: Element): number => {
  const z = styleOf(el, "z-index");
  return z && z !== "auto" ? Number.parseInt(z, 10) : 0;
};

/** The stacking contexts `el` paints inside, outermost first (the root's direct ones first), and `el` if it forms one. */
function contexts(el: Element): Element[] {
  const out: Element[] = [];
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    if (formsStackingContext(n)) out.unshift(n);
  }
  return out;
}

/** The z an element paints at inside a stacking context it doesn't form: positioned 0, in-flow below that. */
const levelInParent = (el: Element): number => (formsStackingContext(el) ? zOf(el) : (styleOf(el, "position") || "static") === "static" ? -0.5 : 0);

/** True when `a` paints over `b` where they overlap: compared at the first stacking context they don't share. */
function paintsOver(a: Element, b: Element): boolean {
  const ca = contexts(a);
  const cb = contexts(b);
  let i = 0;
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
  const ea = ca[i] ?? a;
  const eb = cb[i] ?? b;
  const za = ca[i] ? zOf(ea) : levelInParent(a);
  const zb = cb[i] ? zOf(eb) : levelInParent(b);
  if (za !== zb) return za > zb;
  // Same z in the same context: the later box in tree order paints on top.
  return (eb.compareDocumentPosition(ea) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

const PACK_VIEW = "plugin:rocket-car-soccer";
const PACK_NAME = "Rocket Car Soccer";

type Page = { wall: HTMLElement; feed: HTMLElement; chat: HTMLElement; modal: HTMLElement; flyout: HTMLElement };

/** index.html's order: #wall first, then the header, the side panel, the feed and chat, the footer. */
function page(mosaic: boolean): Page {
  document.body.className = mosaic ? "mosaic" : "";
  const wall = document.createElement("div");
  wall.id = "wall";
  const bar = document.createElement("header");
  bar.id = "bar";
  const panel = document.createElement("aside");
  panel.id = "panel";
  const feed = document.createElement("div");
  feed.id = "livefeed";
  const chat = document.createElement("div");
  chat.id = "livechat";
  const foot = document.createElement("div");
  foot.id = "foot";
  const modal = document.createElement("div");
  modal.className = "modal";
  const flyout = document.createElement("ul");
  flyout.className = "menu flyout";
  document.body.append(wall, bar, panel, feed, chat, foot, modal, flyout);
  return { wall, feed, chat, modal, flyout };
}

function tile(wall: HTMLElement, id: string, mosaic: boolean): HTMLElement {
  const el = document.createElement("div");
  if (mosaic) el.className = "mosaic-pane";
  else el.id = "scene";
  wall.appendChild(el);
  return el;
}

const visibleAlerts = () => [...document.querySelectorAll<HTMLElement>("[role=alert]")].filter((n) => !n.closest("[hidden]"));

describe("#248: the wall notice and a tile's couldn't-draw line are drawn above the feed and chat panels", () => {
  const notices: GfxWallNotice[] = [];

  beforeEach(() => {
    expect.hasAssertions();
    resetViewStatesForTests();
  });

  afterEach(() => {
    for (const n of notices.splice(0)) n.dispose();
    resetViewStatesForTests();
    setViewStateTileResolver(null);
    document.body.replaceChildren();
    document.body.className = "";
  });

  it("(a) panels: the wall notice + Reload and a pack tile's line + Retry paint over #livefeed/#livechat; the board does not; menus and modals stay on top", () => {
    for (const mosaic of [false, true]) {
      const p = page(mosaic);
      // Solo: one built-in tile. Mosaic: a pack pane (its own line + Retry) next to a built-in pane.
      const packTile = mosaic ? tile(p.wall, "a", true) : null;
      const plainTile = tile(p.wall, "b", mosaic);
      const tiles = new Map<string, HTMLElement>([["b", plainTile]]);
      if (packTile) tiles.set("a", packTile);
      setViewStateTileResolver((id) => tiles.get(id) ?? null);
      const retried: string[] = [];
      if (packTile) {
        setViewState("a", PACK_VIEW, { kind: "cant-draw", reason: "context-lost" }, packTile);
        paintCantDrawSurface("a", () => PACK_NAME, { isPack: (v) => v === PACK_VIEW, retry: (id) => retried.push(id) });
      }
      const n = new GfxWallNotice(p.wall);
      notices.push(n);
      n.onContextLost();
      n.offerReload();
      const notice = p.wall.querySelector<HTMLElement>(".gfx-wall-notice");
      const reload = notice?.querySelector<HTMLButtonElement>(".gfx-wall-reload") ?? null;
      expect(notice, `${mosaic ? "mosaic" : "solo"}: wall notice`).not.toBeNull();
      expect(reload, "Reload").not.toBeNull();
      if (!notice || !reload) return;
      expect(visibleAlerts(), "one alert").toEqual([notice]);
      const above: [string, Element][] = [["wall notice", notice], ["Reload", reload]];
      if (packTile) {
        const line = packTile.querySelector(":scope > .tile-cant-draw");
        const text = line?.querySelector(".tile-cant-draw__text") ?? null;
        const retry = line?.querySelector<HTMLButtonElement>(".tile-cant-draw__retry") ?? null;
        expect(text?.textContent ?? "").toContain(`${PACK_NAME} couldn't draw.`);
        expect(retry, "Retry").not.toBeNull();
        if (!line || !text || !retry) return;
        above.push(["tile line", text], ["Retry", retry]);
        expect(styleOf(retry, "pointer-events"), "Retry takes the pointer").toBe("auto");
        expect(retry.disabled || retry.tabIndex < 0, "Retry is focusable").toBe(false);
        retry.click();
        expect(retried).toEqual(["a"]);
        // The line's scrim covers the whole tile: it stays with the board, under the panels.
        expect(paintsOver(p.feed, line), "feed over the tile's scrim box").toBe(true);
        for (const r of RULES.filter((x) => x.selectors.includes(".tile-cant-draw::before"))) {
          expect(Number.parseInt(r.decls.get("z-index")?.value ?? "0", 10), "scrim layer under the panels' z").toBeLessThan(zOf(p.feed));
        }
      }
      expect(styleOf(reload, "pointer-events"), "Reload takes the pointer").toBe("auto");
      for (const [what, el] of above) {
        for (const [panel, pEl] of [["#livefeed", p.feed], ["#livechat", p.chat]] as const) {
          expect(paintsOver(el, pEl), `${mosaic ? "mosaic" : "solo"}: ${what} over ${panel}`).toBe(true);
        }
        expect(paintsOver(p.modal, el), `.modal over the ${what}`).toBe(true);
        expect(paintsOver(p.flyout, el), `an open menu over the ${what}`).toBe(true);
      }
      // The board itself is not lifted: the panels still paint over #wall and its tiles.
      for (const board of [p.wall, plainTile, ...(packTile ? [packTile] : [])]) {
        expect(paintsOver(p.feed, board), `#livefeed over ${board.id || board.className}`).toBe(true);
        expect(paintsOver(p.chat, board), `#livechat over ${board.id || board.className}`).toBe(true);
      }
      expect(styleOf(p.wall, "z-index") || "auto", "#wall has no z-index (#236)").toBe("auto");
      for (const x of notices.splice(0)) x.dispose();
      resetViewStatesForTests();
      document.body.replaceChildren();
    }
  });

  it("(b) labels: the label layer is its own stacking context, so a near label (z 50000) stays under the wall notice, the panels and modals", () => {
    const p = page(false);
    const scene = tile(p.wall, "main", false);
    const layer = new LabelLayer();
    layer.setSize(800, 600);
    // As NetScene mounts it (scene.ts): absolute over the tile, no pointer.
    Object.assign(layer.domElement.style, { position: "absolute", top: "0", left: "0", pointerEvents: "none" });
    scene.appendChild(layer.domElement);
    const cam = new THREE.PerspectiveCamera(50, 800 / 600, 1, 5000);
    cam.position.set(0, 0, 100);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const item = new LabelItem(document.createElement("div"));
    item.element.className = "label";
    item.element.textContent = "phone 10.0.0.51 · demo";
    item.visible = true;
    layer.add(item);
    layer.render(cam);
    expect(item.element.parentElement, "the label is in the layer").toBe(layer.domElement);
    const n = new GfxWallNotice(p.wall);
    notices.push(n);
    n.onContextLost();
    n.offerReload();
    const notice = p.wall.querySelector(".gfx-wall-notice");
    const reload = notice?.querySelector(".gfx-wall-reload") ?? null;
    expect(notice).not.toBeNull();
    if (!notice || !reload) return;
    expect(Number.parseInt(item.element.style.zIndex, 10), "the depth sort gave it a z above the notice's").toBeGreaterThan(zOf(notice));
    item.element.style.zIndex = "50000";
    expect(formsStackingContext(layer.domElement), "label layer forms a stacking context").toBe(true);
    expect(contexts(item.element), "the label's z ranks inside its layer").toContain(layer.domElement);
    for (const [what, el] of [["wall notice", notice], ["Reload", reload], ["#livefeed", p.feed], ["#livechat", p.chat], [".modal", p.modal]] as const) {
      expect(paintsOver(el, item.element), `${what} over the z 50000 label`).toBe(true);
    }
  });
});
