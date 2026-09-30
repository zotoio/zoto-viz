/**
 * #179 / #180 H1: fractal-zoom's own sky uniform writes survive the host's per-frame look sync.
 *
 * fractal-zoom's frontend (plugins/src/fractal-zoom/frontend/index.ts) writes uAccent / uBg (its
 * palette drive), uOpacity 1 and uAudio every frame. Before H1, backdrop.ts syncPluginLook copied
 * the host's uAccent / uBg / uAudio / uOpacity over those writes on every setLook / setColors, so
 * the pack's palette never reached its sky. This row drives the real frontend's onFrame on host
 * idle-fixture frames, gates each write through the pack's own plugin.yml viz contract
 * (VizBufferWriter, as main.ts does), forwards the accepted ones to the pack sky
 * (Backdrop.setPluginUniform), runs host frames (setLook / setColors / tick), and reads the pack
 * material.
 *
 * Revert row: put syncPluginLook back to copying the host's uAccent / uBg every frame -> the
 * uAccent / uBg assertions go red.
 *
 * Test-only import of a pack frontend from web/src (*.test.ts): allowed by pack-lint's
 * isHostCodeRepoPath and not a baseline row.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Backdrop } from "../graph/backdrop";
import { mergeVizIdleFrame, parseVizContract, VizBufferWriter, type VizDataFrame, type VizUniformValue } from "./viz-host";

const here = path.dirname(fileURLToPath(import.meta.url));
const packDir = path.resolve(here, "../../../plugins/src/fractal-zoom");
const MANIFEST = parse(readFileSync(path.join(packDir, "plugin.yml"), "utf8")) as { viz: unknown };
const FRAG = readFileSync(path.join(packDir, "sky/fragment.glsl"), "utf8");

type Write = { name: string; value: VizUniformValue };
let writes: Write[] = [];
let onFrame: ((frame: VizDataFrame) => void) | null = null;

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = {
    onTick: null,
    onConfig: null,
    onFrame: null,
    getConfig: () => ({}),
    writeBuffer: () => {},
    writeParticles: () => {},
    writeUniform: (name: string, value: VizUniformValue) => { writes.push({ name, value }); },
  };
  await import("../../../plugins/src/fractal-zoom/frontend/index");
  onFrame = (globalThis as unknown as { zoto: { onFrame: typeof onFrame } }).zoto.onFrame;
});

afterAll(() => {
  delete (globalThis as { zoto?: unknown }).zoto;
});

const EMPTY: VizDataFrame = { t: 1, dt: 1 / 30, audio: 0, packets: [], rf: [], talkers: [], headlines: [] };
/** Host look, deliberately unlike fractal's palette so an overwrite shows. */
const HOST = { opacity: 0.9, bright: 1.2, audio: 0.7, rim: 0x3366cc, clear: 0x101820 };

function rgb(c: unknown): number[] {
  const k = c as THREE.Color;
  return [k.r, k.g, k.b];
}

describe("#179 H1: fractal-zoom's own uniform writes survive syncPluginLook", () => {
  it("fractal-zoom's uAccent / uBg / uAudio win and uOpacity is host x pack after host look frames", () => {
    const contract = parseVizContract(MANIFEST.viz);
    expect(contract, "fractal-zoom plugin.yml viz contract parses").toBeDefined();
    expect([...contract!.uniforms]).toEqual(["uTime", "uBright", "uAudio", "uAccent", "uBg", "uOpacity"]);
    const writer = new VizBufferWriter(contract!);

    const sky = new Backdrop();
    sky.setViewport(640, 360, 1);
    sky.setKind("plugin");
    expect(sky.setPluginShader({ id: "fractal-zoom", source: FRAG }, () => null), "fractal sky wraps").toBeNull();
    expect(sky.pluginSkyId()).toBe("fractal-zoom");

    expect(onFrame, "fractal-zoom frontend registers zoto.onFrame").toBeTypeOf("function");
    const last: Record<string, VizUniformValue> = {};
    let t = 0;
    for (let f = 0; f < 150; f++) {
      writes = [];
      onFrame!({ ...mergeVizIdleFrame({ ...EMPTY, t: 1 + f / 30 }, { fixture: "host" }), audio: 0.35 });
      for (const w of writes) {
        const gate = writer.writeUniform(w.name, w.value);
        expect(gate.ok, `${w.name} accepted by the contract (${gate.ok ? "" : gate.error})`).toBe(true);
        expect(sky.setPluginUniform(w.name, w.value), `${w.name} reaches the pack sky`).toBe(true);
        last[w.name] = w.value;
      }
      // Host frame after the pack's writes: look sliders, theme colours, clock.
      sky.setLook(HOST.opacity, HOST.bright, HOST.audio);
      sky.setColors(HOST.rim, HOST.clear);
      t += 1 / 30;
      sky.tick(t);
    }
    expect(Object.keys(last).sort(), "what fractal-zoom writes").toEqual(["uAccent", "uAudio", "uBg", "uOpacity"]);
    expect(sky.skyMorphing(), "crossfade done").toBe(false);

    const u = (sky.mesh.material as THREE.ShaderMaterial).uniforms;
    const host = (sky as unknown as { mat: THREE.ShaderMaterial }).mat.uniforms;
    const accent = last.uAccent as [number, number, number];
    const bg = last.uBg as [number, number, number];
    expect(rgb(host.uAccent.value), "host rim differs from the pack's accent").not.toEqual(accent);
    rgb(u.uAccent.value).forEach((v, i) => expect(v, `uAccent[${i}]: the pack's ${accent.join(",")} vs host ${rgb(host.uAccent.value).join(",")}`).toBeCloseTo(accent[i]!, 6));
    rgb(u.uBg.value).forEach((v, i) => expect(v, `uBg[${i}]: the pack's ${bg.join(",")} vs host ${rgb(host.uBg.value).join(",")}`).toBeCloseTo(bg[i]!, 6));
    expect(u.uAudio.value, "uAudio: the pack's own").toBe(last.uAudio);
    expect(host.uAudio.value, "host audio differs").toBe(HOST.audio);
    expect(u.uOpacity.value as number, "uOpacity = host opacity x pack opacity").toBeCloseTo(HOST.opacity * (last.uOpacity as number), 9);
    expect(u.uBright.value as number, "uBright: host (fractal writes none) x 1").toBeCloseTo(HOST.bright, 9);
  });
});
