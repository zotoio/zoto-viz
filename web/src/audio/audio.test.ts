import { describe, expect, it } from "vitest";
import { AudioPulse } from "./audio";

describe("AudioPulse", () => {
  it("follows traffic when the mic is off", async () => {
    const pulse = new AudioPulse();
    expect(pulse.listening).toBe(false);
    const a = pulse.tick(0.8);
    expect(a.level).toBeGreaterThan(0);
    expect(a.bass).toBeGreaterThan(0);
    await pulse.enable();
    pulse.disable();
    expect(pulse.level).toBe(0);
  });
});
