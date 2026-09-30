import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type LaunchOptions } from "playwright";

export type PluginSkySmokeUniforms = {
  uTime: number;
  uOpacity: number;
  uBright: number;
  uAudio: number;
  uAccent: [number, number, number];
  uBg: [number, number, number];
};

export type PluginSkySmokeResult = {
  medianLuma: number;
  maxChannel: number;
  variance: number;
  litPixelFraction: number;
  pixelChecksum: number;
  /**
   * QE pick-every-view five-patch sample (the headed pick-every-view harness,
   * `fivePatchSample`): centre + four quarter points, 6x6 px each on this 128 px draw,
   * read top-down like a screenshot. Luma on the 0-255 scale.
   */
  qePatches: { lum: number; sd: number }[];
  /** Per-pixel luma 0-255 in readPixels order, only with `{ keepLuma: true }` (frame-vs-frame diffs). */
  luma?: number[];
  assertion: string;
};

const VERT = `#version 300 es
in vec2 aPos;
out vec3 vDir;
void main() {
  vDir = normalize(vec3(aPos, -1.0));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

let sharedBrowser: Browser | null = null;

/** Chromium defaults include --disable-software-rasterizer, which blocks SwiftShader WebGL2 on GPU-less CI. */
const PLUGIN_SKY_SMOKE_LAUNCH_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--hide-scrollbars",
  "--mute-audio",
] as const;

export function buildPluginSkySmokeBrowserLaunchOptions(): LaunchOptions {
  return {
    headless: true,
    ignoreDefaultArgs: ["--disable-software-rasterizer"],
    args: [...PLUGIN_SKY_SMOKE_LAUNCH_ARGS],
  };
}

async function browser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch(buildPluginSkySmokeBrowserLaunchOptions());
  }
  return sharedBrowser;
}

/**
 * Where a row may save its 128 px draw as a PNG: `$PLUGIN_SKY_PNG_DIR/<name>.png` when that
 * env var is set, else undefined (no file).
 */
export function pluginSkySmokePngPath(name: string): string | undefined {
  const dir = process.env.PLUGIN_SKY_PNG_DIR;
  return dir ? path.join(dir, `${name}.png`) : undefined;
}

/** The colour (0-1 RGB) the harness clears to before the sky draw. */
export const PLUGIN_SKY_SMOKE_CLEAR: readonly [number, number, number] = [0.02, 0.04, 0.09];

/**
 * One full-screen plugin-sky draw; asserts non-black via median luma + channel variance.
 * The sky is composited over the clear like the app's transparent plugin sky material
 * (backdrop.ts ensurePluginMat, three.js NormalBlending): out = sky * a + clear * (1 - a) per
 * channel, with `a` the alpha the shader writes (uOpacity for pack skies). #188: before this the
 * draw overwrote the clear at full strength, so uOpacity never reached the read-back.
 */
export async function smokeRenderPluginSky(
  wrappedFrag: string,
  ubo: Float32Array,
  uniforms: PluginSkySmokeUniforms,
  opts: { keepLuma?: boolean; pngPath?: string } = {},
): Promise<PluginSkySmokeResult> {
  const b = await browser();
  const page = await b.newPage();
  try {
    const result = await page.evaluate(
      ({ frag, slots, uni, vert, keepLuma, wantPng, clear }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
        if (!gl) return { error: "no webgl2" as const };

        const compile = (type: number, src: string) => {
          const sh = gl.createShader(type);
          if (!sh) return null;
          gl.shaderSource(sh, src);
          gl.compileShader(sh);
          if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            return (gl.getShaderInfoLog(sh) || "shader compile failed").trim();
          }
          return sh;
        };

        const vs = compile(gl.VERTEX_SHADER, vert);
        if (typeof vs === "string") return { error: vs };
        const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${frag}`);
        if (typeof fs === "string") return { error: fs };

        const prog = gl.createProgram();
        if (!prog || typeof vs === "string" || typeof fs === "string") return { error: "no program" };
        gl.attachShader(prog, vs as WebGLShader);
        gl.attachShader(prog, fs as WebGLShader);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          return { error: (gl.getProgramInfoLog(prog) || "link failed").trim() };
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const loc = gl.getAttribLocation(prog, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const slotsLoc = gl.getUniformLocation(prog, "zotoVizSlots");
        if (slotsLoc) gl.uniform4fv(slotsLoc, slots);

        gl.uniform1f(gl.getUniformLocation(prog, "uTime"), uni.uTime);
        gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), uni.uOpacity);
        gl.uniform1f(gl.getUniformLocation(prog, "uBright"), uni.uBright);
        gl.uniform1f(gl.getUniformLocation(prog, "uAudio"), uni.uAudio);
        gl.uniform3fv(gl.getUniformLocation(prog, "uAccent"), uni.uAccent);
        gl.uniform3fv(gl.getUniformLocation(prog, "uBg"), uni.uBg);

        gl.viewport(0, 0, 128, 128);
        gl.clearColor(clear[0]!, clear[1]!, clear[2]!, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Colour: SRC_ALPHA / ONE_MINUS_SRC_ALPHA over the clear; the framebuffer's alpha stays 1
        // so the read-back is the composited picture.
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const px = new Uint8Array(128 * 128 * 4);
        gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, px);

        const lumas: number[] = [];
        let maxChannel = 0;
        let lit = 0;
        let pixelChecksum = 0;
        const nPix = px.length / 4;
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i]!;
          const g = px[i + 1]!;
          const b = px[i + 2]!;
          maxChannel = Math.max(maxChannel, r, g, b);
          const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          lumas.push(luma);
          if (luma > 0.12) lit++;
          pixelChecksum = (pixelChecksum + r + g * 3 + b * 7) % 1_000_000_007;
        }
        const qePatches: { lum: number; sd: number }[] = [];
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
          const x0 = Math.round(128 * fx) - 3;
          const yTop = Math.round(128 * fy) - 3;
          const vals: number[] = [];
          for (let y = yTop; y < yTop + 6; y++) {
            for (let x = x0; x < x0 + 6; x++) vals.push(lumas[(127 - y) * 128 + x]! * 255);
          }
          const m = vals.reduce((a, v) => a + v, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
          qePatches.push({ lum: m, sd });
        }
        const luma = keepLuma ? lumas.map((l) => l * 255) : undefined;
        lumas.sort((a, b) => a - b);
        const medianLuma = lumas[lumas.length >> 1] ?? 0;
        const mean = lumas.reduce((a, v) => a + v, 0) / lumas.length;
        const variance = lumas.reduce((a, v) => a + (v - mean) ** 2, 0) / lumas.length;
        const litPixelFraction = lit / nPix;

        const png = wantPng ? canvas.toDataURL("image/png") : undefined;
        return { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum, qePatches, luma, png };
      },
      {
        frag: wrappedFrag,
        slots: Array.from(ubo),
        uni: uniforms,
        vert: VERT,
        keepLuma: opts.keepLuma === true,
        wantPng: !!opts.pngPath,
        clear: [...PLUGIN_SKY_SMOKE_CLEAR],
      },
    );

    if ("error" in result) {
      throw new Error(result.error);
    }

    const { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum, qePatches, luma, png } = result;
    if (opts.pngPath && png) {
      mkdirSync(path.dirname(opts.pngPath), { recursive: true });
      writeFileSync(opts.pngPath, Buffer.from(png.slice(png.indexOf(",") + 1), "base64"));
    }
    const assertion =
      `medianLuma=${medianLuma.toFixed(4)} litFrac=${litPixelFraction.toFixed(3)} maxChannel=${maxChannel} variance=${variance.toFixed(6)} checksum=${pixelChecksum}`;
    return { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum, qePatches, luma, assertion };
  } finally {
    await page.close();
  }
}

export async function closePluginSkySmokeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

export const PLUGIN_SKY_SMOKE_MIN_MEDIAN_LUMA = 0.08;
export const PLUGIN_SKY_SMOKE_MIN_LIT_FRACTION = 0.2;

export function assertPluginSkySmokeDraws(result: PluginSkySmokeResult): void {
  if (result.medianLuma < PLUGIN_SKY_SMOKE_MIN_MEDIAN_LUMA) {
    throw new Error(`plugin sky smoke median luma too low: ${result.assertion}`);
  }
  if (result.litPixelFraction < PLUGIN_SKY_SMOKE_MIN_LIT_FRACTION) {
    throw new Error(`plugin sky smoke has too few lit pixels: ${result.assertion}`);
  }
}

export function assertPluginSkySmokeAnimates(a: PluginSkySmokeResult, b: PluginSkySmokeResult): void {
  if (a.pixelChecksum === b.pixelChecksum) {
    throw new Error(`plugin sky smoke frame did not change with uTime: ${a.assertion} vs ${b.assertion}`);
  }
}
