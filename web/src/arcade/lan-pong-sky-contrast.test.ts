/** @vitest-environment happy-dom */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { hashColor } from "../core/modes";
import { contrastRatio, relativeLuminance, SKY_LUMA_CAP, SKY_LUMA_CAP_GLSL, themeById, type Theme } from "../core/themes";
import { BACKDROP_SKY_FRAG, pluginSkyVertGlsl } from "../graph/backdrop";
import { LookStage } from "../graph/look";
import { NetScene } from "../graph/scene";
import { IDLE_VIZ_DEMO_HOSTS } from "../plugins/fixtures/idle-viz-frame";
import { mergeLook } from "../plugins/plugin";
import { parseLook } from "../plugins/plugin-visualisation";

/**
 * #195 (UX Pro look target): lan-pong's sky reads as background behind the game. Every NetPong
 * piece (the paddle, the ball, the packet dots) keeps a WCAG contrast >= 3:1 against the sky pixels
 * behind it at FULL AUDIO (pulse level = bass = 1: the brightest the sky gets).
 *
 * Real path, no copies of the sky numbers: lan-pong's visualisation.yml look -> parseLook ->
 * mergeLook -> NetScene.setAnim -> the arcade LookStage.frame (look.ts apply: skyAudio's
 * skyOpacity x (0.28 + 0.85 level), skyBright x (0.4 + 1.5 bass), bgAudio's clear pulse) ->
 * Backdrop.setLook -> the sky material's uniforms. The WebGL renderer is a recorder (no GPU): its
 * render() hands back the world and the camera, setClearColor the clear behind the sky.
 *
 * The sky pixel is a CPU mirror (the TS copy) of the drawn fragment (backdrop.ts BACKDROP_SKY_FRAG:
 * hash2 / noise / fbm / space() + capSkyLuma). It is pinned to the GLSL two ways (the parity rows):
 * every structural value it uses is parsed from the shipped GLSL and must equal the copy's MIRROR
 * constants, and the normalized source of those GLSL functions must match SKY_GLSL_PIN; the mirror
 * also refuses to evaluate a shader whose parsed values differ from MIRROR. Approximations vs the GPU: float64 instead of float32
 * (the sin-hash values differ bit for bit, their distribution does not); vDir is the exact sphere
 * direction behind the pixel (ray / sky-sphere hit), not the 48 x 32 tessellation's interpolation;
 * the output is clamped, alpha-blended over the clear at uOpacity and rounded to bytes, then WCAG
 * luminance. The floor grid's lines (a separate mesh, gridAudio off here) are not sky and not counted.
 *
 * "Behind the piece" is taken over every place a piece can be: the paddle runs the full play
 * height, balls cross between the columns and the dots sit at both edges, so the row samples the
 * whole tile (every 2nd pixel of 1280 x 720) at sky times 0..60 s in 10 s steps, and each piece
 * is held to the brightest sky pixel found.
 *
 * Star specks are left out of the rule, per UX Pro's #195 option (b). They are picked out by the
 * shader's star terms, not by a brightness cutoff: the sky is evaluated with space()'s two speck
 * additions zeroed (`star`, the fine specks, and `giant`, the coarse ones; their coefficients are
 * still read from the shader), so what is held to 3:1 is the base + nebula wash. The specks run
 * into SKY_LUMA_CAP at any usable skyBright, so counting them would mean an almost black sky.
 */

const rec = vi.hoisted(() => ({ render: vi.fn(), clear: vi.fn(), on: false }));

vi.mock("../graph/webgl", () => ({ probeWebGL: () => true }));

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  class RecordingRenderer {
    readonly domElement = document.createElement("canvas");
    setPixelRatio(): void {}
    setSize(): void {}
    setClearColor(c: unknown): void { rec.clear(c); }
    dispose(): void {}
    forceContextLoss(): void {}
    render(scene: unknown, camera: unknown): void { rec.render(scene, camera); }
  }
  /** Only the LookStage under test gets the recorder (rec.on around its attach); NetScene keeps three's own renderer. */
  const WebGLRenderer = new Proxy(orig.WebGLRenderer, {
    construct: (target, args) => (rec.on ? new RecordingRenderer() : Reflect.construct(target, args)),
  });
  return { ...orig, WebGLRenderer };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const YML = path.resolve(here, "../../../plugins/src/lan-pong/visualisation.yml");
const MIN_CONTRAST = 3;
const W = 1280, H = 720, STRIDE = 2;
const SKY_TIMES = [0, 10, 20, 30, 40, 50, 60];

type Look = { skyBright: unknown; skyOpacity: unknown; theme: unknown; backdrop: unknown };
function ymlLook(): Look {
  const vis = parseYaml(readFileSync(YML, "utf8")) as { look?: Partial<Look> };
  return { skyBright: vis.look?.skyBright, skyOpacity: vis.look?.skyOpacity, theme: vis.look?.theme, backdrop: vis.look?.backdrop };
}

/**
 * The TS copy of the sky shader: every structural value the CPU mirror below depends on, as backdrop.ts's
 * shipped GLSL (BACKDROP_SKY_FRAG) has it. skyGlslShape() parses the same values out of the GLSL; the parity
 * rows hold parsed === MIRROR, and mirrorShape() refuses to evaluate a shader that disagrees, so a drift on
 * either side goes red instead of being silently re-derived. Parity also holds the whole shader structure:
 * every top-level item of the fragment and vertex shaders (preprocessor lines, declarations, function
 * signatures) and every main() statement of both, so a `#define` shadowing a uniform or any vertex-shader edit
 * goes red on a parity row, not only on the pin. SKY_GLSL_PIN pins the normalized source (comments stripped,
 * whitespace collapsed: comment / whitespace-only edits keep the same hash) of the copied functions plus those
 * lists. If either fails: update MIRROR and the mirror functions to match the GLSL, then re-pin SKY_GLSL_PIN.
 */
type SkyShape = {
  hash2: { kx: number; ky: number; k: number };
  noise: { s3: number; s2: number; corners: [number, number][] };
  fbm: { octaves: number; a0: number; w0: number; lacunarity: number; gain: number };
  space: {
    base: number; nXY: number; nZ: number; nT: number; neb: number; statements: number;
    sXY: number; sZ: number; sPow: number; gXZ: number; gPow: number;
    starK: number; starAudio: number; giantMix: number; giantK: number; giantAudio: number;
  };
  dispatch: { fractalBelow: number; spaceBelow: number };
  out: { cap: string; col: string; bright: string; alpha: string };
  luma: { r: number; g: number; b: number; floor: number; cap: number };
  /** BACKDROP_SKY_FRAG / pluginSkyVertGlsl structure: top-level items and main() statements, normalized. */
  frag: { topLevel: string[]; main: string[] };
  vert: { topLevel: string[]; main: string[] };
};
const MIRROR: SkyShape = {
  hash2: { kx: 127.1, ky: 311.7, k: 43758.5453123 },
  noise: { s3: 3, s2: 2, corners: [[1, 0], [0, 1], [1, 1]] },
  fbm: { octaves: 5, a0: 0, w0: 0.5, lacunarity: 2.03, gain: 0.5 },
  space: {
    base: 0.25, nXY: 2.4, nZ: 1.7, nT: 0.012, neb: 0.45, statements: 9,
    sXY: 520, sZ: 210, sPow: 28, gXZ: 110, gPow: 14,
    starK: 2.2, starAudio: 2.8, giantMix: 0.4, giantK: 0.9, giantAudio: 1,
  },
  dispatch: { fractalBelow: 1.5, spaceBelow: 2.5 },
  out: { cap: "capSkyLuma", col: "col", bright: "uBright", alpha: "uOpacity" },
  luma: { r: 0.2126, g: 0.7152, b: 0.0722, floor: 0.001, cap: 0.58 },
  frag: {
    topLevel: [
      "uniform float uTime", "uniform float uMode", "uniform float uOpacity", "uniform float uBright",
      "uniform float uAudio", "uniform vec3 uAccent", "uniform vec3 uBg", "uniform float uMotif", "uniform vec3 uA",
      "uniform vec3 uB", "uniform float uWarp", "uniform float uGrain", "uniform float uBands", "in vec3 vDir",
      "out vec4 fragColor", "float hash(float n)", "float hash2(vec2 p)", "float noise(vec2 p)", "float fbm(vec2 p)",
      "vec3 space(vec3 dir,float t)", "vec3 fractal(vec3 dir,float t)", "vec3 matrixRain(vec3 dir,float t)",
      "vec3 aurora(vec3 dir,float t)", "vec3 rainSky(vec3 dir,float t)", "vec3 oceanSky(vec3 dir,float t)",
      "vec3 fireSky(vec3 dir,float t)", "vec3 warpSky(vec3 dir,float t)", "vec3 cloudsSky(vec3 dir,float t)",
      "vec3 circuitSky(vec3 dir,float t)", "vec3 plasmaSky(vec3 dir,float t)", "vec3 latticeSky(vec3 dir,float t)",
      "vec3 duskSky(vec3 dir,float t)", "vec3 voidSky(vec3 dir,float t)", "vec3 vhsSky(vec3 dir,float t)",
      "vec3 nebulaSky(vec3 dir,float t)", "vec3 acidSky(vec3 dir,float t)", "vec3 iceSky(vec3 dir,float t)",
      "vec3 dawnSky(vec3 dir,float t)", "vec3 phosphorSky(vec3 dir,float t)", "vec3 dynamicSky(vec3 dir,float t)",
      "vec3 capSkyLumaTo(vec3 c,float cap)", "vec3 capSkyLuma(vec3 c)", "void main()",
    ],
    main: [
      "vec3 dir=normalize(vDir)", "float t=uTime", "vec3 col", "if(uMode<1.5)col=fractal(dir,t)",
      "else if(uMode<2.5)col=space(dir,t)", "else if(uMode<3.5)col=matrixRain(dir,t)",
      "else if(uMode<5.5)col=aurora(dir,t)", "else if(uMode<6.5)col=rainSky(dir,t)",
      "else if(uMode<7.5)col=oceanSky(dir,t)", "else if(uMode<8.5)col=fireSky(dir,t)",
      "else if(uMode<9.5)col=warpSky(dir,t)", "else if(uMode<10.5)col=cloudsSky(dir,t)",
      "else if(uMode<11.5)col=circuitSky(dir,t)", "else if(uMode<12.5)col=plasmaSky(dir,t)",
      "else if(uMode<13.5)col=latticeSky(dir,t)", "else if(uMode<14.5)col=dynamicSky(dir,t)",
      "else if(uMode<17.5)col=duskSky(dir,t)", "else if(uMode<18.5)col=voidSky(dir,t)",
      "else if(uMode<19.5)col=vhsSky(dir,t)", "else if(uMode<20.5)col=nebulaSky(dir,t)",
      "else if(uMode<21.5)col=acidSky(dir,t)", "else if(uMode<22.5)col=iceSky(dir,t)",
      "else if(uMode<23.5)col=dawnSky(dir,t)", "else if(uMode<24.5)col=phosphorSky(dir,t)",
      "else col=dynamicSky(dir,t)", "fragColor=vec4(capSkyLuma(col*uBright),uOpacity)",
    ],
  },
  vert: {
    topLevel: [
      "out vec3 vDir", "void main()",
    ],
    main: [
      "vDir=normalize(position)", "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0)",
    ],
  },
};
/** sha256 of the normalized GLSL the mirror copies (skyGlslPinSource): re-pin only together with a MIRROR update. */
const SKY_GLSL_PIN = "f848b0bae6edebda9cd7139c39e4dd71f53b15c10e018d7ca9355c589acfa31d";
const SKY_GLSL_FUNCTIONS = ["hash2", "noise", "fbm", "space", "capSkyLumaTo", "capSkyLuma"];

const NUM = "(-?[0-9]+(?:\\.[0-9]+)?)";
const INT = "([0-9]+)";
/** One GLSL function, signature to its matching close brace. */
function glslFunction(src: string, name: string): string {
  const head = new RegExp(`\\b(?:float|vec2|vec3|vec4|void)\\s+${name}\\s*\\(`).exec(src);
  if (!head) throw new Error(`backdrop sky GLSL: function ${name}() not found; update the TS copy (MIRROR) and re-pin SKY_GLSL_PIN`);
  const open = src.indexOf("{", head.index);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(head.index, i + 1);
  }
  throw new Error(`backdrop sky GLSL: function ${name}() has no closing brace`);
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
/** Whitespace collapsed, and dropped wherever it is not between two identifier characters. */
const squash = (src: string) => src.replace(/\s+/g, " ").replace(/ ?([^\w ]) ?/g, "$1").trim();
/** Comments stripped, whitespace collapsed. */
function normalizeGlsl(src: string): string {
  return squash(stripComments(src));
}
const isPreprocessor = (line: string) => line.trim().startsWith("#");
/** Top-level items in order: every preprocessor line (wherever it sits), each declaration, each function signature. */
function glslTopLevel(src: string): string[] {
  const lines = stripComments(src).split("\n");
  const items = lines.filter(isPreprocessor).map(squash);
  const code = lines.filter((l) => !isPreprocessor(l)).join("\n");
  let depth = 0, start = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") { if (depth === 0) items.push(squash(code.slice(start, i))); depth++; }
    else if (ch === "}") { if (--depth === 0) start = i + 1; }
    else if (ch === ";" && depth === 0) { items.push(squash(code.slice(start, i))); start = i + 1; }
  }
  const tail = squash(code.slice(start));
  if (tail) items.push(tail);
  return items;
}
/** Every main() statement, normalized. */
function glslMainStatements(src: string): string[] {
  const fn = normalizeGlsl(glslFunction(src, "main"));
  return fn.slice(fn.indexOf("{") + 1, fn.lastIndexOf("}")).split(";").filter((st) => st.length > 0);
}
/** The main() statements the space sky passes through: dir / t set-up, the space dispatch and the output line. */
function mainSpacePath(src: string): string[] {
  return normalizeGlsl(glslFunction(src, "main")).split(";").filter((s) => /vDir|uTime|fractal\(|space\(|fragColor/.test(s));
}
function skyGlslPinSource(frag: string, vert: string): string {
  return [
    ...SKY_GLSL_FUNCTIONS.map((f) => normalizeGlsl(glslFunction(frag, f))),
    "-- frag top level", ...glslTopLevel(frag), "-- frag main", ...glslMainStatements(frag),
    "-- vert top level", ...glslTopLevel(vert), "-- vert main", ...glslMainStatements(vert),
  ].join("\n");
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Every structural value the TS copy depends on, parsed out of the GLSL. Throws on a line it cannot read. */
function skyGlslShape(src: string, vert: string): SkyShape {
  const body = (name: string) => normalizeGlsl(glslFunction(src, name));
  const grab = (name: string, re: string, what: string): number[] => {
    const m = body(name).match(new RegExp(re));
    if (!m) throw new Error(`backdrop ${name}(): ${what} changed shape; update the TS copy (MIRROR) and re-pin SKY_GLSL_PIN`);
    return m.slice(1).map(Number);
  };
  const [kx, ky, k] = grab("hash2", `return fract\\(sin\\(dot\\(p,vec2\\(${NUM},${NUM}\\)\\)\\)\\*${NUM}\\);`, "hash");
  grab("noise", `vec2 i=floor\\(p\\),f=fract\\(p\\);`, "cell split");
  const [s3, s2] = grab("noise", `f=f\\*f\\*\\(${NUM}-${NUM}\\*f\\);`, "smoothstep");
  const ret = body("noise").match(/return mix\(mix\(hash2\(i\),hash2\(i\+vec2\(([^)]*)\)\),f\.x\),mix\(hash2\(i\+vec2\(([^)]*)\)\),hash2\(i\+vec2\(([^)]*)\)\),f\.x\),f\.y\);/);
  if (!ret) throw new Error("backdrop noise(): bilinear mix changed shape; update the TS copy (MIRROR) and re-pin SKY_GLSL_PIN");
  const corners = ret.slice(1).map((c): [number, number] => { const [a, b] = c.split(",").map(Number); return [a!, b!]; });
  const [a0, w0] = grab("fbm", `float a=${NUM},w=${NUM};`, "accumulators");
  const [octaves, lacunarity, gain] = grab("fbm", `for\\(int i=0;i<${INT};i\\+\\+\\)\\{a\\+=w\\*noise\\(p\\);p\\*=${NUM};w\\*=${NUM};\\}return a;`, "octave loop");
  const [base] = grab("space", `vec3 col=uBg\\*${NUM};`, "base");
  const [nXY, nZ, nT] = grab("space", `float n=fbm\\(dir\\.xy\\*${NUM}\\+dir\\.z\\*${NUM}\\+t\\*${NUM}\\);`, "nebula fbm");
  const [neb] = grab("space", `col\\+=uAccent\\*\\(n\\*n\\)\\*${NUM};`, "nebula");
  const [sXY, sZ] = grab("space", `float speckle=hash2\\(floor\\(dir\\.xy\\*${NUM}\\+dir\\.z\\*${NUM}\\)\\);`, "speckle");
  const [sPow] = grab("space", `float star=pow\\(speckle,${NUM}\\);`, "star");
  const [gXZ, gPow] = grab("space", `float giant=pow\\(hash2\\(floor\\(dir\\.xz\\*${NUM}\\)\\),${NUM}\\);`, "giant");
  const [starK, starAudio] = grab("space", `col\\+=vec3\\(1\\.0\\)\\*star\\*\\(${NUM}\\+uAudio\\*${NUM}\\);`, "star add");
  const [giantMix, giantK] = grab("space", `col\\+=mix\\(vec3\\(1\\.0\\),uAccent,${NUM}\\)\\*giant\\*\\(${NUM}\\+uAudio\\);`, "giant add");
  const statements = body("space").replace(/^[^{]*\{/, "").split(";").filter((s) => s.replace("}", "").trim()).length;
  const main = mainSpacePath(src).join(";");
  const fr = main.match(new RegExp(`if\\(uMode<${NUM}\\)col=fractal\\(dir,t\\)`));
  const sp = main.match(new RegExp(`else if\\(uMode<${NUM}\\)col=space\\(dir,t\\)`));
  const out = main.match(/fragColor=vec4\((\w+)\((\w+)\*(\w+)\),(\w+)\)/);
  if (!fr || !sp || !out) throw new Error("backdrop main(): space dispatch or output line changed shape; update the TS copy (MIRROR) and re-pin SKY_GLSL_PIN");
  const [r, g, b] = grab("capSkyLumaTo", `float y=dot\\(max\\(c,vec3\\(0\\.0\\)\\),vec3\\(${NUM},${NUM},${NUM}\\)\\);`, "luma weights");
  const [floor] = grab("capSkyLumaTo", `return y>cap&&cap>${NUM}\\?c\\*\\(cap/y\\):c;`, "cap scale");
  const [cap] = grab("capSkyLuma", `return capSkyLumaTo\\(c,${NUM}\\);`, "cap value");
  return {
    hash2: { kx: kx!, ky: ky!, k: k! },
    noise: { s3: s3!, s2: s2!, corners },
    fbm: { octaves: octaves!, a0: a0!, w0: w0!, lacunarity: lacunarity!, gain: gain! },
    space: {
      base: base!, nXY: nXY!, nZ: nZ!, nT: nT!, neb: neb!, statements,
      sXY: sXY!, sZ: sZ!, sPow: sPow!, gXZ: gXZ!, gPow: gPow!,
      starK: starK!, starAudio: starAudio!, giantMix: giantMix!, giantK: giantK!, giantAudio: 1,
    },
    dispatch: { fractalBelow: Number(fr[1]), spaceBelow: Number(sp[1]) },
    out: { cap: out[1]!, col: out[2]!, bright: out[3]!, alpha: out[4]! },
    luma: { r: r!, g: g!, b: b!, floor: floor!, cap: cap! },
    frag: { topLevel: glslTopLevel(src), main: glslMainStatements(src) },
    vert: { topLevel: glslTopLevel(vert), main: glslMainStatements(vert) },
  };
}
/** The shape the mirror evaluates with: parsed from the drawn GLSL, and only if it is exactly the TS copy's. */
function mirrorShape(frag: string, vert: string): SkyShape {
  const parsed = skyGlslShape(frag, vert);
  if (JSON.stringify(parsed) !== JSON.stringify(MIRROR)) {
    throw new Error(`backdrop sky GLSL no longer matches the TS copy: parsed ${JSON.stringify(parsed)} vs MIRROR ${JSON.stringify(MIRROR)}; update the TS copy and re-pin SKY_GLSL_PIN`);
  }
  return parsed;
}

const fract = (x: number) => x - Math.floor(x);
/** hash2 / noise / fbm as in the GLSL, every constant from the shape. */
function mirrorNoise(s: SkyShape): { hash2: (x: number, y: number) => number; fbm: (x: number, y: number) => number } {
  const { kx, ky, k } = s.hash2;
  const { s3, s2 } = s.noise;
  const [c1, c2, c3] = s.noise.corners;
  const { octaves, a0, w0, lacunarity, gain } = s.fbm;
  const hash2 = (x: number, y: number) => fract(Math.sin(x * kx + y * ky) * k);
  const m = (a: number, b: number, t: number) => a + (b - a) * t;
  const noise = (x: number, y: number): number => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (s3 - s2 * fx); fy = fy * fy * (s3 - s2 * fy);
    return m(m(hash2(ix, iy), hash2(ix + c1![0], iy + c1![1]), fx), m(hash2(ix + c2![0], iy + c2![1]), hash2(ix + c3![0], iy + c3![1]), fx), fy);
  };
  const fbm = (x: number, y: number): number => {
    let a = a0, w = w0;
    for (let i = 0; i < octaves; i++) { a += w * noise(x, y); x *= lacunarity; y *= lacunarity; w *= gain; }
    return a;
  };
  return { hash2, fbm };
}

/** What the sky material draws with, read back from the real LookStage frame. */
type Drawn = {
  uBright: number; uOpacity: number; uAudio: number; uMode: number; accent: number[]; bg: number[]; clear: number; frag: string; vert: string; radius: number; camera: THREE.PerspectiveCamera;
  blend: { transparent: boolean; blending: THREE.Blending; premultipliedAlpha: boolean; toneMapped: boolean };
};

describe("#195 sky mirror parity: the TS copy is pinned to backdrop.ts's shipped GLSL (BACKDROP_SKY_FRAG + pluginSkyVertGlsl)", () => {
  it("every structural value the TS copy uses (octave count, octave weight / frequency, hash, smoothstep, mix and speck coefficients, uBright use, luma weights, SKY_LUMA_CAP, every top-level item and main() statement of both shaders) equals the one parsed from the GLSL", () => {
    const parsed = skyGlslShape(BACKDROP_SKY_FRAG, pluginSkyVertGlsl);
    process.stdout.write(`[#195 parity] parsed ${JSON.stringify(parsed)}\n`);
    expect(parsed, "backdrop.ts sky GLSL vs the TS copy (MIRROR): update the TS copy (MIRROR + mirror functions in lan-pong-sky-contrast.test.ts) to match the GLSL, then re-pin SKY_GLSL_PIN").toEqual(MIRROR);
    expect(MIRROR.luma.cap, "TS copy's cap vs themes.ts SKY_LUMA_CAP").toBe(SKY_LUMA_CAP);
    expect(BACKDROP_SKY_FRAG.includes(SKY_LUMA_CAP_GLSL), "the sky GLSL embeds themes.ts SKY_LUMA_CAP_GLSL").toBe(true);
    expect(() => mirrorShape(BACKDROP_SKY_FRAG, pluginSkyVertGlsl), "the mirror accepts the shipped GLSL").not.toThrow();
  });

  it("normalized pin: hash2 / noise / fbm / space / capSkyLumaTo / capSkyLuma, both shaders' top-level items and main() statements, comments stripped and whitespace collapsed", () => {
    const src = skyGlslPinSource(BACKDROP_SKY_FRAG, pluginSkyVertGlsl);
    const hash = sha256(src);
    expect(hash, `backdrop.ts sky GLSL changed (sha256 ${hash}, pinned ${SKY_GLSL_PIN}): update the TS copy (MIRROR + mirror functions in lan-pong-sky-contrast.test.ts) to match, then re-pin SKY_GLSL_PIN. Normalized source now:\n${src}`).toBe(SKY_GLSL_PIN);
  });
});

describe("#195 lan-pong: every game piece >= 3:1 against its sky at full audio", () => {
  const hosts: HTMLElement[] = [];
  beforeEach(() => {
    expect.hasAssertions();
    rec.render.mockClear();
    rec.clear.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  function sized(w: number, h: number): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, get: () => w });
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => h });
    document.body.append(el);
    hosts.push(el);
    return el;
  }

  /** lan-pong's look on a NetScene at full audio, one arcade LookStage frame; skyBright overridable for the bisection. */
  function drawAtFullAudio(skyBright?: number): { drawn: Drawn; theme: Theme } {
    const graph = new NetScene(sized(W, H));
    const look = parseLook((parseYaml(readFileSync(YML, "utf8")) as { look?: unknown }).look);
    expect(look, "lan-pong visualisation.yml look").toBeTruthy();
    const anim = mergeLook(graph.dreamAnim, look);
    graph.setAnim(skyBright === undefined ? anim : { ...anim, skyBright });
    vi.spyOn(graph, "pulseNow", "get").mockReturnValue({ level: 1, bass: 1, listening: true, awaitingClick: false });
    const themeId = String(ymlLook().theme);
    const theme = themeById(themeId);
    expect(theme.id, "lan-pong's yml theme is a real theme").toBe(themeId);
    const stage = new LookStage(sized(W, H));
    rec.on = true;
    stage.attach();
    rec.on = false;
    rec.render.mockClear();
    rec.clear.mockClear();
    // past the sky's view morph (backdrop.ts VIEW_MORPH_S; tick dt is capped at 0.25 s), so uOpacity is the look's
    for (let i = 0; i <= 12; i++) stage.frame(graph, theme, 0.25, 5 + i * 0.25);
    process.stdout.write(`[#195 anim] theme ${theme.id} bgAudio ${graph.dreamAnim.bgAudio} bgOpacity ${graph.dreamAnim.bgOpacity} bgColor '${graph.dreamAnim.bgColor}' skyOpacity ${graph.dreamAnim.skyOpacity} skyBright ${graph.dreamAnim.skyBright}\n`);
    const call = rec.render.mock.calls.at(-1);
    const world = call?.[0], camera = call?.[1];
    if (!(world instanceof THREE.Scene) || !(camera instanceof THREE.PerspectiveCamera)) throw new Error("LookStage.frame did not render the world with its camera");
    const skies: THREE.Mesh[] = [];
    world.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible && o.material instanceof THREE.ShaderMaterial && o.material.fragmentShader.includes("vec3 space(")) skies.push(o);
    });
    const mesh = skies[0];
    if (!mesh || !(mesh.material instanceof THREE.ShaderMaterial) || !(mesh.geometry instanceof THREE.SphereGeometry)) throw new Error("no visible space-sky sphere in the LookStage world");
    const u = mesh.material.uniforms;
    const col = (v: unknown) => { if (!(v instanceof THREE.Color)) throw new Error("sky colour uniform is not a THREE.Color"); return [v.r, v.g, v.b]; };
    const clear = rec.clear.mock.calls.at(-1)?.[0];
    if (typeof clear !== "number") throw new Error("LookStage did not set a numeric clear colour");
    camera.updateMatrixWorld(true);
    stage.dispose();
    graph.dispose();
    return {
      theme,
      drawn: {
        uBright: Number(u.uBright?.value), uOpacity: Number(u.uOpacity?.value), uAudio: Number(u.uAudio?.value), uMode: Number(u.uMode?.value),
        accent: col(u.uAccent?.value), bg: col(u.uBg?.value), clear, frag: mesh.material.fragmentShader, vert: mesh.material.vertexShader, radius: mesh.geometry.parameters.radius, camera,
        blend: { transparent: mesh.material.transparent, blending: mesh.material.blending, premultipliedAlpha: mesh.material.premultipliedAlpha, toneMapped: mesh.material.toneMapped },
      },
    };
  }

  /** Sky direction (object space of the origin-centred dome) behind every sampled pixel. */
  function skyDirs(d: Drawn): Float64Array {
    const out = new Float64Array(Math.ceil(W / STRIDE) * Math.ceil(H / STRIDE) * 3);
    const cam = d.camera.position, p = new THREE.Vector3(), rd = new THREE.Vector3();
    let i = 0;
    for (let py = 0; py < H; py += STRIDE) for (let px = 0; px < W; px += STRIDE) {
      p.set(((px + 0.5) / W) * 2 - 1, 1 - ((py + 0.5) / H) * 2, 0.5).unproject(d.camera);
      rd.copy(p).sub(cam).normalize();
      const b = cam.dot(rd), c = cam.lengthSq() - d.radius * d.radius;
      const t = -b + Math.sqrt(b * b - c);
      p.copy(cam).addScaledVector(rd, t).normalize();
      out[i++] = p.x; out[i++] = p.y; out[i++] = p.z;
    }
    return out;
  }

  /**
   * The brightest sky pixel (WCAG luminance of its byte colour) over the tile at every sky time.
   * specks "excluded" zeroes the shader's star-speck terms (`star`, `giant`) and is what the rule
   * holds (#195 option (b)); "counted" keeps them, for the diagnostic line only.
   */
  function brightestSky(d: Drawn, dirs: Float64Array, specks: "counted" | "excluded"): { lum: number; hex: number; t: number } {
    const stars = specks === "counted";
    const s = mirrorShape(d.frag, d.vert);
    const { hash2, fbm } = mirrorNoise(s);
    const sp = s.space, lu = s.luma;
    const clearRgb = [(d.clear >> 16) & 255, (d.clear >> 8) & 255, d.clear & 255].map((v) => v / 255);
    let best = { lum: -1, hex: 0, t: 0 };
    const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (const t of SKY_TIMES) {
      for (let i = 0; i < dirs.length; i += 3) {
        const x = dirs[i]!, y = dirs[i + 1]!, z = dirs[i + 2]!;
        const n = fbm(x * sp.nXY + z * sp.nZ + t * sp.nT, y * sp.nXY + z * sp.nZ + t * sp.nT);
        const star = stars ? hash2(Math.floor(x * sp.sXY + z * sp.sZ), Math.floor(y * sp.sXY + z * sp.sZ)) ** sp.sPow : 0;
        const giant = stars ? hash2(Math.floor(x * sp.gXZ), Math.floor(z * sp.gXZ)) ** sp.gPow : 0;
        const c = [0, 1, 2].map((k) => (d.bg[k]! * sp.base + d.accent[k]! * n * n * sp.neb
          + star * (sp.starK + d.uAudio * sp.starAudio) + (1 + (d.accent[k]! - 1) * sp.giantMix) * giant * (sp.giantK + d.uAudio * sp.giantAudio)) * d.uBright);
        const yl = lu.r * Math.max(0, c[0]!) + lu.g * Math.max(0, c[1]!) + lu.b * Math.max(0, c[2]!);
        const k = yl > lu.cap && lu.cap > lu.floor ? lu.cap / yl : 1;
        const hex = (byte(Math.min(1, Math.max(0, c[0]! * k)) * d.uOpacity + clearRgb[0]! * (1 - d.uOpacity)) << 16)
          | (byte(Math.min(1, Math.max(0, c[1]! * k)) * d.uOpacity + clearRgb[1]! * (1 - d.uOpacity)) << 8)
          | byte(Math.min(1, Math.max(0, c[2]! * k)) * d.uOpacity + clearRgb[2]! * (1 - d.uOpacity));
        const lum = relativeLuminance(hex);
        if (lum > best.lum) best = { lum, hex, t };
      }
    }
    return best;
  }

  /** NetPong's pieces on lan-pong's default view (gateway source): pong.ts sourceColor / colorOf. */
  function pieces(theme: Theme): { name: string; hex: number }[] {
    const gw = theme.roles.gateway;
    const dots = [...new Set(IDLE_VIZ_DEMO_HOSTS.filter((h) => h.role !== "gateway").map((h) => hashColor(h.ip)))];
    return [
      { name: "paddle (gateway source colour)", hex: gw },
      { name: "ball (gateway source colour)", hex: gw },
      ...dots.map((hex) => ({ name: `packet dot #${hex.toString(16).padStart(6, "0")}`, hex })),
    ];
  }

  it("guard: lan-pong's visualisation.yml look is real (finite skyBright / skyOpacity, not the host default) and reaches the drawn space sky at full audio", () => {
    const yml = ymlLook();
    const probe = new NetScene(sized(W, H));
    const hostDefault = probe.dreamAnim.skyBright;
    probe.dispose();
    const why = `lan-pong visualisation.yml skyBright ${String(yml.skyBright)} skyOpacity ${String(yml.skyOpacity)}; host default skyBright ${hostDefault}`;
    expect(typeof yml.skyBright === "number" && Number.isFinite(yml.skyBright), `finite skyBright: ${why}`).toBe(true);
    expect(typeof yml.skyOpacity === "number" && Number.isFinite(yml.skyOpacity), `finite skyOpacity: ${why}`).toBe(true);
    expect(yml.skyBright, `not the host default: ${why}`).not.toBe(hostDefault);
    expect(yml.backdrop, why).toBe("space");
    const { drawn } = drawAtFullAudio();
    process.stdout.write(`[#195 drawn] uBright ${drawn.uBright.toFixed(4)} uOpacity ${drawn.uOpacity.toFixed(4)} uAudio ${drawn.uAudio} uMode ${drawn.uMode} clear #${drawn.clear.toString(16).padStart(6, "0")}\n`);
    expect(drawn.frag, "the drawn sky material ships backdrop.ts's BACKDROP_SKY_FRAG, the GLSL the TS copy is pinned to").toBe(BACKDROP_SKY_FRAG);
    expect(drawn.vert, "the drawn sky material's vertex shader is backdrop.ts's pluginSkyVertGlsl, the one the TS copy is pinned to").toBe(pluginSkyVertGlsl);
    // the mirror blends src * uOpacity + clear * (1 - uOpacity) with no tone mapping: the material must draw that way
    expect(drawn.blend, "sky material blend state the mirror assumes").toEqual({ transparent: true, blending: THREE.NormalBlending, premultipliedAlpha: false, toneMapped: false });
    expect(drawn.uMode, "space sky mode").toBe(2);
    expect(drawn.uMode >= MIRROR.dispatch.fractalBelow && drawn.uMode < MIRROR.dispatch.spaceBelow, `uMode ${drawn.uMode} takes main()'s space() branch`).toBe(true);
    expect(drawn.uAudio, "full audio reaches the sky").toBe(1);
    expect(drawn.uBright, `full-audio uBright is above the yml skyBright (the audio boost is on): ${why}`).toBeGreaterThan(Number(yml.skyBright));
  });

  it(`every piece (paddle, ball, packet dots) >= ${MIN_CONTRAST}:1 against the brightest sky pixel behind it at full audio (star specks excluded, #195 option (b)), and the yml skyBright is under the bisected limit`, () => {
    const { drawn, theme } = drawAtFullAudio();
    const dirs = skyDirs(drawn);
    // #195 option (b) (UX Pro): star specks left out of the rule, zeroed by the shader's star terms
    const sky = brightestSky(drawn, dirs, "excluded");
    const withSpecks = brightestSky(drawn, dirs, "counted");
    const ps = pieces(theme);
    const skyBright = Number(ymlLook().skyBright);
    // limit: the brightest skyBright (yml units) at which every piece clears the speck-free sky, bisected on the real path + mirror
    const clears = (sb: number) => {
      const s = brightestSky(drawAtFullAudio(sb).drawn, dirs, "excluded");
      return ps.every((p) => contrastRatio(p.hex, s.hex) >= MIN_CONTRAST);
    };
    let lo = 0, hi = 2;
    expect(clears(hi), "bisection ceiling must not clear").toBe(false);
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (clears(mid)) lo = mid; else hi = mid; }
    const atLimit = drawAtFullAudio(lo).drawn;
    const limitSky = brightestSky(atLimit, dirs, "excluded");
    process.stdout.write(`[#195 sky] skyBright ${skyBright} -> full-audio uBright ${drawn.uBright.toFixed(4)}: brightest speck-free sky L ${sky.lum.toFixed(4)} (#${sky.hex.toString(16).padStart(6, "0")} t=${sky.t}); with star specks (not held) L ${withSpecks.lum.toFixed(4)}\n`);
    process.stdout.write(`[#195 limit] brightest clearing skyBright ${lo.toFixed(4)} (uBright ${atLimit.uBright.toFixed(4)}): brightest speck-free sky L ${limitSky.lum.toFixed(4)}\n`);
    for (const p of ps) {
      process.stdout.write(`[#195 piece] ${p.name} L ${relativeLuminance(p.hex).toFixed(4)}: contrast ${contrastRatio(p.hex, sky.hex).toFixed(2)} (vs specks, not held: ${contrastRatio(p.hex, withSpecks.hex).toFixed(2)})\n`);
    }
    // soft, so a failing run names every piece under 3:1, not just the first
    for (const p of ps) {
      const c = contrastRatio(p.hex, sky.hex);
      expect.soft(c, `${p.name} vs brightest speck-free sky pixel L ${sky.lum.toFixed(4)} at full audio (skyBright ${skyBright}, uBright ${drawn.uBright.toFixed(4)}; limit skyBright ${lo.toFixed(4)}): contrast ${c.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(skyBright, `yml skyBright vs bisected limit ${lo.toFixed(4)}`).toBeLessThanOrEqual(lo);
  }, 600_000);
});
