/** @vitest-environment happy-dom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { hashColor } from "../core/modes";
import { contrastRatio, relativeLuminance, themeById, type Theme } from "../core/themes";
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
 * The sky pixel is a CPU mirror of the drawn fragment (backdrop.ts FRAG space() + capSkyLuma),
 * with every coefficient read from the material's own fragmentShader each run (spaceShape), so a
 * shader edit changes the mirror or throws. Approximations vs the GPU: float64 instead of float32
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

/** The space() body, coefficient by coefficient, from the drawn fragment shader. */
type SpaceShape = {
  base: number; nXY: number; nZ: number; nT: number; neb: number;
  sXY: number; sZ: number; sPow: number; gXZ: number; gPow: number;
  starK: number; starAudio: number; giantMix: number; giantK: number; cap: number;
};
const NUM = "([0-9]+(?:\\.[0-9]+)?)";
function spaceShape(frag: string): SpaceShape {
  const body = frag.match(/vec3 space\(vec3 dir, float t\) \{([\s\S]*?)\n\}/)?.[1];
  if (!body) throw new Error("backdrop FRAG: `vec3 space(vec3 dir, float t)` not found; update the CPU mirror");
  const grab = (re: string, what: string): number[] => {
    const m = body.match(new RegExp(re));
    if (!m) throw new Error(`backdrop space(): ${what} line changed; update the CPU mirror`);
    return m.slice(1).map(Number);
  };
  const [base] = grab(`vec3 col = uBg \\* ${NUM};`, "base");
  const [nXY, nZ, nT] = grab(`float n = fbm\\(dir\\.xy \\* ${NUM} \\+ dir\\.z \\* ${NUM} \\+ t \\* ${NUM}\\);`, "nebula fbm");
  const [neb] = grab(`col \\+= uAccent \\* \\(n \\* n\\) \\* ${NUM};`, "nebula");
  const [sXY, sZ] = grab(`float speckle = hash2\\(floor\\(dir\\.xy \\* ${NUM} \\+ dir\\.z \\* ${NUM}\\)\\);`, "speckle");
  const [sPow] = grab(`float star = pow\\(speckle, ${NUM}\\);`, "star");
  const [gXZ, gPow] = grab(`float giant = pow\\(hash2\\(floor\\(dir\\.xz \\* ${NUM}\\)\\), ${NUM}\\);`, "giant");
  const [starK, starAudio] = grab(`col \\+= vec3\\(1\\.0\\) \\* star \\* \\(${NUM} \\+ uAudio \\* ${NUM}\\);`, "star add");
  const [giantMix, giantK] = grab(`col \\+= mix\\(vec3\\(1\\.0\\), uAccent, ${NUM}\\) \\* giant \\* \\(${NUM} \\+ uAudio\\);`, "giant add");
  if (body.split(";").filter((s) => s.trim()).length !== 9) throw new Error("backdrop space(): statement count changed; update the CPU mirror");
  if (!/else if \(uMode < 2\.5\) col = space\(dir, t\);/.test(frag)) throw new Error("backdrop FRAG: space() mode dispatch changed");
  if (!/fragColor = vec4\(capSkyLuma\(col \* uBright\), uOpacity\);/.test(frag)) throw new Error("backdrop FRAG: output line changed");
  const capM = frag.match(new RegExp(`return capSkyLumaTo\\(c, ${NUM}\\);`));
  if (!capM) throw new Error("backdrop FRAG: capSkyLuma cap not found");
  return { base: base!, nXY: nXY!, nZ: nZ!, nT: nT!, neb: neb!, sXY: sXY!, sZ: sZ!, sPow: sPow!, gXZ: gXZ!, gPow: gPow!, starK: starK!, starAudio: starAudio!, giantMix: giantMix!, giantK: giantK!, cap: Number(capM[1]) };
}

const fract = (x: number) => x - Math.floor(x);
const hash2 = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const m = (a: number, b: number, t: number) => a + (b - a) * t;
  return m(m(hash2(ix, iy), hash2(ix + 1, iy), fx), m(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), fx), fy);
}
function fbm(x: number, y: number): number {
  let a = 0, w = 0.5;
  for (let i = 0; i < 5; i++) { a += w * noise(x, y); x *= 2.03; y *= 2.03; w *= 0.5; }
  return a;
}

/** What the sky material draws with, read back from the real LookStage frame. */
type Drawn = { uBright: number; uOpacity: number; uAudio: number; uMode: number; accent: number[]; bg: number[]; clear: number; frag: string; radius: number; camera: THREE.PerspectiveCamera };

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
        accent: col(u.uAccent?.value), bg: col(u.uBg?.value), clear, frag: mesh.material.fragmentShader, radius: mesh.geometry.parameters.radius, camera,
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
    const s = spaceShape(d.frag);
    const clearRgb = [(d.clear >> 16) & 255, (d.clear >> 8) & 255, d.clear & 255].map((v) => v / 255);
    let best = { lum: -1, hex: 0, t: 0 };
    const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (const t of SKY_TIMES) {
      for (let i = 0; i < dirs.length; i += 3) {
        const x = dirs[i]!, y = dirs[i + 1]!, z = dirs[i + 2]!;
        const n = fbm(x * s.nXY + z * s.nZ + t * s.nT, y * s.nXY + z * s.nZ + t * s.nT);
        const star = stars ? hash2(Math.floor(x * s.sXY + z * s.sZ), Math.floor(y * s.sXY + z * s.sZ)) ** s.sPow : 0;
        const giant = stars ? hash2(Math.floor(x * s.gXZ), Math.floor(z * s.gXZ)) ** s.gPow : 0;
        const c = [0, 1, 2].map((k) => (d.bg[k]! * s.base + d.accent[k]! * n * n * s.neb
          + star * (s.starK + d.uAudio * s.starAudio) + (1 + (d.accent[k]! - 1) * s.giantMix) * giant * (s.giantK + d.uAudio)) * d.uBright);
        const yl = 0.2126 * Math.max(0, c[0]!) + 0.7152 * Math.max(0, c[1]!) + 0.0722 * Math.max(0, c[2]!);
        const k = yl > s.cap && s.cap > 0.001 ? s.cap / yl : 1;
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
    expect(drawn.uMode, "space sky mode").toBe(2);
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
