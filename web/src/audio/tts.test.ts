import { describe, expect, it } from "vitest";
import { concatBytes, pcmSampleRate, s16leToF32 } from "./tts";

describe("pcmSampleRate", () => {
  it("reads X-Zoto-Viz-Rate then content-type", () => {
    expect(pcmSampleRate(new Headers({ "X-Zoto-Viz-Rate": "22050" }))).toBe(22050);
    expect(pcmSampleRate(new Headers({ "content-type": "audio/pcm;rate=16000" }))).toBe(16000);
    expect(pcmSampleRate(new Headers())).toBe(24000);
    expect(pcmSampleRate(new Headers({ "X-Zoto-Viz-Rate": "99" }))).toBe(24000);
  });
});

describe("s16leToF32", () => {
  it("decodes little-endian int16", () => {
    const bytes = new Uint8Array([0, 0, 0, 128, 255, 127]);
    const f = s16leToF32(bytes);
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(-1, 5);
    expect(f[2]).toBeCloseTo(32767 / 32768, 5);
  });
});

describe("concatBytes", () => {
  it("joins chunks", () => {
    const a = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect([...a]).toEqual([1, 2, 3]);
  });
});
