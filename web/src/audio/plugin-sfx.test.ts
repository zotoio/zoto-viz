import { describe, expect, it } from "vitest";
import {
  BACKROOMS_SAMPLE_PATHS,
  BACKROOMS_SAMPLE_URLS,
  backroomsPhase,
  backroomsRoarLevel,
  backroomsSampleRev,
  backroomsSampleUrl,
  backroomsSfxLevels,
  roarAmp,
  PluginSfx,
} from "./plugin-sfx";

/** Vite copies `web/public/sfx/backrooms` into dist — glob so tsc stays browser-only. */
const shippedSfx = import.meta.glob("../../public/sfx/backrooms/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

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
    expect(backroomsPhase(peekT).roar).toBeGreaterThan(0.5);
    expect(backroomsSfxLevels(peekT).screech).toBeGreaterThan(0.4);
    expect(backroomsSfxLevels(peekT).roar).toBeGreaterThan(0.5);
    expect(backroomsRoarLevel(0.2)).toBeLessThan(0.2);
  });

  it("freezes on the pillar grin then pants after the cut", () => {
    const c = firstPeekCycle();
    const ph = backroomsPhase((c + 0.5) / 0.040);
    const freezeT = (c + ph.peekPh + 0.04) / 0.040;
    expect(backroomsPhase(freezeT).freeze).toBeGreaterThan(0.5);
    expect(backroomsPhase(freezeT).flee).toBeLessThan(0.25);
    const fleeT = (c + ph.peekPh + 0.22) / 0.040;
    expect(backroomsPhase(fleeT).flee).toBeGreaterThan(0.9);
    expect(backroomsPhase(fleeT).roar).toBeLessThan(0.15);
    expect(backroomsPhase(fleeT).close).toBeGreaterThan(0.5);
    expect(backroomsSfxLevels(fleeT).pant).toBeGreaterThan(0.3);
    expect(backroomsSfxLevels(fleeT).buzz).toBeLessThan(0.35);
    expect(backroomsSfxLevels(freezeT).buzz).toBeLessThan(0.55);
    const pantT = (c + 0.80) / 0.040;
    expect(backroomsSfxLevels(pantT).pant).toBeGreaterThan(0.3);
    let emptyT = 0;
    for (let e = 0; e < 80; e++) {
      const t = (e + 0.12) / 0.040;
      if (!backroomsPhase(t).peekOn) {
        emptyT = t;
        break;
      }
    }
    expect(backroomsPhase(emptyT).peekOn).toBe(false);
    expect(backroomsSfxLevels(emptyT).buzz).toBe(1);
    expect(backroomsPhase(0.20 / 0.040).flee).toBeLessThan(0.05);
  });

  it("plays a brief music-box phrase on hashed empty halls, not next to the creature", () => {
    let hit = 0;
    let quiet = 0;
    for (let c = 0; c < 48; c++) {
      for (let ph = 0.04; ph < 0.9; ph += 0.04) {
        const t = (c + ph) / 0.040;
        const p = backroomsPhase(t);
        const L = backroomsSfxLevels(t);
        if (p.boxOn && L.box > 0.35) hit += 1;
        if (!p.boxOn) {
          expect(L.box).toBe(0);
          quiet += 1;
        }
        if (p.freeze > 0.6 || p.close > 0.7) expect(L.box).toBeLessThan(0.25);
      }
    }
    expect(hit).toBeGreaterThan(3);
    expect(quiet).toBeGreaterThan(10);
  });

  it("ships the CC0 Backrooms samples next to ATTRIBUTION", () => {
    expect(Object.keys(BACKROOMS_SAMPLE_PATHS)).toEqual(["buzz", "fluoro", "screech", "roar", "pant", "box"]);
    expect(Object.keys(BACKROOMS_SAMPLE_URLS)).toEqual(["buzz", "fluoro", "screech", "roar", "pant", "box"]);
    const names = Object.keys(shippedSfx).map((p) => p.split("/").pop() || p);
    expect(names).toEqual(expect.arrayContaining([
      "buzz.mp3",
      "fluoro.mp3",
      "screech.mp3",
      "roar.mp3",
      "pant.mp3",
      "box.mp3",
      "ATTRIBUTION.md",
    ]));
    const rev = backroomsSampleRev();
    expect(rev).toMatch(/^(dev|[0-9a-f]{7,40})$/);
    for (const [id, path] of Object.entries(BACKROOMS_SAMPLE_PATHS)) {
      expect(names).toContain(`${id}.mp3`);
      expect(BACKROOMS_SAMPLE_URLS[id as keyof typeof BACKROOMS_SAMPLE_URLS]).toBe(`${path}?v=${rev}`);
    }
    expect(backroomsSampleUrl("buzz", "aaa")).not.toBe(backroomsSampleUrl("buzz", "bbb"));
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
