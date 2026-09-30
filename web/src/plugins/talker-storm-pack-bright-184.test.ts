/**
 * #184 (UX Pro): talker-storm's own uBright is 0.8 in silence and 1.2 at full audio.
 *
 * Since H1 the pack's uBright is what the sky draws with (times the host look), and since #184 the host
 * mirror no longer writes its own 0.4 + 0.5 x audio over it; kept at the old formula, the storm would
 * draw about 60% dimmer in silence than the look-pinned 1.0 it showed before. The real
 * plugins/src/talker-storm/frontend/index.ts onFrame runs against a recording zoto stub.
 *
 * Revert row: the pack back to 0.4 + audio x 0.5 -> 0.4 / 0.9, red.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIZ_FIXTURE_IDLE } from "../../../plugins/sdk/viz-fixtures";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";

type Uniform = [string, unknown];
const uniforms: Uniform[] = [];
let particleCalls = 0;
const zoto = {
  onFrame: null as ((frame: VizDataFrame) => void) | null,
  onConfig: null,
  onTick: null,
  getConfig: () => ({}),
  writeBuffer: () => {},
  writeUniform: (name: string, value: unknown) => { uniforms.push([name, value]); },
  writeParticles: () => { particleCalls++; },
};

/** Loaded for its side effect (sets zoto.onFrame); the path is built so tsconfig.test.json skips the pack source. */
const loadPackFrontend = (id: string): Promise<unknown> => import(`../../../plugins/src/${id}/frontend/index.ts`);

beforeAll(async () => {
  (globalThis as { zoto?: unknown }).zoto = zoto;
  await loadPackFrontend("talker-storm");
  expect(zoto.onFrame, "talker-storm registers zoto.onFrame").toBeTypeOf("function");
});

afterAll(() => {
  delete (globalThis as { zoto?: unknown }).zoto;
});

function writesFor(audio: number): Record<string, unknown> {
  uniforms.length = 0;
  zoto.onFrame!({ ...VIZ_FIXTURE_IDLE, audio });
  return Object.fromEntries(uniforms);
}

describe("#184 R4: talker-storm pack uBright", () => {
  it("0.8 at silence (audio 0) and 1.2 at full audio (audio 1); uAudio is the frame's audio", () => {
    const silent = writesFor(0);
    const loud = writesFor(1);
    expect(silent.uBright as number, "audio 0").toBeCloseTo(0.8, 9);
    expect(loud.uBright as number, "audio 1").toBeCloseTo(1.2, 9);
    expect(silent.uAudio).toBe(0);
    expect(loud.uAudio).toBe(1);
    expect(Object.keys(loud).sort(), "the uniforms it writes").toEqual(["uAudio", "uBright"]);
    expect(particleCalls, "no writeParticles").toBe(0);
  });
});
