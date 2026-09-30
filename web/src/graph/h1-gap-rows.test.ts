/**
 * H1 (tse/h1-tile-health @ d5dfc094) gap rows QE asked for. Each row goes red when its piece of H1
 * is reverted or disabled:
 *
 * 1. `NetScene.tileHealthSkyRgba` (scene.ts): a REAL NetScene on a stub GPU (a WebGLRenderer-shaped
 *    renderer plus a WebGL2 stub whose PBO read hands back what the stub "drew") renders the pack sky
 *    into the confirm target and returns those bytes; the TileHealthMonitor's confirm step then reads
 *    them (no mocked tileHealthSkyRgba). Revert: return null -> the direct row gets null, and the
 *    monitor's five-patch "uniform" verdict stands, so a drawing nixie-clock gets the live-blank notice.
 * 2. `Backdrop.probeResolution` (backdrop.ts): while the confirm render runs, the pack sky's
 *    uResolution is the probe size (TILE_SKY_CONFIRM_PX²), and afterwards it is the tile's buffer
 *    size again. Revert: an empty body -> the "during" assertion reads the tile size, and a
 *    gl_FragCoord / uResolution sky reads flat over the confirm target.
 * 3. `Backdrop.ensurePluginMat` same fragment, different id: the reused material is reset for the second
 *    pack, from the bind on (none of the first pack's writes survive, and its own write is a fresh
 *    factor on the host's). Revert: drop the `this.pluginId !== id` branch -> pack-b inherits pack-a's
 *    uTime / uBright / uOpacity / uAudio / uAccent. On d5dfc094 that branch only cleared the factors,
 *    so the reused material held pack-a's values until the next host frame; ge/h1-rows also re-syncs
 *    the host look there (the "right after the bind" assertion).
 *
 * Unit rows: happy-dom, no GPU, counts and values only (no timing).
 */
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Backdrop } from "./backdrop";
import { NetScene } from "./scene";
import type { RenderHost } from "./render-host";
import { TileHealthMonitor, type TileHealthDeps } from "../plugins/tile-health-monitor";
import { TILE_SKY_CONFIRM_PX, patchesAreNearUniform, skyReadIsFlat, type TilePatchBytes } from "../plugins/tile-health";
import { NIXIE_FIVE_PATCH } from "../plugins/fixtures/tile-health-shots-180";
import type { PluginView } from "../plugins/plugin";

/**
 * A resolution-driven pack sky (the fluid-dyn shape): p = gl_FragCoord / uResolution, dark on the left
 * half of the tile and lit on the right. Only when uResolution matches the target being drawn does
 * p span [0, 1] and the lit half appear.
 */
const HALF_FRAG = `
void main() {
  vec2 p = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  fragColor = vec4(vec3(step(0.5, p.x)) * uBright, uOpacity);
}
`;

/** JS port of HALF_FRAG for the stub GPU: one RGBA byte quad per pixel of a w×h target. */
function drawHalf(w: number, h: number, res: THREE.Vector2): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const v = (i + 0.5) / Math.max(res.x, 1) >= 0.5 ? 255 : 0;
    const o = (j * w + i) * 4;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}

type Draw = { target: THREE.WebGLRenderTarget | null; object: THREE.Object3D; res: [number, number] | null; bytes: Uint8Array };

/**
 * Stub GPU: a renderer that passes `instanceof THREE.WebGLRenderer` and "draws" the pack sky with
 * {@link drawHalf} at the uniforms it holds at draw time, and a WebGL2 context whose async PBO read
 * (readPixels -> fenceSync -> clientWaitSync -> getBufferSubData) returns the last drawn target.
 */
function stubGpu() {
  const draws: Draw[] = [];
  let bound: THREE.WebGLRenderTarget | null = null;
  const renderer = Object.create(THREE.WebGLRenderer.prototype) as THREE.WebGLRenderer;
  Object.assign(renderer, {
    getRenderTarget: () => bound,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { bound = t; },
    clear: () => {},
    render: (object: THREE.Object3D) => {
      const mat = (object as THREE.Mesh).material as THREE.ShaderMaterial;
      const v = mat.uniforms?.uResolution?.value as THREE.Vector2 | undefined;
      const w = bound?.width ?? 1, h = bound?.height ?? 1;
      draws.push({ target: bound, object, res: v ? [v.x, v.y] : null, bytes: v ? drawHalf(w, h, v) : new Uint8Array(w * h * 4) });
    },
  });
  let packed: Uint8Array | null = null;
  const calls = { readPixels: 0, getBufferSubData: 0 };
  const gl = {
    PIXEL_PACK_BUFFER: 0x88eb, STREAM_READ: 0x88e1, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911a, TIMEOUT_EXPIRED: 0x911b,
    CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
    drawingBufferWidth: 1280, drawingBufferHeight: 800,
    isContextLost: () => false,
    createBuffer: () => ({}),
    deleteBuffer: () => {},
    bindBuffer: () => {},
    bufferData: () => {},
    flush: () => {},
    readPixels: () => { calls.readPixels++; packed = draws[draws.length - 1]?.bytes ?? null; },
    fenceSync: () => ({}),
    clientWaitSync: () => 0x911a,
    deleteSync: () => {},
    getBufferSubData: (_t: number, _o: number, dst: Uint8Array) => { calls.getBufferSubData++; if (packed) dst.set(packed.subarray(0, dst.length)); },
  } as unknown as WebGL2RenderingContext;
  return { renderer, gl, draws, calls };
}

type SceneBits = { backdrop: Backdrop; resize(): void };

const hosts: HTMLElement[] = [];
/** Scenes on the stub GPU: the real renderer goes back before dispose, so their own frame loop never draws on the stub. */
const scenes: Array<{ scene: NetScene; renderer: unknown }> = [];

/** A real NetScene with HALF_FRAG bound as its pack sky, drawing through the stub GPU. */
function mountScene(gpu: ReturnType<typeof stubGpu>) {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 400 });
  document.body.append(el);
  hosts.push(el);
  const scene = new NetScene(el);
  scene.setActive(false);
  const s = scene as unknown as SceneBits;
  s.resize();
  scenes.push({ scene, renderer: scene.renderer });
  Object.defineProperty(scene, "renderer", { configurable: true, value: gpu.renderer });
  s.backdrop.setKind("plugin");
  expect(s.backdrop.setPluginShader({ id: "fluid-shape", source: HALF_FRAG }, () => null)).toBeNull();
  expect(s.backdrop.pluginSkyId()).toBe("fluid-shape");
  const res = () => {
    const v = (s.backdrop.mesh.material as THREE.ShaderMaterial).uniforms.uResolution!.value as THREE.Vector2;
    return [v.x, v.y];
  };
  return { scene, backdrop: s.backdrop, res };
}

beforeEach(() => {
  expect.hasAssertions();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const { scene, renderer } of scenes) {
    Object.defineProperty(scene, "renderer", { configurable: true, value: renderer });
    scene.dispose();
  }
  scenes.length = 0;
  for (const h of hosts) h.remove();
  hosts.length = 0;
});

describe("H1 gap 1: NetScene.tileHealthSkyRgba renders the tile's pack sky and returns real bytes", () => {
  it("a real NetScene on a stub GPU: 'pending' first, then the bytes its confirm render drew (the sky alone)", () => {
    const gpu = stubGpu();
    const { scene, backdrop } = mountScene(gpu);
    const first = scene.tileHealthSkyRgba(gpu.gl);
    expect(first, "the first call queues the async read").toBe("pending");
    expect(gpu.draws.length, "one confirm render").toBe(1);
    const d = gpu.draws[0]!;
    expect(d.object, "the sky mesh alone (no floor grid, graph or labels)").toBe(backdrop.mesh);
    expect([d.target?.width, d.target?.height], "into the confirm target").toEqual([TILE_SKY_CONFIRM_PX, TILE_SKY_CONFIRM_PX]);
    const read = scene.tileHealthSkyRgba(gpu.gl);
    expect(read, "the harvested read").toBeInstanceOf(Uint8Array);
    const bytes = read as Uint8Array;
    expect(bytes.length).toBe(TILE_SKY_CONFIRM_PX * TILE_SKY_CONFIRM_PX * 4);
    expect(Array.from(bytes), "exactly what the confirm render drew").toEqual(Array.from(d.bytes));
    expect(gpu.calls.getBufferSubData, "read back through the PBO").toBe(1);
    expect(skyReadIsFlat(bytes), "the half-lit sky is not flat").toBe(false);
  });

  it("through the TileHealthMonitor: a drawing pack whose five patches read uniform is confirmed by the real read, never flagged", () => {
    const gpu = stubGpu();
    const { scene } = mountScene(gpu);
    const five = Uint8Array.from(Buffer.from(NIXIE_FIVE_PATCH, "base64"));
    expect(patchesAreNearUniform(five), "PA's nixie frame: five patches on dark wood").toBe(true);
    const confirmReads: Array<Uint8Array | "pending" | null> = [];
    const real = scene.tileHealthSkyRgba.bind(scene);
    vi.spyOn(scene, "tileHealthSkyRgba").mockImplementation((gl, ms) => { const r = real(gl, ms); confirmReads.push(r); return r; });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const blanks: string[] = [];
    const heals: string[] = [];
    const deps: TileHealthDeps = {
      host: { software: false, gl: gpu.gl, canvas: document.createElement("canvas"), pixelRatio: 1 } as unknown as RenderHost,
      mainScene: scene,
      mosaic: null,
      paneEl: () => scene.viewEl,
      sceneFor: () => scene,
      packFor: () => ({ id: "fluid-shape", capabilities: ["viz.read", "viz.write"] } as PluginView),
      mayBeStatic: () => false,
      awaitingApproval: () => false,
      isVisible: () => true,
      showErrors: () => false,
      tabVisible: () => true,
      onScreen: () => true,
      onHeal: (id, step) => { heals.push(`${id}:${step}`); },
      onLiveBlank: (id, p, on) => { blanks.push(`${id}:${p}:${on}`); },
      packLive: () => true,
    };
    const mon = new TileHealthMonitor(deps);
    // The five-patch read is the other half of the check (tile-health-confirm-180.test.ts); only the
    // confirm is under test here, and it runs for real.
    (mon as unknown as { sampleScene: () => TilePatchBytes }).sampleScene = () => five;
    for (let t = 0; t < 60_000; t += 700) {
      mon.noteSandboxWrite();
      mon.noteVizFrameDelivered();
      mon.tick(t);
    }
    info.mockRestore();
    const got = confirmReads.filter((r): r is Uint8Array => r instanceof Uint8Array);
    expect(got.length, "the confirm step read real bytes").toBeGreaterThan(0);
    expect(got.every((b) => !skyReadIsFlat(b)), "and they are the drawn (non-flat) sky").toBe(true);
    expect(blanks, "no live-blank notice").toEqual([]);
    expect(heals, "no heal").toEqual([]);
  });
});

describe("H1 gap 2: Backdrop.probeResolution sizes the pack sky to the confirm target, then restores it", () => {
  it("uResolution is TILE_SKY_CONFIRM_PX² while the confirm render runs, and the tile's size after", () => {
    const gpu = stubGpu();
    const { scene, res } = mountScene(gpu);
    const tile = res();
    expect(tile, "precondition: the tile's buffer size is not the probe size").not.toEqual([TILE_SKY_CONFIRM_PX, TILE_SKY_CONFIRM_PX]);
    expect(scene.tileHealthSkyRgba(gpu.gl)).toBe("pending");
    expect(gpu.draws.length).toBe(1);
    expect(gpu.draws[0]!.res, "during the confirm render").toEqual([TILE_SKY_CONFIRM_PX, TILE_SKY_CONFIRM_PX]);
    expect(res(), "after it").toEqual(tile);
    const read = scene.tileHealthSkyRgba(gpu.gl);
    expect(read).toBeInstanceOf(Uint8Array);
    expect(skyReadIsFlat(read as Uint8Array), "a gl_FragCoord / uResolution sky covers the whole confirm target").toBe(false);
    expect(res(), "still the tile's size after the harvest").toEqual(tile);
  });
});

describe("H1 gap 3: ensurePluginMat, same fragment under a different pack id", () => {
  const FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(mix(uBg, uAccent, 0.5 + 0.5 * dir.y) * uBright * (0.5 + 0.5 * sin(uTime + uAudio)), uOpacity);
}
`;
  type Host = { mat: THREE.ShaderMaterial };
  const u = (sky: Backdrop) => (sky.mesh.material as THREE.ShaderMaterial).uniforms;
  const hostU = (sky: Backdrop) => (sky as unknown as Host).mat.uniforms;
  const rgb = (c: unknown) => { const k = c as THREE.Color; return [k.r, k.g, k.b].map((v) => Math.round(v * 1000) / 1000); };
  function hostFrame(sky: Backdrop, t: number): void {
    sky.setLook(0.9, 1.2, 0.7);
    sky.setColors(0x3366cc, 0x101820);
    sky.tick(t);
  }

  it("pack-b bound with pack-a's exact fragment starts clean: none of pack-a's writes survive, its own write is a fresh factor", () => {
    const sky = new Backdrop();
    sky.setViewport(640, 360, 1);
    sky.setKind("plugin");
    expect(sky.setPluginShader({ id: "pack-a", source: FRAG }, () => null)).toBeNull();
    hostFrame(sky, 1);
    sky.setPluginUniform("uTime", 0);
    sky.setPluginUniform("uAudio", 0.1);
    sky.setPluginUniform("uBright", 0.25);
    sky.setPluginUniform("uOpacity", 0.5);
    sky.setPluginUniform("uAccent", [1, 0, 0]);
    hostFrame(sky, 2);
    expect(u(sky).uTime.value, "precondition: pack-a's writes hold on its own sky").toBe(0);
    expect(u(sky).uBright.value as number).toBeCloseTo((hostU(sky).uBright.value as number) * 0.25, 9);

    expect(sky.setPluginShader({ id: "pack-b", source: FRAG }, () => null), "same source, different id").toBeNull();
    expect(sky.pluginSkyId()).toBe("pack-b");
    const clean = (when: string) => {
      const p = u(sky);
      const h = hostU(sky);
      for (const k of ["uTime", "uAudio", "uBright", "uOpacity"] as const) expect(p[k].value, `${when}: pack-b ${k} is the host's`).toBe(h[k].value);
      expect(rgb(p.uAccent.value), `${when}: pack-b uAccent is the host's`).toEqual(rgb(h.uAccent.value));
      expect(rgb(p.uBg.value), `${when}: pack-b uBg is the host's`).toEqual(rgb(h.uBg.value));
    };
    // What a newly built material would hold (the host's values), from the moment pack-b is bound.
    clean("right after the bind");
    hostFrame(sky, 3);
    clean("after a host frame");

    sky.setPluginUniform("uBright", 0.5);
    hostFrame(sky, 4);
    expect(u(sky).uBright.value as number, "pack-b's own uBright: host x 0.5").toBeCloseTo((hostU(sky).uBright.value as number) * 0.5, 9);
    expect(u(sky).uOpacity.value, "pack-b never wrote uOpacity").toBe(hostU(sky).uOpacity.value);
  });
});
