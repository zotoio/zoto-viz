import { describe, expect, it } from "vitest";
import {
  alignThemeToColor, applyPaneChrome, applyThemeChrome, contrastRatio, effectiveSceneLuminance,
  fadeTowardPole, grayHex, guardLabelMix, hexToHsl, hslHex, LABEL_MAX_MIX, LABEL_MIN_CONTRAST,
  MUTED_MIN_CONTRAST, preferDarkInk, relativeLuminance, sceneInk, SKY_LUMA_CAP,
  takeTheme, themeById, themePickerGroup, themeSwatch, THEMES, toCssHex,
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
    expect(document.documentElement.style.getPropertyValue("--label-fg")).toBe("#ffffff");
    expect(document.documentElement.style.getPropertyValue("--label-stroke")).toBe("#000");
    expect(themePickerGroup({ id: "midnight", dark: true })).toBe("dark");
    expect(themePickerGroup({ id: "paper", dark: false })).toBe("light");
    expect(themePickerGroup({ id: "dusk", dark: true })).toBe("scene");
    expect(themePickerGroup({ id: "vhs", dark: true })).toBe("scene");
    const paper = THEMES.find((x) => x.id === "paper")!;
    applyThemeChrome(paper);
    expect(document.documentElement.style.getPropertyValue("--label-fg")).toBe("#0c0e12");
    expect(document.documentElement.style.getPropertyValue("--label-stroke")).toBe("#000");
  });

  it("picks high-contrast scene ink from the fill and sky", () => {
    expect(relativeLuminance(0xffffff)).toBeGreaterThan(0.9);
    expect(relativeLuminance(0x000000)).toBeLessThan(0.01);
    expect(contrastRatio(0x000000, 0xffffff)).toBeGreaterThan(20);
    expect(contrastRatio(0xffffff, 0x000000)).toBe(contrastRatio(0x000000, 0xffffff));
    expect(sceneInk(0x0b0e14).darkText).toBe(false);
    expect(sceneInk(0xf5f4ef).darkText).toBe(true);
    expect(sceneInk(0xf5f4ef).fg).toBe("#0c0e12");
    expect(sceneInk(0x0b0e14).fg).toBe("#ffffff");
    expect(sceneInk(0x0b0e14).stroke).toBe("#000");
    expect(sceneInk(0xf5f4ef).stroke).toBe("#000");
    expect(sceneInk(0xffffff, false).darkText).toBe(true);
    expect(sceneInk(0x000000, true).darkText).toBe(false);
    const darkFill = 0x0b0e14;
    expect(effectiveSceneLuminance(darkFill, { kind: "none" })).toBeLessThan(0.05);
    expect(effectiveSceneLuminance(darkFill, { kind: "fractal", opacity: 1, bright: 2 })).toBeGreaterThan(0.5);
    expect(effectiveSceneLuminance(darkFill, { kind: "fractal", opacity: 1, bright: 2 })).toBeLessThanOrEqual(SKY_LUMA_CAP);
    expect(sceneInk(grayHex(effectiveSceneLuminance(darkFill, { kind: "fractal", opacity: 1, bright: 2 }))).darkText).toBe(true);
    expect(effectiveSceneLuminance(darkFill, { kind: "space", opacity: 1, bright: 1 })).toBeLessThan(0.3);
    expect(Math.abs(relativeLuminance(grayHex(0.4)) - 0.4)).toBeLessThan(0.02);
    const lime: [number, number, number] = [0.78, 0.88, 0.18];
    const violet: [number, number, number] = [0.48, 0.16, 0.72];
    const fallbackAi = effectiveSceneLuminance(darkFill, { kind: "dynamic", opacity: 1, bright: 1 });
    const aiLum = effectiveSceneLuminance(darkFill, {
      kind: "dynamic", opacity: 1, bright: 1, recipeA: lime, recipeB: violet,
    });
    expect(aiLum).toBeGreaterThan(fallbackAi);
    expect(aiLum).toBeLessThanOrEqual(SKY_LUMA_CAP);
    expect(sceneInk(grayHex(aiLum)).darkText).toBe(true);
    expect(sceneInk(grayHex(aiLum)).stroke).toBe("#000");
    expect(effectiveSceneLuminance(darkFill, {
      kind: "dynamic", opacity: 1, bright: 2, recipeA: lime, recipeB: violet,
    })).toBeLessThanOrEqual(SKY_LUMA_CAP);
    expect(effectiveSceneLuminance(darkFill, {
      kind: "live", opacity: 1, bright: 1.55, liveLuma: 0.92, cap: false,
    })).toBeGreaterThan(SKY_LUMA_CAP);
  });

  it("meets WCAG AA for label ink on every backdrop grey", () => {
    for (let i = 0; i <= 40; i++) {
      const bg = grayHex(i / 40);
      const ink = sceneInk(bg);
      expect(contrastRatio(ink.fgHex, bg)).toBeGreaterThanOrEqual(4);
      const muted = parseInt(ink.muted.slice(1), 16);
      expect(contrastRatio(muted, bg)).toBeGreaterThanOrEqual(MUTED_MIN_CONTRAST - 0.05);
    }
  });

  it("uses dark ink on a bright floor even when the sky estimate is dark", () => {
    const fill = 0x021714;
    const withFloor = effectiveSceneLuminance(fill, {
      kind: "none",
      floor: { hex: 0xc8d4e0, opacity: 0.7, bright: 1.2, down: 1 },
    });
    expect(preferDarkInk(grayHex(withFloor))).toBe(true);
    expect(sceneInk(grayHex(withFloor)).darkText).toBe(true);
    expect(contrastRatio(sceneInk(grayHex(withFloor)).fgHex, grayHex(withFloor))).toBeGreaterThanOrEqual(LABEL_MIN_CONTRAST);
    const liveBright = effectiveSceneLuminance(fill, { kind: "live", opacity: 0.7, bright: 1.55, liveLuma: 0.72 });
    expect(sceneInk(grayHex(liveBright)).darkText).toBe(true);
  });

  it("guards label colour mix so ink stays readable", () => {
    const ink = 0xf4f6fb;
    const bg = 0x0b0e14;
    expect(guardLabelMix(ink, 0x66bb6a, bg, 0)).toBe(0);
    expect(guardLabelMix(ink, 0x66bb6a, bg, 1)).toBeLessThanOrEqual(LABEL_MAX_MIX);
    expect(guardLabelMix(ink, 0x66bb6a, bg, 1)).toBeGreaterThan(0);
    const yellowOnRedSky = grayHex(effectiveSceneLuminance(0x0b0e14, { kind: "dynamic", opacity: 1, bright: 2 }));
    const mix = guardLabelMix(ink, 0xffee58, yellowOnRedSky, 0.85);
    const blended = (() => {
      const t = mix;
      const ch = (s: number) => {
        const a = (ink >> s) & 255, b = (0xffee58 >> s) & 255;
        return Math.round(a + (b - a) * t) & 255;
      };
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    })();
    if (mix > 0) expect(contrastRatio(blended, yellowOnRedSky)).toBeGreaterThanOrEqual(LABEL_MIN_CONTRAST - 0.05);
    expect(guardLabelMix(ink, 0x0b0e14, bg, 0.85)).toBe(0);
  });
});
