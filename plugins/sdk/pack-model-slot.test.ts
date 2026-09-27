import { describe, expect, it } from "vitest";
import {
  PACK_MODEL_FLAG_LOADED,
  PACK_MODEL_FLAG_PROCEDURAL,
  PackModelSlotController,
  applyPackModelBytes,
  classifyGlbBytes,
  decodePackModelSlotFloat,
  encodePackModelSlotFloat,
  initialPackModelSlotState,
  parsePackModelPath,
  useProceduralArt,
} from "./pack-model-slot";

function miniGlb(): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 12, true);
  return buf;
}

describe("pack-model-slot", () => {
  it("empty path keeps procedural fallback", () => {
    const s = initialPackModelSlotState({});
    expect(useProceduralArt(s)).toBe(true);
    expect(parsePackModelPath({ modelGlb: "  " })).toBe("");
  });

  it("configured path starts pending then falls back without bytes", () => {
    const s = applyPackModelBytes(initialPackModelSlotState({ modelGlb: "fish.glb" }), null);
    expect(useProceduralArt(s)).toBe(true);
  });

  it("valid GLB magic marks loaded", () => {
    const s = applyPackModelBytes(initialPackModelSlotState({ modelGlb: "t.glb" }), miniGlb());
    expect(s.flags & PACK_MODEL_FLAG_LOADED).toBeTruthy();
    expect(useProceduralArt(s)).toBe(false);
  });

  it("round-trips slot float encoding", () => {
    const packed = encodePackModelSlotFloat({ path: "x", flags: PACK_MODEL_FLAG_PROCEDURAL, scale: 1.25 });
    const decoded = decodePackModelSlotFloat(packed);
    expect(decoded.flags).toBe(PACK_MODEL_FLAG_PROCEDURAL);
    expect(decoded.scale).toBeCloseTo(1.25, 1);
  });

  it("controller injectBytesForTest drives slot float", () => {
    const c = new PackModelSlotController({ modelGlb: "pond.glb" });
    c.injectBytesForTest(miniGlb());
    expect(classifyGlbBytes(miniGlb()).ok).toBe(true);
    expect(c.slotFloat()).toBeGreaterThan(0);
    c.dispose();
  });
});

/** Revert row: dropping GLB magic check must fail classifyGlbBytes gate. */
export const REVERT_ROW_PACK_MODEL_GLB_MAGIC = 0x00000000;

describe("pack-model-slot revert gate", () => {
  it("revert row would accept junk as GLB", () => {
    const good = classifyGlbBytes(miniGlb()).ok;
    const junk = new ArrayBuffer(16);
    const bad = classifyGlbBytes(junk).ok;
    expect(good).toBe(true);
    expect(bad).toBe(false);
    expect(bad).toBe(classifyGlbBytes(junk).ok);
  });
});
