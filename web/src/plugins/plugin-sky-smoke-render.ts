import { chromium, type Browser } from "playwright";

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

async function browser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch({
      headless: true,
      ignoreDefaultArgs: ["--disable-software-rasterizer"],
      args: [...PLUGIN_SKY_SMOKE_LAUNCH_ARGS],
    });
  }
  return sharedBrowser;
}

/** One full-screen plugin-sky draw; asserts non-black via median luma + channel variance. */
export async function smokeRenderPluginSky(
  wrappedFrag: string,
  ubo: Float32Array,
  uniforms: PluginSkySmokeUniforms,
): Promise<PluginSkySmokeResult> {
  const b = await browser();
  const page = await b.newPage();
  try {
    const result = await page.evaluate(
      ({ frag, slots, uni, vert }) => {
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
        gl.clearColor(0.02, 0.04, 0.09, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
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
        lumas.sort((a, b) => a - b);
        const medianLuma = lumas[lumas.length >> 1] ?? 0;
        const mean = lumas.reduce((a, v) => a + v, 0) / lumas.length;
        const variance = lumas.reduce((a, v) => a + (v - mean) ** 2, 0) / lumas.length;
        const litPixelFraction = lit / nPix;

        return { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum };
      },
      {
        frag: wrappedFrag,
        slots: Array.from(ubo),
        uni: uniforms,
        vert: VERT,
      },
    );

    if ("error" in result) {
      throw new Error(result.error);
    }

    const { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum } = result;
    const assertion =
      `medianLuma=${medianLuma.toFixed(4)} litFrac=${litPixelFraction.toFixed(3)} maxChannel=${maxChannel} variance=${variance.toFixed(6)} checksum=${pixelChecksum}`;
    return { medianLuma, maxChannel, variance, litPixelFraction, pixelChecksum, assertion };
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
