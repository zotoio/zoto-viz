import { describe, expect, it } from "vitest";
import { AudioPulse, logSpectrum } from "./audio";

describe("AudioPulse", () => {
  it("follows traffic when the mic is off", async () => {
    const pulse = new AudioPulse();
    expect(pulse.listening).toBe(false);
    expect(pulse.heard(16).every((v) => v === 0)).toBe(true);
    const a = pulse.tick(0.8);
    expect(a.level).toBeGreaterThan(0);
    expect(a.bass).toBeGreaterThan(0);
    expect(pulse.waterfall().length).toBe(1);
    expect(pulse.spectrum(32).every((v) => v === 0)).toBe(true);
    pulse.tick(0.4);
    expect(pulse.waterfall().length).toBe(2);
    await pulse.enable();
    pulse.disable();
    expect(pulse.level).toBe(0);
  });

  it("places a tone in the log band that contains its frequency", () => {
    const fftSize = 2048;
    const sampleRate = 48000;
    const bins = new Uint8Array(fftSize / 2);
    const hz = 1000;
    bins[Math.round(hz / (sampleRate / fftSize))] = 255;
    const out = logSpectrum(bins, sampleRate, fftSize, 16);
    const peak = out.indexOf(Math.max(...out));
    expect(peak).toBe(8);
    expect(out[8]).toBeGreaterThan(0);
    expect(out[0]).toBe(0);
    expect(out[15]).toBe(0);
    expect(logSpectrum(new Uint8Array(8), sampleRate, fftSize, 16).every((v) => v === 0)).toBe(true);
  });
});
