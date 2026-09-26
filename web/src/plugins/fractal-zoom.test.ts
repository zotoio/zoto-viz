import { describe, expect, it, beforeEach } from "vitest";
import FRAG from "../../../plugins/src/fractal-zoom/sky/fragment.glsl?raw";
import FRONT from "../../../plugins/src/fractal-zoom/frontend/index.ts?raw";
import DRIVE from "../../../plugins/src/fractal-zoom/frontend/drive.ts?raw";
import VIS from "../../../plugins/src/fractal-zoom/visualisation.yml?raw";
import PLUGIN from "../../../plugins/src/fractal-zoom/plugin.yml?raw";
import {
  FZ_SLOT,
  FZ_SLOT0_FLOATS,
  FRACTAL_ITER_CEIL,
  FRACTAL_STEPS_CEIL,
  fractalHudCaption,
  fractalDrive,
  fractalRenderScale,
  packFractalDrive,
  resetFractalDrive,
} from "../../../plugins/src/fractal-zoom/frontend/drive";
import {
  FRACTAL_DEFAULTS,
  FRACTAL_PRESETS,
  parseFractalOptions,
  randomiseFractalOptions,
} from "../../../plugins/src/fractal-zoom/frontend/options";
import {
  FRACTAL_CONFIG_KEYS,
  fractalPresetConfig,
  fractalRandomConfig,
  validatePresetConfigsAgainstSchema,
  validatePresetKeysAgainstSchema,
} from "../../../plugins/src/fractal-zoom/frontend/config-mutation";
import {
  attachFractalInteraction,
  disposeFractalInteraction,
  fractalPointerState,
  IDLE_POINTER,
  resetFractalPointer,
} from "../../../plugins/src/fractal-zoom/frontend/interaction";
import { probePluginSkyCompile, wrapPluginSky } from "../graph/backdrop";
import { PluginSandbox } from "./host";
import { VizBufferWriter, parseVizContract, VIZ_UBO, type VizDataFrame } from "./viz-host";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

const FRACTAL_VIZ_CONTRACT = parseVizContract({
  graphWalk: false,
  maxBuffers: 1,
  maxBufferFloats: 64,
  maxParticles: 0,
  uniforms: ["uTime", "uBright", "uAudio", "uAccent", "uBg", "uOpacity"],
  idle: { fixture: "host" },
})!;

const SMOKE_VERT = `#version 300 es
out vec3 vDir;
void main() {
  vec2 uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vec2 pos = uv * 2.0 - 1.0;
  vDir = normalize(vec3(pos, -1.0));
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

function fractalPackSlot0(frame: VizDataFrame, opts: Record<string, string> = {}): number[] {
  const dt = frame.dt > 0 ? Math.min(0.1, frame.dt) : 1 / 60;
  const drive = packFractalDrive(frame.t, dt, frame.audio, 16 / 10, opts, IDLE_POINTER);
  return [...drive.slot0];
}

function lum(rgba: [number, number, number, number]): number {
  return rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
}

function isNearBlack(rgba: [number, number, number, number]): boolean {
  const l = lum(rgba);
  return l < 12 && rgba[0] < 15 && rgba[1] < 15 && rgba[2] < 25;
}

function isSolidFlat(center: [number, number, number, number], side: [number, number, number, number]): boolean {
  const d = Math.abs(lum(center) - lum(side));
  return d < 1.5 && Math.abs(center[0] - side[0]) < 2 && Math.abs(center[1] - side[1]) < 2 && Math.abs(center[2] - side[2]) < 2;
}

function smokeFractalConfig(
  cfg: Record<string, string>,
  t = 0.5,
): {
  ok: boolean;
  skipped: boolean;
  compileError: string | null;
  rgba: [number, number, number, number] | null;
  side: [number, number, number, number] | null;
} {
  if (typeof document === "undefined") {
    return { ok: false, skipped: true, compileError: "no document", rgba: null, side: null };
  }
  const wrapped = wrapPluginSky(FRAG);
  if ("error" in wrapped) {
    return { ok: false, skipped: false, compileError: wrapped.error, rgba: null, side: null };
  }
  const w = 320;
  const h = 200;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
  if (!gl) {
    return { ok: false, skipped: true, compileError: null, rgba: null, side: null };
  }
  const compile = (type: number, src: string): WebGLShader | string => {
    const sh = gl.createShader(type);
    if (!sh) return "no shader";
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      return (gl.getShaderInfoLog(sh) || "compile failed").trim();
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, SMOKE_VERT);
  if (typeof vs === "string") return { ok: false, skipped: false, compileError: vs, rgba: null, side: null };
  const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${wrapped.frag}`);
  if (typeof fs === "string") return { ok: false, skipped: false, compileError: fs, rgba: null, side: null };
  const prog = gl.createProgram();
  if (!prog) return { ok: false, skipped: false, compileError: "no program", rgba: null, side: null };
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return {
      ok: false,
      skipped: false,
      compileError: (gl.getProgramInfoLog(prog) || "link failed").trim(),
      rgba: null,
      side: null,
    };
  }
  resetFractalDrive();
  const drive = packFractalDrive(t, 1 / 60, 0.1, w / h, cfg, IDLE_POINTER);
  const slotVec4 = new Float32Array(VIZ_UBO.totalVec4s * 4);
  for (let i = 0; i < drive.slot0.length; i++) slotVec4[i] = drive.slot0[i] ?? 0;
  gl.useProgram(prog);
  const slotsLoc = gl.getUniformLocation(prog, `${VIZ_UBO.threeUniform}[0]`)
    ?? gl.getUniformLocation(prog, VIZ_UBO.threeUniform);
  gl.uniform4fv(slotsLoc, slotVec4);
  gl.uniform1f(gl.getUniformLocation(prog, "uTime"), t);
  gl.uniform1f(gl.getUniformLocation(prog, "uOpacity"), 1);
  gl.uniform1f(gl.getUniformLocation(prog, "uBright"), drive.bright);
  gl.uniform1f(gl.getUniformLocation(prog, "uAudio"), 0.1);
  gl.uniform3f(gl.getUniformLocation(prog, "uAccent"), drive.accent[0], drive.accent[1], drive.accent[2]);
  gl.uniform3f(gl.getUniformLocation(prog, "uBg"), drive.bg[0], drive.bg[1], drive.bg[2]);
  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  const px = new Uint8Array(4);
  const sidePx = new Uint8Array(4);
  gl.readPixels(w / 2, h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.readPixels(Math.floor(w * 0.78), h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sidePx);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const rgba: [number, number, number, number] = [px[0]!, px[1]!, px[2]!, px[3]!];
  const side: [number, number, number, number] = [sidePx[0]!, sidePx[1]!, sidePx[2]!, sidePx[3]!];
  const ok = !isNearBlack(rgba) && !isSolidFlat(rgba, side);
  return { ok, skipped: false, compileError: null, rgba, side };
}

function assertSmokeHealthy(smoke: ReturnType<typeof smokeFractalConfig>, label: string): void {
  if (smoke.skipped) return;
  expect(smoke.compileError, `${label} compile`).toBeNull();
  expect(smoke.ok, `${label} rgba=${smoke.rgba?.join(",")} side=${smoke.side?.join(",")}`).toBe(true);
}

function assertZoomAdvances(cfg: Record<string, string>, label: string): void {
  const opts = parseFractalOptions(cfg);
  if (opts.paused || opts.zoomSpeed <= 0) return;
  resetFractalDrive();
  const a = packFractalDrive(0, 1 / 60, 0, 1.6, cfg, IDLE_POINTER);
  const b = packFractalDrive(0.4, 1 / 60, 0, 1.6, cfg, IDLE_POINTER);
  expect(b.slot0[FZ_SLOT.zoomLog]!, `${label} stalled zoom`).toBeGreaterThan(a.slot0[FZ_SLOT.zoomLog]!);
}

describe("fractal-zoom shipped pack", () => {
  beforeEach(() => {
    resetFractalDrive();
    resetFractalPointer();
  });

  it("wraps and compiles the fractal sky (no WebGL errors)", () => {
    const wrapped = wrapPluginSky(FRAG);
    expect("error" in wrapped).toBe(false);
    if ("error" in wrapped) return;
    expect(wrapped.frag).toContain("zotoVizSlots");
    expect(FRAG).toContain("mandelbulb");
    expect(probePluginSkyCompile(wrapped.frag)).toBeNull();
  });

  it("declares config schema in plugin.yml with config.read (not visualisation.yml)", () => {
    expect(PLUGIN).toContain("config.read");
    expect(PLUGIN).toContain("key: fractalType");
    expect(PLUGIN).toContain("key: preset");
    expect(PLUGIN).toContain("section: Presets");
    expect(PLUGIN).toMatch(/max:\s*32/);
    expect(PLUGIN).toMatch(/max:\s*48/);
    expect(VIS).not.toContain("key: fractalType");
    expect(VIS).toContain("stageOnly: true");
    expect(VIS).toContain("fixture: host");
  });

  it("iframe driver owns viz.write via config.read", () => {
    expect(FRONT).toContain("getConfig");
    expect(FRONT).toContain("writeBuffer");
    expect(FRONT).toContain("onFrame");
    expect(FRONT.match(/zoto\.onFrame\s*=/g)?.length).toBe(1);
  });

  it("parses defaults, presets, and reduced motion", () => {
    const def = parseFractalOptions({});
    expect(def.type).toBe(FRACTAL_DEFAULTS.type);
    expect(def.maxIter).toBe(32);
    expect(def.maxSteps).toBe(32);
    const reduced = parseFractalOptions({}, { reducedMotion: true });
    expect(reduced.paused || reduced.zoomSpeed <= 0.35).toBe(true);
    const preset = parseFractalOptions({ preset: "menger-tunnel" });
    expect(preset.type).toBe("menger");
    const rand = randomiseFractalOptions(0.42);
    expect(rand.preset).toBe("custom");
    expect(FRACTAL_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(validatePresetKeysAgainstSchema(FRACTAL_CONFIG_KEYS)).toEqual([]);
    expect(validatePresetConfigsAgainstSchema()).toEqual([]);
    for (const row of FRACTAL_PRESETS) {
      const cfg = fractalPresetConfig(row.id);
      expect(cfg.preset).toBe(row.id);
    }
  });

  it("locks render scale at 1.0 until host governor ships", () => {
    expect(fractalRenderScale()).toBe(1);
  });

  it("enforces hard iteration and step ceilings regardless of slider values", () => {
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_STEPS_CEIL}; i++)`);
    expect(FRAG).toContain(`for (int i = 0; i < ${FRACTAL_ITER_CEIL}; i++)`);
    const huge = packFractalDrive(0, 1 / 60, 0, 1.6, { maxIter: "999", maxSteps: "999" }, IDLE_POINTER);
    expect(huge.slot0[FZ_SLOT.maxIterN]).toBe(1);
    expect(huge.slot0[FZ_SLOT.maxStepsN]).toBe(1);
  });

  it("fits the plugin buffer contract and advances zoom", () => {
    const a = packFractalDrive(0, 1 / 60, 0.1, 1.6, {}, IDLE_POINTER);
    const b = packFractalDrive(1, 1 / 60, 0.1, 1.6, { zoomSpeed: "1" }, IDLE_POINTER);
    expect(a.slot0).toHaveLength(FZ_SLOT0_FLOATS);
    expect(a.slot0.length).toBeLessThanOrEqual(64);
    expect(a.slot0[FZ_SLOT.mark]).toBe(1);
    expect(b.slot0[FZ_SLOT.zoomLog]).toBeGreaterThan(a.slot0[FZ_SLOT.zoomLog]!);
  });

  it("writes slot0 on idle demo frame via pack drive", () => {
    const writer = new VizBufferWriter(FRACTAL_VIZ_CONTRACT);
    const frame = buildIdleVizFrame(0);
    const slot0 = fractalPackSlot0(frame, {});
    writer.writeBuffer(0, slot0);
    expect(slot0.length).toBe(FZ_SLOT0_FLOATS);
    expect(slot0[FZ_SLOT.mark]).toBe(1);
  });

  it("imports host VizDataFrame contract (no invented frame fields)", () => {
    expect(FRONT).toContain('from "../../../sdk/viz-contract"');
    expect(FRONT).not.toMatch(/type VizFrame\s*=/);
  });

  describe("real data contract (stage-only — no host/region mapping)", () => {
    it("pack source does not read talkers, packets, headlines, or sys", () => {
      for (const src of [FRONT, DRIVE]) {
        expect(src).not.toMatch(/talkers\s*\[/);
        expect(src).not.toMatch(/packets\s*\[/);
        expect(src).not.toMatch(/headlines\s*\[/);
        expect(src).not.toMatch(/sys\.failed/);
      }
      expect(FRAG).not.toMatch(/sys\.failed/);
    });

    it("reordered talkers with the same count do not change the fractal buffer", () => {
      resetFractalDrive();
      const base = buildIdleVizFrame(1.2);
      const reordered: VizDataFrame = {
        ...base,
        talkers: [
          { id: "8.8.8.8", rate: 64, role: "internet" },
          { id: "10.0.0.1", rate: 88, role: "gateway" },
          { id: "10.0.0.42", rate: 120, role: "lan" },
        ],
      };
      const opts = { preset: "bulb-classic" };
      const a = fractalPackSlot0(base, opts);
      resetFractalDrive();
      const b = fractalPackSlot0(reordered, opts);
      expect(a).toEqual(b);
    });

    it("packet list order and per-packet fields do not change the fractal buffer", () => {
      resetFractalDrive();
      const base = buildIdleVizFrame(0.25);
      const reversed: VizDataFrame = {
        ...base,
        packets: [...base.packets].reverse(),
      };
      const opts = { preset: "bulb-classic" };
      const forward = fractalPackSlot0(base, opts);
      resetFractalDrive();
      const back = fractalPackSlot0(reversed, opts);
      expect(forward).toEqual(back);
    });

    it("low field packets and scene-wide sys.failed do not alter buffer (no failure visuals)", () => {
      resetFractalDrive();
      const base = buildIdleVizFrame(0.5);
      const lowPackets: VizDataFrame = {
        ...base,
        packets: [
          { proto: "icmp", size: 32, field: 0.01 },
          { proto: "dns", size: 48, field: 0.02 },
          { proto: "udp", size: 64, field: 0.03 },
        ],
      };
      const sceneFailed: VizDataFrame = {
        ...base,
        sys: { ...base.sys!, failed: 1 },
      };
      const headlineOnly: VizDataFrame = {
        ...base,
        headlines: [{ id: "x", label: "alert", text: "link down", kind: "fail" }],
      };
      const opts = { preset: "bulb-classic" };
      const a = fractalPackSlot0(lowPackets, opts);
      resetFractalDrive();
      const b = fractalPackSlot0(sceneFailed, opts);
      resetFractalDrive();
      const c = fractalPackSlot0(headlineOnly, opts);
      expect(a).toEqual(b);
      expect(a).toEqual(c);
    });
  });

  describe("focus pod light checks", () => {
    const SLIDER_MIN: Record<string, string> = {
      preset: "custom",
      fractalType: "mandelbulb",
      maxIter: "4",
      maxSteps: "12",
      zoomSpeed: "0",
      glow: "0",
      fog: "0",
      detail: "0.0003",
      power: "2",
      scale: "1.2",
      fold: "0.1",
    };
    const SLIDER_MAX: Record<string, string> = {
      preset: "custom",
      fractalType: "julia2d",
      maxIter: "32",
      maxSteps: "48",
      zoomSpeed: "1",
      glow: "1",
      fog: "1",
      detail: "0.01",
      power: "16",
      scale: "3.5",
      fold: "1.2",
      paused: "false",
      autoPilot: "false",
    };

    it("clamps slider min/max and 50 seeded randomise configs (no black, flat, or stalled flight)", () => {
      const cases: { label: string; cfg: Record<string, string> }[] = [
        { label: "min sliders", cfg: SLIDER_MIN },
        { label: "max sliders", cfg: SLIDER_MAX },
        ...FRACTAL_PRESETS.map((row) => ({
          label: `preset ${row.id}`,
          cfg: { preset: row.id, ...fractalPresetConfig(row.id) },
        })),
      ];
      for (let i = 0; i < 50; i++) {
        cases.push({ label: `randomise seed ${i}`, cfg: fractalRandomConfig(i * 0.019 + 0.01) });
      }
      for (const { label, cfg } of cases) {
        assertSmokeHealthy(smokeFractalConfig(cfg), label);
        assertZoomAdvances(cfg, label);
      }
    });

    it("does not default zoom speed to the slider maximum", () => {
      expect(PLUGIN).toMatch(/key: zoomSpeed[\s\S]*?default:\s*0\.35/);
      expect(PLUGIN).toMatch(/max:\s*1\.?0?/);
      const bare = parseFractalOptions({});
      expect(bare.zoomSpeed).toBeLessThan(1);
      expect(bare.zoomSpeed).not.toBe(1);
      const classic = parseFractalOptions({ preset: "bulb-classic" });
      expect(classic.zoomSpeed).toBeLessThan(1);
      expect(classic.zoomSpeed).toBe(0.55);
    });

    it("reduced motion stops zoom drift and camera dolly", () => {
      resetFractalDrive();
      const opts = parseFractalOptions(
        { preset: "bulb-classic", paused: "true", zoomSpeed: "0.5" },
        { reducedMotion: true },
      );
      expect(opts.paused).toBe(true);
      const pointer = { ...IDLE_POINTER };
      const a = fractalDrive({ t: 0, dt: 1 / 60, audio: 0, aspect: 1.6, opts, pointer });
      const b = fractalDrive({ t: 3, dt: 1 / 60, audio: 0, aspect: 1.6, opts, pointer });
      expect(b.slot0[FZ_SLOT.zoomLog]).toBe(a.slot0[FZ_SLOT.zoomLog]);
      expect(b.slot0[FZ_SLOT.camX]).toBe(a.slot0[FZ_SLOT.camX]);
      expect(b.slot0[FZ_SLOT.camY]).toBe(a.slot0[FZ_SLOT.camY]);
      expect(b.slot0[FZ_SLOT.camZ]).toBe(a.slot0[FZ_SLOT.camZ]);
    });

    it("exposes HUD caption for host corner label (type · preset)", () => {
      resetFractalDrive();
      packFractalDrive(0, 1 / 60, 0, 1.6, fractalPresetConfig("box-abyss"), IDLE_POINTER);
      expect(fractalHudCaption).toBe("Mandelbox · Deep Cathedral");
      expect(DRIVE).toContain("fractalHudCaption");
      expect(PLUGIN).toContain("Deep Cathedral");
      expect(PLUGIN).toContain("box-abyss");
    });
  });

  it("releases sandbox iframe and interaction after repeated mount/unmount", async () => {
    const el = document.createElement("div");
    const box = new PluginSandbox();
    const module = "globalThis.zoto.onFrame = () => {};";
    for (let i = 0; i < 5; i++) {
      attachFractalInteraction(el);
      disposeFractalInteraction();
      resetFractalDrive();
      await box.load("fractal-zoom", module, ["viz.read", "viz.write", "config.read"], { preset: "bulb-classic" });
      expect(document.querySelectorAll("iframe").length).toBe(1);
      box.unload();
      expect(document.querySelectorAll("iframe").length).toBe(0);
    }
    expect(fractalPointerState().dragging).toBe(false);
    expect(FRONT.match(/zoto\.onFrame\s*=/g)?.length).toBe(1);
  });

  it("detaches pointer listeners on dispose", () => {
    const el = document.createElement("div");
    attachFractalInteraction(el);
    disposeFractalInteraction();
    expect(fractalPointerState().dragging).toBe(false);
  });
});
