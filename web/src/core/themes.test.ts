import { describe, expect, it } from "vitest";
import {
  alignThemeToColor, applyPaneChrome, applyThemeChrome, contrastRatio, effectiveSceneLuminance,
  fadeTowardPole, grayHex, hexToHsl, hslHex, relativeLuminance, sceneInk,
  takeTheme, themeById, themeSwatch, THEMES, toCssHex,
} from "./themes";

describe("themes", () => {
  it("looks up and paints themes", () => {
    expect(themeById("midnight").id).toBe("midnight");
    expect(themeById("nope").id).toBe("midnight");
    expect(THEMES.length).toBeGreaterThan(5);
    const t = THEMES[0]!;
    expect(themeSwatch(t)).toMatch(/linear-gradient/);
    expect(toCssHex(0xff00aa)).toBe("#ff00aa");
    applyThemeChrome(t);
    expect(document.documentElement.dataset.theme).toBe(t.id);
    const pane = document.createElement("div");
    applyPaneChrome(pane, t);
    expect(pane.dataset.theme).toBe(t.id);
    const shifted = alignThemeToColor(t, 0x22aaee);
    expect(shifted.id).toBe(t.id);
    expect(alignThemeToColor(t, 0x808080).ui.accent).toBe(t.ui.accent);
    const hsl = hexToHsl(0x4488cc);
    expect(hsl.h).toBeGreaterThanOrEqual(0);
    expect(hslHex(hsl.h, hsl.s, hsl.l)).toBeTypeOf("number");
    expect(fadeTowardPole(0x4488cc, 0.5, true)).toBeTypeOf("number");
    const used = new Set<string>(["midnight"]);
    expect(takeTheme(used).id).not.toBe("");
    expect(takeTheme(used, "midnight").id).toBeTruthy();
    const all = new Set(THEMES.map((x) => x.id));
    expect(takeTheme(all).id).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--label-fg")).toBe("#f4f6fb");
    const paper = THEMES.find((x) => x.id === "paper")!;
    applyThemeChrome(paper);
    expect(document.documentElement.style.getPropertyValue("--label-fg")).toBe("#111318");
  });

  it("picks high-contrast scene ink from the fill and sky", () => {
    expect(relativeLuminance(0xffffff)).toBeGreaterThan(0.9);
    expect(relativeLuminance(0x000000)).toBeLessThan(0.01);
    expect(contrastRatio(0x000000, 0xffffff)).toBeGreaterThan(20);
    expect(contrastRatio(0xffffff, 0x000000)).toBe(contrastRatio(0x000000, 0xffffff));
    expect(sceneInk(0x0b0e14).darkText).toBe(false);
    expect(sceneInk(0xf5f4ef).darkText).toBe(true);
    expect(sceneInk(0xf5f4ef).fg).toBe("#111318");
    expect(sceneInk(0x0b0e14).fg).toBe("#f4f6fb");
    // hysteresis: a near-tie keeps the last ink; a clear winner still switches
    const edge = grayHex(0.19);
    expect(sceneInk(edge, true).darkText).toBe(true);
    expect(sceneInk(edge, false).darkText).toBe(false);
    expect(sceneInk(0xffffff, false).darkText).toBe(true);
    expect(sceneInk(0x000000, true).darkText).toBe(false);
    const darkFill = 0x0b0e14;
    expect(effectiveSceneLuminance(darkFill, { kind: "none" })).toBeLessThan(0.05);
    expect(effectiveSceneLuminance(darkFill, { kind: "fractal", opacity: 1, bright: 2 })).toBeGreaterThan(0.5);
    expect(sceneInk(grayHex(effectiveSceneLuminance(darkFill, { kind: "fractal", opacity: 1, bright: 2 }))).darkText).toBe(true);
    expect(effectiveSceneLuminance(darkFill, { kind: "space", opacity: 1, bright: 1 })).toBeLessThan(0.3);
    expect(Math.abs(relativeLuminance(grayHex(0.4)) - 0.4)).toBeLessThan(0.02);
  });
});
