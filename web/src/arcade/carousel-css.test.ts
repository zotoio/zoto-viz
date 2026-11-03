import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest stubs CSS imports, so read the sheet from disk (cwd is web/).
const css = readFileSync(resolve(process.cwd(), "src/style.css"), "utf8");

describe("carousel stylesheet", () => {
  it("styles mosaic tile carousels (.arcade.carousel), not only the #carousel singleton", () => {
    const rules = css.split("\n").filter((l) => /\.carousel-(still|caption)/.test(l) && l.includes("{"));
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) expect(rule).toContain(".arcade.carousel");
  });

  it("hides the hint/legend foot over a main or maximised mosaic carousel", () => {
    expect(css).toContain("body.mosaic:has(.mosaic-pane.max > .arcade.carousel:not([hidden])) #foot");
    expect(css).toMatch(/:has\(\.mosaic-pane:first-of-type > \.arcade\.carousel:not\(\[hidden\]\)\) #foot \{ display: none; \}/);
  });

  it("keeps top captions below the pane header in mosaic tiles", () => {
    expect(css).toMatch(/mosaic-live \.carousel-still\[data-layout="high-right"\] \.carousel-caption \{ padding-top: calc\(var\(--pane-head/);
  });
});
