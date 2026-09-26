import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BR_SLOT, backroomsSlots } from "./director";

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = readFileSync(path.join(here, "index.ts"), "utf8");

describe("backrooms presentTick", () => {
  it("reads pluginClock from VizPresentTick (not legacy skyT args)", () => {
    expect(FRONT).toMatch(/onPresent\s*=\s*\(tick\)/);
    expect(FRONT).toMatch(/tick\.pluginClock/);
    expect(FRONT).toMatch(/tick\.aspect/);
    expect(FRONT).not.toMatch(/skyT/);
    expect(FRONT).toMatch(/\(globalThis as \{ zoto: VizZoto \}\)\.zoto/);
    const inlineZoto = ["declare", " const ", "zoto"].join("");
    expect(FRONT.includes(inlineZoto)).toBe(false);
  });

  it("advances simulation from pluginClock", () => {
    const clock = new Date(2026, 8, 26, 12, 0, 0);
    const early = backroomsSlots(2, clock, 16 / 9).slot0;
    const late = backroomsSlots(40, clock, 16 / 9).slot0;
    expect(late[BR_SLOT.mark]).toBe(early[BR_SLOT.mark]);
    expect(late.some((v, i) => v !== early[i])).toBe(true);
  });
});
