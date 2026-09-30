import { chromium } from "playwright";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  assertPluginSkySmokeAnimates,
  assertPluginSkySmokeDraws,
  buildPluginSkySmokeBrowserLaunchOptions,
  closePluginSkySmokeBrowser,
  PLUGIN_SKY_SMOKE_CLEAR,
  smokeRenderPluginSky,
  type PluginSkySmokeUniforms,
} from "./plugin-sky-smoke-render";

const MINI_FRAG = `uniform vec4 zotoVizSlots[8];
uniform float uTime;
uniform float uOpacity;
uniform float uBright;
uniform vec3 uAccent;
uniform vec3 uBg;
out vec4 fragColor;
void main() {
  float h = zotoVizSlots[0][0];
  vec3 col = mix(uBg, uAccent, h + 0.15 * sin(uTime));
  col *= uBright;
  fragColor = vec4(col, uOpacity);
}`;

/** A flat sky: every pixel is uBg at alpha uOpacity (the alpha a pack sky's fragColor carries). */
const SOLID_FRAG = `uniform float uOpacity;
uniform vec3 uBg;
out vec4 fragColor;
void main() {
  fragColor = vec4(uBg, uOpacity);
}`;

/** Luma (0-255) of a 0-1 RGB colour stored in an 8-bit framebuffer, the way the harness reads it back. */
function byteLuma(c: readonly number[]): number {
  return 0.2126 * Math.round(255 * c[0]!) + 0.7152 * Math.round(255 * c[1]!) + 0.0722 * Math.round(255 * c[2]!);
}

describe("plugin sky smoke render", () => {
  afterAll(async () => {
    await closePluginSkySmokeBrowser();
  });

  it("plugin sky smoke browser launch opts in SwiftShader for GPU-less CI", async () => {
    expect.hasAssertions();
    await closePluginSkySmokeBrowser();
    const slots = new Float32Array(32);
    slots[0] = 0.5;
    const uniforms = {
      uTime: 0.2,
      uOpacity: 1,
      uBright: 1,
      uAudio: 0,
      uAccent: [0.4, 0.8, 1] as [number, number, number],
      uBg: [0.05, 0.08, 0.15] as [number, number, number],
    };
    const launchSpy = vi.spyOn(chromium, "launch").mockRejectedValue(new Error("launch-probe"));
    await expect(smokeRenderPluginSky(MINI_FRAG, slots, uniforms)).rejects.toThrow("launch-probe");
    expect(launchSpy).toHaveBeenCalledOnce();
    const launchOpts = launchSpy.mock.calls[0]?.[0];
    expect(launchOpts?.ignoreDefaultArgs).toEqual(["--disable-software-rasterizer"]);
    expect(launchOpts?.headless).toBe(true);
    expect(launchOpts?.args).toEqual([
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--mute-audio",
    ]);
    launchSpy.mockRestore();
  });

  it("Chromium headless exposes WebGL2 when SwiftShader is allowed", async () => {
    expect.hasAssertions();
    const browser = await chromium.launch(buildPluginSkySmokeBrowserLaunchOptions());
    try {
      const page = await browser.newPage();
      const ok = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        return Boolean(canvas.getContext("webgl2", { preserveDrawingBuffer: true }));
      });
      expect(ok).toBe(true);
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it("smokeRenderPluginSky draws non-black pixels with software WebGL2", async () => {
    expect.hasAssertions();
    const slots = new Float32Array(32);
    slots[0] = 0.75;
    const uniforms = {
      uTime: 0.5,
      uOpacity: 1,
      uBright: 1,
      uAudio: 0,
      uAccent: [0.4, 0.8, 1] as [number, number, number],
      uBg: [0.05, 0.08, 0.15] as [number, number, number],
    };
    const a = await smokeRenderPluginSky(MINI_FRAG, slots, { ...uniforms, uTime: 0.1 });
    const b = await smokeRenderPluginSky(MINI_FRAG, slots, { ...uniforms, uTime: 2.5 });
    expect(() => assertPluginSkySmokeDraws(a)).not.toThrow();
    expect(() => assertPluginSkySmokeDraws(b)).not.toThrow();
    expect(() => assertPluginSkySmokeAnimates(a, b)).not.toThrow();
    expect(a.pixelChecksum).not.toBe(b.pixelChecksum);
  });

  /**
   * #188: the harness composites the sky's alpha (uOpacity) over its clear like the app's
   * transparent plugin sky material: out = sky x a + clear x (1 - a) per channel. A look with
   * opacity below 1 therefore changes the read-back. Revert: drop the blend (the draw overwrites
   * the clear at full strength) and the a 0.5 / 0.25 reads equal the opaque sky: red.
   */
  it("composites uOpacity over the clear: a look below opacity 1 changes the output (out = sky x a + clear x (1 - a))", async () => {
    expect.hasAssertions();
    const sky: [number, number, number] = [0.8, 0.5, 0.2];
    const base: PluginSkySmokeUniforms = { uTime: 0, uOpacity: 1, uBright: 1, uAudio: 0, uAccent: sky, uBg: sky };
    const slots = new Float32Array(32);
    const composite = (a: number) => sky.map((c, i) => c * a + PLUGIN_SKY_SMOKE_CLEAR[i]! * (1 - a));
    const opaque = byteLuma(sky);
    const got: string[] = [];
    for (const a of [1, 0.96, 0.5, 0.25]) {
      const r = await smokeRenderPluginSky(SOLID_FRAG, slots, { ...base, uOpacity: a });
      const luma = r.medianLuma * 255;
      const want = byteLuma(composite(a));
      got.push(`a ${a}: luma ${luma.toFixed(2)} want ${want.toFixed(2)}`);
      expect(Math.abs(luma - want), `a ${a}: harness luma ${luma.toFixed(2)} vs composite ${want.toFixed(2)} (opaque sky ${opaque.toFixed(2)})`).toBeLessThanOrEqual(1);
      if (a <= 0.5) expect(opaque - luma, `a ${a}: the look's opacity changes the output`).toBeGreaterThan(40);
    }
    process.stdout.write(`[smoke-opacity] ${got.join("; ")}\n`);
  }, 60_000);
});
