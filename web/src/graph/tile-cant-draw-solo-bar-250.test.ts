/**
 * #250: in a solo tile (#scene, body without .mosaic) the "couldn't draw." line and its Retry sit
 * above the page panels (#248, z 7), so on a short window the centred line could reach up into the
 * header bar's band and paint over it. The solo line's box now starts at the header's measured height
 * (--bar-h, as .gfx-wall-notice does since #236) and scrolls inside itself rather than crossing it.
 * A padding-top alone would not do: a scrolled box shows its content in its own padding area, so the
 * box's top edge is what has to sit at --bar-h, with overflow clipped to it. Mosaic panes already
 * start under the bar (body.mosaic #wall) and keep their line as it was.
 *
 * Reads the page's own style.css (the way wall-notice-stacking-248 / header-236 do): rules cascaded by
 * specificity and order onto a skeleton of the real DOM. No clocks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Decl = { value: string; important: boolean };
type CssRule = { selectors: string[]; decls: Map<string, Decl>; order: number };

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

/** `top` as the cascade gives it: a `top` longhand that wins over the `inset` shorthand, else inset's first value. */
function topOf(el: Element): string {
  let best: { value: string; rank: number } | null = null;
  for (const r of RULES) {
    for (const prop of ["inset", "top"]) {
      const d = r.decls.get(prop);
      if (!d) continue;
      for (const sel of r.selectors) {
        if (!matches(el, sel)) continue;
        const rank = (d.important ? 1e12 : 0) + specificity(sel) * 1e4 + r.order;
        const value = prop === "inset" ? (d.value.split(/\s+(?![^(]*\))/)[0] ?? "") : d.value;
        if (!best || rank >= best.rank) best = { value, rank };
      }
    }
  }
  return best?.value ?? "";
}

/** A tile with a pack's context-lost line + Retry, as cant-draw-surface paints it. */
function tileLine(mosaic: boolean): HTMLElement {
  document.body.className = mosaic ? "mosaic" : "";
  const wall = document.createElement("div");
  wall.id = "wall";
  const bar = document.createElement("header");
  bar.id = "bar";
  const tile = document.createElement("div");
  if (mosaic) tile.className = "mosaic-pane";
  else tile.id = "scene";
  const line = document.createElement("div");
  line.className = "tile-cant-draw";
  line.dataset.reason = "context-lost";
  line.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "tile-cant-draw__text";
  text.textContent = "Rocket Car Soccer couldn't draw.";
  const retry = document.createElement("button");
  retry.className = "tile-cant-draw__retry";
  retry.textContent = "Retry";
  line.append(text, retry);
  tile.appendChild(line);
  wall.appendChild(tile);
  document.body.append(wall, bar);
  return line;
}

const BAR_H = /^(var\(--bar-h\)|calc\(\s*var\(--bar-h\)\s*\+\s*\d+px\s*\))$/;

describe("#250: a solo tile's couldn't-draw line never crosses the header bar", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.className = "";
  });

  it("(a) solo (#scene, no body.mosaic): the line's box starts at --bar-h and scrolls inside itself", () => {
    const line = tileLine(false);
    expect(styleOf(line, "position"), "positioned over the tile").toBe("absolute");
    expect(topOf(line), "its top edge is the header's measured height").toMatch(BAR_H);
    expect(topOf(line), "not the whole tile from 0").not.toBe("0");
    expect(["auto", "scroll"], "taller content scrolls inside the box, never past its top").toContain(styleOf(line, "overflow-y"));
    // Its line and Retry stay where #248 put them (above the panels), now inside a box below the bar.
    for (const el of [line.querySelector(".tile-cant-draw__text"), line.querySelector(".tile-cant-draw__retry")]) {
      expect(el).not.toBeNull();
      if (!el) return;
      expect(styleOf(el, "z-index"), `${el.className}: z from #248`).toBe("7");
      expect(el.parentElement, `${el.className}: inside the bounded box`).toBe(line);
    }
  });

  it("(b) mosaic pane: the line is as before (inset 0, no --bar-h, no overflow change)", () => {
    const line = tileLine(true);
    expect(topOf(line)).toBe("0");
    for (const prop of ["top", "padding-top", "max-height"]) {
      expect(styleOf(line, prop), `mosaic ${prop}`).not.toContain("--bar-h");
    }
    expect(styleOf(line, "overflow-y"), "mosaic overflow-y").toBe("");
    expect(styleOf(line, "overflow"), "mosaic overflow").toBe("");
  });
});
