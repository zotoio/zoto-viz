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

function smokeFractalDefaultPresetSky(): {
  ok: boolean;
  skipped: boolean;
  compileError: string | null;
  rgba: [number, number, number, number] | null;
} {
  if (typeof document === "undefined") {
    return { ok: false, skipped: true, compileError: "no document", rgba: null };
  }
  const wrapped = wrapPluginSky(FRAG);
  if ("error" in wrapped) {
    return { ok: false, skipped: false, compileError: wrapped.error, rgba: null };
  }
  const w = 320;
  const h = 200;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const gl = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false });
  if (!gl) {
    return { ok: false, skipped: true, compileError: null, rgba: null };
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
  if (typeof vs === "string") return { ok: false, skipped: false, compileError: vs, rgba: null };
  const fs = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\n${wrapped.frag}`);
  if (typeof fs === "string") return { ok: false, skipped: false, compileError: fs, rgba: null };
  const prog = gl.createProgram();
  if (!prog) return { ok: false, skipped: false, compileError: "no program", rgba: null };
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    return { ok: false, skipped: false, compileError: (gl.getProgramInfoLog(prog) || "link failed").trim(), rgba: null };
  }
  resetFractalDrive();
  const cfg = { preset: "bulb-classic", ...fractalPresetConfig("bulb-classic") };
  const drive = packFractalDrive(0.5, 1 / 60, 0.1, w / h, cfg, IDLE_POINTER);
  const slotVec4 = new Float32Array(VIZ_UBO.totalVec4s * 4);
  for (let i = 0; i < drive.slot0.length; i++) slotVec4[i] = drive.slot0[i] ?? 0;
  gl.useProgram(prog);
  const slotsLoc = gl.getUniformLocation(prog, `${VIZ_UBO.threeUniform}[0]`)
    ?? gl.getUniformLocation(prog, VIZ_UBO.threeUniform);
  gl.uniform4fv(slotsLoc, slotVec4);
  gl.uniform1f(gl.getUniformLocation(prog, "uTime"), 0.5);
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
  gl.readPixels(w / 2, h / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  const rgba: [number, number, number, number] = [px[0]!, px[1]!, px[2]!, px[3]!];
  const lum = rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
  const nearBlack = lum < 12 && rgba[0] < 15 && rgba[1] < 15 && rgba[2] < 25;
  return { ok: !nearBlack, skipped: false, compileError: null, rgba };
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

  it("smoke: default preset draws a non-black centre pixel when WebGL2 is available", () => {
    const smoke = smokeFractalDefaultPresetSky();
    if (smoke.skipped) return;
    expect(smoke.compileError, "shader compile/link").toBeNull();
    expect(smoke.ok, `rgba=${smoke.rgba?.join(",")}`).toBe(true);
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
