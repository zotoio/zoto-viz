import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignTalkerSlots,
  assignTalkerSlotsChallengerScans,
  assignTalkerSlotsEmptySlotSearches,
  copyTalkerSlots,
  createTalkerSlotArrays,
  createTalkerSlotScratch,
  pickBestUnassigned,
  pickBestUnassignedCalls,
  resizeTalkerSlotArrays,
  resizeTalkerSlotArraysAllocations,
  resetAssignTalkerSlotsStats,
  slottedTalkerIds,
  TALKER_SLOT_CHALLENGER_MARGIN,
  TALKER_SLOT_HOLD_S,
  type SlotTalker,
  type TalkerSlot,
} from "./talker-slots";
import { assignTalkerSlotsReference } from "./talker-slots.reference";

function mapFrom(entries: [string, number][]): Map<string, SlotTalker> {
  const m = new Map<string, SlotTalker>();
  for (const [id, rate] of entries) m.set(id, { rate });
  return m;
}

function swap(read: TalkerSlot[], write: TalkerSlot[]): [TalkerSlot[], TalkerSlot[]] {
  return [write, read];
}

function slotsEqual(a: readonly TalkerSlot[], b: readonly TalkerSlot[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].assignedAt !== b[i].assignedAt) return false;
  }
  return true;
}

/** Seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("assignTalkerSlots", () => {
  const scratch = createTalkerSlotScratch();

  afterEach(() => {
    resetAssignTalkerSlotsStats();
    vi.restoreAllMocks();
  });

  it("fills empty slots immediately with top unassigned talkers", () => {
    const [read, write] = createTalkerSlotArrays(2);
    assignTalkerSlots(mapFrom([["a", 100], ["b", 80]]), read, write, scratch, 0);
    expect(slottedTalkerIds(write)).toEqual(["a", "b"]);
  });

  it("releases a slot when its talker leaves the host list", () => {
    let [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(mapFrom([["a", 100]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    assignTalkerSlots(new Map(), read, write, scratch, 1);
    expect(slottedTalkerIds(write)).toEqual([]);
  });

  it("holds incumbent for 2s before a marginal challenger can replace (#22)", () => {
    let [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(mapFrom([["a", 100]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    assignTalkerSlots(mapFrom([["a", 50], ["b", 110]]), read, write, scratch, 0.5);
    expect(slottedTalkerIds(write)).toEqual(["a"]);
    [read, write] = swap(read, write);
    assignTalkerSlots(mapFrom([["a", 50], ["b", 200]]), read, write, scratch, TALKER_SLOT_HOLD_S);
    expect(slottedTalkerIds(write)).toEqual(["b"]);
  });

  it("requires challenger margin after hold (#22)", () => {
    let [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(mapFrom([["a", 100]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    const marginal = 100 * TALKER_SLOT_CHALLENGER_MARGIN - 1;
    assignTalkerSlots(mapFrom([["a", 100], ["b", marginal]]), read, write, scratch, TALKER_SLOT_HOLD_S);
    expect(slottedTalkerIds(write)).toEqual(["a"]);
  });

  it("keeps slot stable when talkers reorder but ids unchanged", () => {
    let [read, write] = createTalkerSlotArrays(2);
    assignTalkerSlots(mapFrom([["a", 100], ["b", 90]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    assignTalkerSlots(mapFrom([["b", 200], ["a", 50]]), read, write, scratch, 1);
    expect(slottedTalkerIds(write).sort()).toEqual(["a", "b"]);
  });

  it("does not mutate the prev buffer slots", () => {
    const [read, write] = createTalkerSlotArrays(1);
    read[0] = { id: "a", assignedAt: 0 };
    const snapshot = { ...read[0] };
    assignTalkerSlots(mapFrom([["a", 50]]), read, write, scratch, 1);
    expect(read[0]).toEqual(snapshot);
  });

  it("allows concurrent A and B in separate slots", () => {
    const [read, write] = createTalkerSlotArrays(2);
    assignTalkerSlots(mapFrom([["a", 100], ["b", 99]]), read, write, scratch, 0);
    expect(slottedTalkerIds(write).sort()).toEqual(["a", "b"]);
  });

  it("(28a) full slots: no empty-slot searches and no Array.sort over 300 steps", () => {
    const cap = 4;
    const talkers = mapFrom(Array.from({ length: 200 }, (_, i) => [`t${i}`, 200 - i] as [string, number]));
    let [read, write] = createTalkerSlotArrays(cap);
    for (let i = 0; i < cap; i++) {
      read[i] = { id: `t${i}`, assignedAt: 0 };
    }
    resetAssignTalkerSlotsStats();
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    for (let step = 0; step < 300; step++) {
      assignTalkerSlots(talkers, read, write, scratch, step * 0.05);
      [read, write] = swap(read, write);
    }
    expect(assignTalkerSlotsEmptySlotSearches).toBe(0);
    expect(sortSpy).not.toHaveBeenCalled();
  });

  it("(28b) a retired out buffer is not mutated by later steps", () => {
    const a = createTalkerSlotArrays(2)[0];
    const b = createTalkerSlotArrays(2)[0];
    const c = createTalkerSlotArrays(2)[0];
    assignTalkerSlots(mapFrom([["a", 100], ["b", 90]]), a, b, scratch, 0);
    const retired = b;
    const snapshot = retired.map((s) => ({ ...s }));
    assignTalkerSlots(mapFrom([["a", 80], ["b", 70], ["c", 300]]), b, c, scratch, 5);
    assignTalkerSlots(mapFrom([["d", 50]]), c, a, scratch, 10);
    expect(retired).toEqual(snapshot);
  });

  it("(28c) throws when out === prev in dev/test builds", () => {
    const buf = createTalkerSlotArrays(1)[0];
    expect(() => assignTalkerSlots(mapFrom([["a", 1]]), buf, buf, scratch, 0)).toThrow(
      /out must not be the same array/,
    );
  });

  it("(28c) throws when out.length !== prev.length in dev/test builds", () => {
    const prev = createTalkerSlotArrays(2)[0];
    const out = createTalkerSlotArrays(3)[0];
    expect(() => assignTalkerSlots(mapFrom([["a", 1]]), prev, out, scratch, 0)).toThrow(
      /out\.length must equal prev\.length/,
    );
  });

  it("(28d) challenger order matches #22 fixture after hold window", () => {
    let [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(mapFrom([["a", 100]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    assignTalkerSlots(mapFrom([["a", 50], ["b", 200]]), read, write, scratch, TALKER_SLOT_HOLD_S);
    expect(write[0]?.id).toBe("b");
    expect(write[0]?.assignedAt).toBe(TALKER_SLOT_HOLD_S);
  });

  it("equal-rate ties prefer first insertion into byId", () => {
    const byId = new Map<string, SlotTalker>();
    byId.set("first", { rate: 50 });
    byId.set("second", { rate: 50 });
    const [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(byId, read, write, scratch, 0);
    expect(write[0].id).toBe("first");
  });

  it("matches sort-based reference over 500 seeded steps (joins, leaves, reorders, equal rates)", () => {
    const cap = 4;
    const rnd = mulberry32(0x22_34_500);
    const refScratch = createTalkerSlotScratch();
    let [read, write] = createTalkerSlotArrays(cap);
    let [refRead, refWrite] = createTalkerSlotArrays(cap);

    const live = new Map<string, number>();

    for (let step = 0; step < 500; step++) {
      const simTime = step * 0.04;
      const op = rnd();
      if (op < 0.12 && live.size < 12) {
        const id = `t${Math.floor(rnd() * 40)}`;
        if (!live.has(id)) live.set(id, Math.floor(rnd() * 200));
      } else if (op < 0.22 && live.size > 0) {
        const keys = [...live.keys()];
        live.delete(keys[Math.floor(rnd() * keys.length)]!);
      } else if (op < 0.35) {
        for (const [id] of live) live.set(id, Math.floor(rnd() * 200));
      } else if (op < 0.42 && live.size >= 2) {
        const entries = [...live.entries()].sort(() => rnd() - 0.5);
        live.clear();
        for (const [id, rate] of entries) live.set(id, rate);
      } else if (op < 0.5 && live.size >= 2) {
        const entries = [...live.entries()];
        const dupRate = entries[0]![1];
        live.set(`eq${step}`, dupRate);
      }

      const byId = new Map<string, SlotTalker>();
      for (const [id, rate] of live) byId.set(id, { rate });

      assignTalkerSlots(byId, read, write, scratch, simTime);
      assignTalkerSlotsReference(byId, refRead, refWrite, refScratch, simTime);

      expect(slotsEqual(write, refWrite)).toBe(true);
      [read, write] = swap(read, write);
      [refRead, refWrite] = swap(refRead, refWrite);
    }
  });

  it("revert proof: >= tie-break in pickBestUnassigned would diverge from strict >", () => {
    const byId = mapFrom([["a", 10], ["b", 10]]);
    const occupied = new Set<string>();
    expect(pickBestUnassigned(byId, occupied)).toBe("a");

    let bestId: string | null = null;
    for (const [id, t] of byId) {
      if (occupied.has(id)) continue;
      if (!bestId || t.rate >= (byId.get(bestId)?.rate ?? -Infinity)) bestId = id;
    }
    expect(bestId).toBe("b");
    expect(bestId).not.toBe(pickBestUnassigned(byId, occupied));
  });

  describe("resizeTalkerSlotArrays", () => {
    it("(a) 24 -> 8 -> 24 keeps the first 8 ids and assignedAt", () => {
      let pair = createTalkerSlotArrays(24);
      let [read, write] = pair;
      for (let i = 0; i < 24; i++) {
        read[i] = { id: `t${i}`, assignedAt: i * 0.5 };
        write[i] = { id: null, assignedAt: 0 };
      }
      const kept = read.slice(0, 8).map((s) => ({ ...s }));

      pair = resizeTalkerSlotArrays([read, write], 8);
      [read, write] = pair;
      expect(read.length).toBe(8);
      for (let i = 0; i < 8; i++) {
        expect(read[i]).toEqual(kept[i]);
      }

      pair = resizeTalkerSlotArrays([read, write], 24);
      [read, write] = pair;
      for (let i = 0; i < 8; i++) {
        expect(read[i]).toEqual(kept[i]);
      }
      for (let i = 8; i < 24; i++) {
        expect(read[i].id).toBeNull();
      }
    });

    it("(b) regrown empty slots fill without resetting kept assignedAt / hold", () => {
      const scratch = createTalkerSlotScratch();
      let pair = createTalkerSlotArrays(24);
      let [read, write] = pair;
      const t0 = 3.5;
      read[0] = { id: "incumbent", assignedAt: t0 };
      for (let i = 1; i < 24; i++) read[i] = { id: `t${i}`, assignedAt: 0 };
      pair = resizeTalkerSlotArrays([read, write], 8);
      [read, write] = pair;
      pair = resizeTalkerSlotArrays([read, write], 24);
      [read, write] = pair;

      const byId = mapFrom(
        Array.from({ length: 30 }, (_, i) => [`n${i}`, 100 - i] as [string, number]),
      );
      byId.set("incumbent", { rate: 50 });
      const simTime = t0 + 0.1;
      assignTalkerSlots(byId, read, write, scratch, simTime);
      expect(write[0].id).toBe("incumbent");
      expect(write[0].assignedAt).toBe(t0);
      const filledNew = write.slice(8, 24).filter((s) => s.id);
      expect(filledNew.length).toBeGreaterThan(0);
      for (const s of filledNew) {
        expect(s.assignedAt).toBe(simTime);
      }
    });

    it("(c) same-cap resize returns identical arrays and steady assign does not resize-allocate", () => {
      const scratch = createTalkerSlotScratch();
      let pair = createTalkerSlotArrays(4);
      resetAssignTalkerSlotsStats();
      const same = resizeTalkerSlotArrays(pair, 4);
      expect(same[0]).toBe(pair[0]);
      expect(same[1]).toBe(pair[1]);
      expect(resizeTalkerSlotArraysAllocations).toBe(0);

      let [read, write] = pair;
      const byId = mapFrom([["a", 10], ["b", 9]]);
      for (let step = 0; step < 40; step++) {
        assignTalkerSlots(byId, read, write, scratch, step * 0.05);
        [read, write] = swap(read, write);
        pair = resizeTalkerSlotArrays([read, write], 4);
        [read, write] = pair;
      }
      expect(resizeTalkerSlotArraysAllocations).toBe(0);
    });

    it("revert proof (a): copying from out instead of prev loses shrunk state", () => {
      let [read, write] = createTalkerSlotArrays(4);
      read[0] = { id: "from-prev", assignedAt: 1 };
      write[0] = { id: "from-out", assignedAt: 9 };
      const wrongPrev = write.map((s) => ({ id: s.id, assignedAt: s.assignedAt }));
      const resized = resizeTalkerSlotArrays([read, write], 2);
      expect(resized[0][0].id).toBe("from-prev");
      expect(wrongPrev[0].id).toBe("from-out");
      expect(resized[0][0].id).not.toBe(wrongPrev[0].id);
    });

    it("revert proof (b): resetting kept assignedAt on resize changes hold outcome", () => {
      const scratch = createTalkerSlotScratch();
      let pair = createTalkerSlotArrays(8);
      let [read, write] = pair;
      read[0] = { id: "a", assignedAt: 1 };
      pair = resizeTalkerSlotArrays([read, write], 1);
      [read, write] = pair;
      const byId = mapFrom([["a", 100], ["b", 500]]);
      const simTime = 1 + TALKER_SLOT_HOLD_S + 0.5;
      assignTalkerSlots(byId, read, write, scratch, simTime);
      expect(write[0].id).toBe("b");

      read[0] = { id: "a", assignedAt: simTime - 0.05 };
      assignTalkerSlots(byId, read, write, scratch, simTime);
      expect(write[0].id).toBe("a");
    });

    it("revert proof (c): always allocating new arrays breaks same-cap identity", () => {
      const pair = createTalkerSlotArrays(2);
      const alwaysNew = (): [typeof pair[0], typeof pair[1]] => {
        const [p, o] = pair;
        return [
          p.map((s) => ({ id: s.id, assignedAt: s.assignedAt })),
          o.map((s) => ({ id: s.id, assignedAt: s.assignedAt })),
        ];
      };
      const wrong = alwaysNew();
      const right = resizeTalkerSlotArrays(pair, 2);
      expect(right[0]).toBe(pair[0]);
      expect(wrong[0]).not.toBe(pair[0]);
    });
  });

  it("copyTalkerSlots returns snapshots that do not mutate live buffers", () => {
    const [read] = createTalkerSlotArrays(2);
    read[0].id = "a";
    read[0].assignedAt = 3;
    const snap = copyTalkerSlots(read);
    snap[0].id = "mutated";
    expect(read[0].id).toBe("a");
    expect(snap).not.toBe(read);
    expect(snap[0]).not.toBe(read[0]);
  });

  it("counts challenger scans across talkers after hold expires", () => {
    let [read, write] = createTalkerSlotArrays(1);
    assignTalkerSlots(mapFrom([["a", 100]]), read, write, scratch, 0);
    [read, write] = swap(read, write);
    resetAssignTalkerSlotsStats();
    const byId = mapFrom([["a", 50], ["b", 200], ["c", 150]]);
    assignTalkerSlots(byId, read, write, scratch, TALKER_SLOT_HOLD_S + 1);
    expect(assignTalkerSlotsChallengerScans).toBe(byId.size);
  });

  it("does not allocate function objects per assignTalkerSlots call", () => {
    const byId = mapFrom([["a", 1], ["b", 2]]);
    let [read, write] = createTalkerSlotArrays(2);
    resetAssignTalkerSlotsStats();
    const before = pickBestUnassignedCalls;
    for (let i = 0; i < 50; i++) {
      assignTalkerSlots(byId, read, write, scratch, i);
      [read, write] = swap(read, write);
    }
    expect(pickBestUnassignedCalls - before).toBeGreaterThan(0);
    expect(pickBestUnassigned).toBeTypeOf("function");
  });
});
