import { describe, expect, it } from "vitest";
import {
  BACKROOMS_RUN_STEPS,
  BACKROOMS_SAMPLE_PATHS,
  BACKROOMS_SAMPLE_URLS,
  BACKROOMS_WALK_STEPS,
  backroomsBedGains,
  backroomsSampleRev,
  backroomsSampleUrl,
  PluginSfx,
} from "./plugin-sfx";

/** Vite copies `web/public/sfx/backrooms` into dist — glob so tsc stays browser-only. */
const shippedSfx = import.meta.glob("../../public/sfx/backrooms/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

describe("backrooms sound bed", () => {
  it("maps director levels to bed gains", () => {
    const quiet = backroomsBedGains({ buzz: 1, box: 0, frozen: 0, pant: 0, heavy: 0, heart: 0, heartRate: 1, near: 0 });
    expect(quiet.buzz).toBeGreaterThan(0.1);
    expect(quiet.frozen + quiet.pant + quiet.scared + quiet.heart + quiet.rumble).toBe(0);
    const panic = backroomsBedGains({ buzz: 0.3, box: 0, frozen: 1, pant: 1, heavy: 1, heart: 1, heartRate: 1.6, near: 1 });
    expect(panic.frozen).toBeGreaterThan(0.3);
    expect(panic.pant).toBeGreaterThan(0.3);
    expect(panic.heart).toBeGreaterThan(0.1);
    expect(panic.heart).toBeLessThan(panic.pant);
    expect(panic.buzz).toBeLessThan(quiet.buzz);
  });

  it("slices footfalls inside the recordings", () => {
    for (const list of [BACKROOMS_WALK_STEPS, BACKROOMS_RUN_STEPS]) {
      expect(list.length).toBeGreaterThan(8);
      for (let i = 1; i < list.length; i++) expect(list[i]!).toBeGreaterThan(list[i - 1]! + 0.2);
    }
    expect(BACKROOMS_WALK_STEPS.at(-1)!).toBeLessThan(10.3);
    expect(BACKROOMS_RUN_STEPS.at(-1)!).toBeLessThan(22.4);
  });

  it("ships every CC0 Backrooms sample next to ATTRIBUTION", () => {
    const names = Object.keys(shippedSfx).map((p) => p.split("/").pop() || p);
    expect(names).toContain("ATTRIBUTION.md");
    const rev = backroomsSampleRev();
    expect(rev).toMatch(/^(dev|[0-9a-f]{7,40})$/);
    for (const [id, path] of Object.entries(BACKROOMS_SAMPLE_PATHS)) {
      expect(names).toContain(`${id}.mp3`);
      expect(BACKROOMS_SAMPLE_URLS[id as keyof typeof BACKROOMS_SAMPLE_URLS]).toBe(`${path}?v=${rev}`);
    }
    expect(backroomsSampleUrl("buzz", "aaa")).not.toBe(backroomsSampleUrl("buzz", "bbb"));
  });

  it("runs without Web Audio", () => {
    const sfx = new PluginSfx();
    sfx.setBackrooms(1.2);
    sfx.setBackrooms(1.25);
    sfx.silence();
    sfx.dispose();
  });

  it("stays silent while the global sound switch is off", async () => {
    const { liveSound } = await import("./sound");
    liveSound.setOn(false, false);
    const sfx = new PluginSfx();
    sfx.setBackrooms(12);
    sfx.setBackrooms(12.1);
    sfx.dispose();
  });
});

describe("PluginSfx master volume", () => {
  it("clamps and stores 0–1 master volume", () => {
    const sfx = new PluginSfx();
    sfx.setMasterVolume(0.42);
    expect(sfx.masterVolumeLevel()).toBeCloseTo(0.42);
    sfx.setMasterVolume(2);
    expect(sfx.masterVolumeLevel()).toBe(1);
    sfx.setMasterVolume(-1);
    expect(sfx.masterVolumeLevel()).toBe(0);
    sfx.dispose();
  });
});
