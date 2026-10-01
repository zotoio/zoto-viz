/**
 * #251: since #250 a solo tile's (#scene, body without .mosaic) "couldn't draw." line sits in a box
 * that starts at --bar-h and scrolls inside itself. That box was pointer-events: none, so a mouse
 * wheel or a finger could not scroll it when the line overflowed (only Tab, by focusing Retry).
 * UX Pro: "when the solo couldn't-draw line overflows, mouse wheel and touch scroll it, and Retry can
 * be reached and clicked without a keyboard."
 *
 * The solo box now takes the pointer and lets a finger pan it on y. The solo scene is hosted, so its
 * camera input element is #scene itself (the box's parent): a wheel over a line that scrolls itself
 * is left to the line (no preventDefault, no camera), and a Retry press never reaches the camera's
 * orbit handler, whose pointer capture would move the click off Retry. A press on the empty part of
 * the box still bubbles to #scene, as it did when it passed through. Mosaic panes keep their line.
 *
 * Row (a) reads the page's own style.css the way tile-cant-draw-solo-bar-250 does (rules cascaded by
 * specificity and order onto a skeleton of the real DOM); row (b) drives the real NetScene listeners
 * on a hosted #scene with style.css in the document. No clocks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { paintCantDrawSurface } from "../app/cant-draw-surface";
import { resetViewStatesForTests, setViewState, setViewStateTileResolver } from "../app/view-state";
import { RenderHost } from "./render-host";
import { NetScene } from "./scene";

type Decl = { value: string; important: boolean };
type CssRule = { selectors: string[]; decls: Map<string, Decl>; order: number };

const CSS_TEXT = readFileSync(resolve(__dirname, "../style.css"), "utf8");

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
  const css = CSS_TEXT.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  let order = 0;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, Decl>();
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

/** The winning style.css value of `prop` on `el` ("" when no rule sets it). */
function styleOf(el: Element, prop: string): string {
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

const PACK_VIEW = "plugin:rocket-car-soccer";
const PACK_NAME = "Rocket Car Soccer";

type Page = { wall: HTMLElement; tile: HTMLElement; line: HTMLElement; text: HTMLElement; retry: HTMLButtonElement; retried: string[] };

/** index.html's skeleton (#wall > #scene, or a mosaic pane), with a pack's context-lost line + Retry painted by the real surface. */
function page(mosaic: boolean, withCss = false): Page {
  if (withCss) {
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.append(style);
  }
  // Set before the tile exists: jsdom caches an element's computed style.
  document.body.className = mosaic ? "mosaic" : "";
  const wall = document.createElement("div");
  wall.id = "wall";
  const tile = document.createElement("div");
  if (mosaic) tile.className = "mosaic-pane";
  else tile.id = "scene";
  for (const el of [wall, tile]) {
    Object.defineProperty(el, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 240, configurable: true });
  }
  wall.appendChild(tile);
  const bar = document.createElement("header");
  bar.id = "bar";
  document.body.append(wall, bar);
  setViewStateTileResolver((id) => (id === "main" ? tile : null));
  setViewState("main", PACK_VIEW, { kind: "cant-draw", reason: "context-lost" }, tile);
  const retried: string[] = [];
  paintCantDrawSurface("main", () => PACK_NAME, { isPack: (v) => v === PACK_VIEW, retry: (id) => retried.push(id) });
  const line = tile.querySelector<HTMLElement>(":scope > .tile-cant-draw");
  const text = line?.querySelector<HTMLElement>(".tile-cant-draw__text") ?? null;
  const retry = line?.querySelector<HTMLButtonElement>(".tile-cant-draw__retry") ?? null;
  if (!line || !text || !retry) throw new Error("the surface painted no line + Retry");
  return { wall, tile, line, text, retry, retried };
}

const wheel = () => new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
const press = () => new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" });

describe("#251: the solo couldn't-draw line scrolls with the wheel and a finger, and Retry takes a click", () => {
  afterEach(() => {
    resetViewStatesForTests();
    setViewStateTileResolver(null);
    document.head.querySelectorAll("style").forEach((s) => s.remove());
    document.body.replaceChildren();
    document.body.className = "";
  });

  it("(a) style.css: the solo box takes the pointer, scrolls on y and lets touch pan it; a mosaic pane's line is as before", () => {
    const solo = page(false);
    expect(styleOf(solo.line, "pointer-events"), "solo box takes the wheel and touch").toBe("auto");
    expect(["auto", "scroll"], "solo box scrolls on y (#250)").toContain(styleOf(solo.line, "overflow-y"));
    expect(styleOf(solo.line, "touch-action"), "a finger pans it on y (pan-y or auto, never none)").toMatch(/^(auto|pan-y)$/);
    // The scrim and the line inherit the box's pointer: none of them opts back out.
    for (const r of RULES.filter((x) => x.selectors.some((s) => s.startsWith(".tile-cant-draw::before")))) {
      expect(r.decls.get("pointer-events")?.value ?? "", "scrim keeps the box's pointer").not.toBe("none");
    }
    expect(styleOf(solo.text, "pointer-events"), "text keeps the box's pointer").not.toBe("none");
    // Retry: still takes the pointer, above the panels (#248), inside the scrolling box (#250).
    expect(styleOf(solo.retry, "pointer-events")).toBe("auto");
    expect(styleOf(solo.retry, "z-index")).toBe("7");
    expect(solo.retry.parentElement).toBe(solo.line);
    resetViewStatesForTests();
    document.body.replaceChildren();

    const pane = page(true);
    expect(styleOf(pane.line, "pointer-events"), "mosaic line passes the pointer through").toBe("none");
    expect(styleOf(pane.line, "touch-action"), "mosaic touch-action").toBe("");
    expect(styleOf(pane.line, "overflow-y"), "mosaic overflow-y").toBe("");
    expect(styleOf(pane.retry, "pointer-events"), "mosaic Retry").toBe("auto");
  });

  it("(b) hosted solo scene: a wheel over the line is left to scroll it, a Retry press is not taken by the camera, and Retry clicks", () => {
    const p = page(false, true);
    const host = new RenderHost(p.wall, { software: true });
    const scene = new NetScene(p.tile, { host });
    // The tile's own handlers are on #scene (hosted: the scene's input element is its container).
    const captured: number[] = [];
    Object.defineProperty(p.tile, "setPointerCapture", { value: (id: number) => captured.push(id), configurable: true });
    Object.defineProperty(p.tile, "releasePointerCapture", { value: () => {}, configurable: true });
    Object.defineProperty(p.tile, "hasPointerCapture", { value: () => false, configurable: true });
    const camera = vi.fn();
    p.tile.addEventListener("wheel", camera);
    p.tile.addEventListener("pointerdown", camera);
    try {
      expect(getComputedStyle(p.line).overflowY, "jsdom applies the solo cascade").toBe("auto");
      for (const target of [p.line, p.text, p.retry]) {
        const ev = wheel();
        target.dispatchEvent(ev);
        expect(ev.defaultPrevented, `wheel over ${target.className}: left to scroll the line`).toBe(false);
      }
      expect(camera, "no camera wheel over the line").not.toHaveBeenCalled();
      // Elsewhere on the tile the camera still has the wheel.
      const bare = wheel();
      p.tile.dispatchEvent(bare);
      expect(bare.defaultPrevented, "wheel on the tile itself: camera").toBe(true);

      p.retry.dispatchEvent(press());
      expect(captured, "no pointer capture on the tile from a Retry press").toEqual([]);
      expect(camera, "Retry press never reaches the tile's orbit handler").not.toHaveBeenCalled();
      p.retry.click();
      expect(p.retried).toEqual(["main"]);
      // The empty part of the box: the press still bubbles to the tile's handlers, as when it passed through.
      p.line.dispatchEvent(press());
      expect(camera).toHaveBeenCalledTimes(1);
    } finally {
      scene.dispose();
      host.dispose();
    }
  });

  it("(c) hosted mosaic pane: a Retry press is not taken by the camera and clicks; a press or wheel elsewhere on the pane still moves the camera", () => {
    // ZotoBoss + UX Pro: the Retry press fix is shared with mosaic panes; everything else on a pane is as on main.
    const p = page(true, true);
    const host = new RenderHost(p.wall, { software: true });
    const scene = new NetScene(p.tile, { host });
    const captured: number[] = [];
    Object.defineProperty(p.tile, "setPointerCapture", { value: (id: number) => captured.push(id), configurable: true });
    Object.defineProperty(p.tile, "releasePointerCapture", { value: () => {}, configurable: true });
    Object.defineProperty(p.tile, "hasPointerCapture", { value: () => false, configurable: true });
    const camera = vi.fn();
    p.tile.addEventListener("pointerdown", camera);
    try {
      expect(getComputedStyle(p.line).overflowY, "a mosaic line does not scroll itself").not.toMatch(/^(auto|scroll)$/);
      // Retry: no drag, no capture, and the click counts.
      p.retry.dispatchEvent(press());
      expect(captured, "mosaic Retry press: no pointer capture on the pane").toEqual([]);
      expect(camera, "mosaic Retry press never reaches the pane's orbit handler").not.toHaveBeenCalled();
      p.retry.click();
      expect(p.retried).toEqual(["main"]);
      // Next to Retry: a press on the pane (and through its pointer-events: none line) still reaches the camera.
      p.tile.dispatchEvent(press());
      expect(camera, "press on the bare pane: camera").toHaveBeenCalledTimes(1);
      expect(captured, "press on the bare pane: orbit drag captures the pointer, as on main").toEqual([1]);
      p.line.dispatchEvent(press());
      p.text.dispatchEvent(press());
      expect(camera, "press on the pane's line: camera, as on main").toHaveBeenCalledTimes(3);
      // The wheel over the pane, its line and its text is still the camera's.
      for (const target of [p.tile, p.line, p.text]) {
        const ev = wheel();
        target.dispatchEvent(ev);
        expect(ev.defaultPrevented, `mosaic wheel over ${target.className}: camera, as on main`).toBe(true);
      }
    } finally {
      scene.dispose();
      host.dispose();
    }
  });
});
