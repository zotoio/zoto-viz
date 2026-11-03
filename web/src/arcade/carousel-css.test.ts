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
});
