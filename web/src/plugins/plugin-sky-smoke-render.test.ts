import { chromium } from "playwright";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  assertPluginSkySmokeAnimates,
  assertPluginSkySmokeDraws,
  buildPluginSkySmokeBrowserLaunchOptions,
  closePluginSkySmokeBrowser,
  smokeRenderPluginSky,
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
});
