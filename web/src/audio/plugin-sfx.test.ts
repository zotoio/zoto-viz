import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKROOMS_SAMPLE_URLS,
  backroomsPhase,
  backroomsRoarLevel,
  backroomsSfxLevels,
  roarAmp,
  PluginSfx,
} from "./plugin-sfx";

function firstPeekCycle(): number {
  for (let c = 0; c < 80; c++) {
    const t = (c + 0.42) / 0.040;
    if (backroomsPhase(t).peekOn) return c;
  }
  throw new Error("no peek cycle");
}

describe("plugin sfx roar", () => {
  it("keeps the roar quiet and squares the attack", () => {
    expect(roarAmp(0)).toBe(0);
    expect(roarAmp(1)).toBeCloseTo(0.38, 5);
    expect(roarAmp(0.5)).toBeCloseTo(0.095, 5);
    expect(roarAmp(2)).toBe(roarAmp(1));
    expect(roarAmp(-1)).toBe(0);
  });

  it("rises when the Backrooms creature peeks", () => {
    const c = firstPeekCycle();
    const peekT = (c + backroomsPhase((c + 0.42) / 0.040).peekPh + 0.04) / 0.040;
    expect(backroomsPhase(peekT).peek).toBeGreaterThan(0.3);
    expect(backroomsSfxLevels(peekT).screech).toBeGreaterThan(0.4);
    expect(backroomsRoarLevel(0.2)).toBeLessThan(0.2);
  });

  it("pants after the flee sprint and keeps a fluorescent bed", () => {
    const pantT = 0.80 / 0.040;
    expect(backroomsPhase(pantT).flee).toBeGreaterThan(0.9);
    expect(backroomsSfxLevels(pantT).pant).toBeGreaterThan(0.3);
    expect(backroomsSfxLevels(0).buzz).toBe(1);
    expect(backroomsPhase(0.20 / 0.040).flee).toBeLessThan(0.05);
    expect(backroomsPhase(0.55 / 0.040).flee).toBeGreaterThan(0.9);
  });

  it("ships the CC0 Backrooms samples next to ATTRIBUTION", () => {
    expect(Object.keys(BACKROOMS_SAMPLE_URLS)).toEqual(["buzz", "fluoro", "screech", "roar", "pant"]);
    const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
    for (const url of Object.values(BACKROOMS_SAMPLE_URLS)) {
      expect(existsSync(resolve(publicRoot, url.replace(/^\//, "")))).toBe(true);
    }
    expect(existsSync(resolve(publicRoot, "sfx/backrooms/ATTRIBUTION.md"))).toBe(true);
  });

  it("accepts levels without throwing when Web Audio is missing", () => {
    const sfx = new PluginSfx();
    sfx.setRoar(0.8);
    sfx.setBackrooms(1.2);
    sfx.setRoar(0);
    sfx.silence();
    sfx.dispose();
  });

  it("stays silent while the global sound switch is off", async () => {
    const { liveSound } = await import("./sound");
    liveSound.setOn(false, false);
    const sfx = new PluginSfx();
    sfx.setRoar(1);
    sfx.setBackrooms(12);
    sfx.dispose();
  });
});
