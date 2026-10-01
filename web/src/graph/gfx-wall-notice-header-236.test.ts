/**
 * #236: the wall notice was in the DOM but hidden under header#bar (the wall's own stacking
 * context sits under the header). It now sits below the header by the header's measured height
 * (--bar-h), it is an alert, and focus lands on its action (Reload) when it has one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GfxWallNotice } from "./gfx-wall-notice";
import * as wallCopy from "./shader-fallback-copy";

type CssRule = { selector: string; decls: Map<string, string> };

/** Every `selector { decls }` rule in style.css (rules inside @media included), comments dropped. */
function cssRules(): CssRule[] {
  const css = readFileSync(resolve(__dirname, "../style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2]!.split(";")) {
      const i = d.indexOf(":");
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    rules.push({ selector: m[1]!.trim().replace(/\s+/g, " "), decls });
  }
  return rules;
}

function rule(rules: CssRule[], selector: string): CssRule {
  const found = rules.filter((r) => r.selector === selector);
  expect(found.length, `one "${selector}" rule`).toBe(1);
  return found[0]!;
}

/** The wall notice copy, from its source of truth: every GFX_*_NOTICE export of shader-fallback-copy. */
const WALL_NOTICES: string[] = Object.entries(wallCopy)
  .filter(([k, v]) => /^GFX_\w+_NOTICE$/.test(k) && typeof v === "string")
  .map(([, v]) => String(v));

describe("#236: the wall notice sits below header#bar, never over it", () => {
  it("(a) layout: the notice is offset by the measured header height, the wall's context is not raised, mosaic does not offset twice", () => {
    const rules = cssRules();
    const notice = rule(rules, ".gfx-wall-notice");
    expect(notice.decls.get("top"), "offset by --bar-h, not a fixed number").toMatch(/^calc\(\s*var\(--bar-h\)\s*\+\s*\d+px\s*\)$/);
    expect(rule(rules, "#bar").decls.get("z-index")).toBe("5");
    expect(rule(rules, "#wall").decls.has("z-index"), "the wall's context stays under the header").toBe(false);
    for (const r of rules.filter((x) => x.selector.includes(".gfx-wall-notice"))) {
      expect(r.decls.get("position") ?? "absolute", `${r.selector}: stays inside the wall`).not.toBe("fixed");
    }
    expect(rule(rules, "body.mosaic #wall").decls.get("top"), "a mosaic wall starts under the header").toBe("var(--bar-h)");
    expect(rule(rules, "body.mosaic .gfx-wall-notice").decls.get("top") ?? "", "so its notice is not offset twice").not.toContain("--bar-h");
    const main = readFileSync(resolve(__dirname, "../app/main.ts"), "utf8");
    expect(main, "--bar-h is the header's measured height").toContain('setProperty("--bar-h", side ? "0px" : `${barEl.offsetHeight}px`)');
  });
});

describe("#236: every wall notice is an alert, and focus lands on its Retry/Reload", () => {
  let wall: HTMLElement;
  let headerBtn: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    const bar = document.createElement("header");
    bar.id = "bar";
    headerBtn = document.createElement("button");
    headerBtn.textContent = "Settings";
    bar.append(headerBtn);
    wall = document.createElement("div");
    wall.id = "wall";
    document.body.append(bar, wall);
    headerBtn.focus();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  /** The notice's own words (its action button's label left out). */
  function words(el: Element): string {
    return [...el.childNodes].filter((n) => !(n instanceof HTMLButtonElement)).map((n) => n.textContent ?? "").join("");
  }

  it("(b)+(c) each notice it shows has role=alert; with an action, focus is on it; without, focus stays off <body>", () => {
    expect(WALL_NOTICES.length, "the copy module exports the wall notices").toBeGreaterThan(0);
    const seen = new Set<string>();
    const look = (step: string): void => {
      const notices = wall.querySelectorAll(".gfx-wall-notice");
      expect(notices.length, `${step}: one notice`).toBe(1);
      const el = notices[0]!;
      seen.add(words(el));
      expect(el.getAttribute("role"), `${step}: role`).toBe("alert");
      const actions = [...el.querySelectorAll("button")];
      if (actions.length) {
        expect(["Retry", "Reload"], `${step}: action label`).toContain(actions[0]!.textContent);
        expect(document.activeElement, `${step}: focus on ${actions[0]!.textContent}`).toBe(actions[0]);
      } else {
        expect(document.activeElement, `${step}: focus not lost to <body>`).not.toBe(document.body);
        expect(el.contains(document.activeElement), `${step}: nothing in the notice to focus`).toBe(false);
      }
    };
    const n = new GfxWallNotice(wall);
    n.onContextLost();
    look("lost");
    expect(document.activeElement, "the header keeps focus while the wall is restoring").toBe(headerBtn);
    vi.advanceTimersByTime(10_000);
    look("restore window ran out");
    n.onContextLost();
    look("lost again");
    n.offerReload();
    look("host gave up");
    n.dispose();
    expect([...seen].sort(), "every GFX_*_NOTICE was shown and checked").toEqual([...WALL_NOTICES].sort());
  });
});
