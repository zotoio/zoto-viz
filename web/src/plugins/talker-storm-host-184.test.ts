/**
 * #184: the host pack mirror no longer writes talker-storm's uniforms or particles.
 *
 * Since H1 a pack's own uBright / uAudio survive the host look sync (backdrop.ts syncPluginLook: uBright
 * is host look x pack, uAudio is the pack's). The mirror (viz-pack-host.ts runPackFrameHandler, run
 * synchronously in every frame tick) used to write its own uBright 0.4 + 0.5 x audio and uAudio over the
 * pack's, and particles nothing draws. It now writes slot 0 only ([count, audio, t mod 1]; the sky reads
 * its audio), so the sky draws with exactly what the pack wrote, whatever that is.
 *
 * R3 revert row: put the host copy back (uBright / uAudio, and/or writeParticles) -> red.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { VIZ_FIXTURES } from "../../../plugins/sdk/viz-fixtures";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import { Backdrop } from "../graph/backdrop";
import { estimateTalkerParticles } from "../ui/viz-hud";
import { runPackFrameHandler, type VizPackHandlers } from "./viz-pack-host";

const FRAMES: Array<[string, VizDataFrame]> = [
  ["idle", VIZ_FIXTURES.idle],
  ["golden-live", VIZ_FIXTURES["golden-live"]],
  ["fat-live", VIZ_FIXTURES["fat-live"]],
  ["silent, no talkers", { ...VIZ_FIXTURES.idle, audio: 0, talkers: [] }],
];

type Call = { kind: "buffer"; slot: number; data: number[] } | { kind: "uniform"; name: string } | { kind: "particles" };

function hostWrites(frame: VizDataFrame): Call[] {
  const calls: Call[] = [];
  runPackFrameHandler("talker-storm", frame, {
    writeBuffer: (slot, data) => { calls.push({ kind: "buffer", slot, data: [...data] }); },
    writeUniform: (name) => { calls.push({ kind: "uniform", name }); },
    writeParticles: () => { calls.push({ kind: "particles" }); },
  });
  return calls;
}

describe("#184 R3: the host mirror writes talker-storm's slot 0 only", () => {
  for (const [label, frame] of FRAMES) {
    it(`${label}: slot 0 = [talker count, audio, t mod 1]; no uniform, no particle writes`, () => {
      const calls = hostWrites(frame);
      expect(calls.filter((c) => c.kind === "uniform"), "host uniform writes").toEqual([]);
      expect(calls.filter((c) => c.kind === "particles").length, "host particle writes").toBe(0);
      expect(calls, "exactly one write: slot 0").toEqual([
        { kind: "buffer", slot: 0, data: [estimateTalkerParticles(frame.talkers), frame.audio, frame.t % 1] },
      ]);
    });
  }
});

describe("#184 R3: the sky's uBright / uAudio are what the pack wrote (host look x pack), through host frames", () => {
  const FRAG = `
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(mix(uBg, uAccent, 0.5 + 0.5 * dir.y) * uBright * (0.6 + 0.4 * uAudio) + 0.0 * zotoVizSlots[0].y, uOpacity);
}
`;
  const u = (sky: Backdrop) => (sky.mesh.material as THREE.ShaderMaterial).uniforms;
  const hostU = (sky: Backdrop) => (sky as unknown as { mat: THREE.ShaderMaterial }).mat.uniforms;

  /** One app frame: the mirror runs on the frame's data (writes forwarded like viz-frame-tick), then the look sync. */
  function hostFrame(sky: Backdrop, frame: VizDataFrame, lookBright: number, t: number): void {
    const handlers: VizPackHandlers = {
      writeBuffer: () => {},
      writeUniform: (name, value) => { sky.setPluginUniform(name, value as number | [number, number, number]); },
      writeParticles: () => {},
    };
    runPackFrameHandler("talker-storm", frame, handlers);
    sky.setLook(1, lookBright, frame.audio);
    sky.tick(t);
  }

  for (const lookBright of [1, 0.6]) {
    it(`host look skyBright ${lookBright}: after the pack's write and two host frames, uBright = look x pack and uAudio = pack`, () => {
      const sky = new Backdrop();
      sky.setViewport(640, 400, 1);
      sky.setKind("plugin");
      expect(sky.setPluginShader({ id: "talker-storm", source: FRAG }, () => null)).toBeNull();
      let t = 1;
      // Pack values chosen to differ from anything the host could derive from the frame (audio 0.9).
      for (const [bright, audio] of [[0.8, 0.25], [1.2, 0.5], [0.37, 0]] as const) {
        const frame = { ...VIZ_FIXTURES["golden-live"], audio: 0.9 };
        hostFrame(sky, frame, lookBright, (t += 0.1));
        expect(sky.setPluginUniform("uBright", bright)).toBe(true);
        expect(sky.setPluginUniform("uAudio", audio)).toBe(true);
        for (let k = 0; k < 2; k++) {
          hostFrame(sky, frame, lookBright, (t += 0.1));
          const look = hostU(sky).uBright.value as number;
          expect(u(sky).uBright.value as number, `pack ${bright}, frame ${k}: host look x pack`).toBeCloseTo(look * bright, 9);
          expect(u(sky).uAudio.value, `pack ${audio}, frame ${k}: the pack's uAudio`).toBe(audio);
        }
      }
    });
  }
});
