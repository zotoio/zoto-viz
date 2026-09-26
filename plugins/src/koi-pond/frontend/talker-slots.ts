/**
 * Voxel-world #22 talker slot rules (rate-ranked fish slots).
 * 2 s hold after assign, 1.2× rate challenger, empty slots fill immediately,
 * slot released only when the talker leaves the host list.
 */

export const TALKER_SLOT_HOLD_S = 2;
export const TALKER_SLOT_CHALLENGER_MARGIN = 1.2;

export type TalkerSlot = {
  id: string;
  assignedAt: number;
  rate: number;
};

export type RateTalker = { id: string; rate: number };

export type AssignTalkerSlotsPools = {
  out: (TalkerSlot | null)[];
  occupied: Set<string>;
};

/** Incremented when an empty slot triggers an unassigned talker search (tests). */
export let assignTalkerSlotsEmptySlotSearches = 0;

export function resetAssignTalkerSlotsStats(): void {
  assignTalkerSlotsEmptySlotSearches = 0;
}

/** Assign up to `cap` slots; writes into `pools.out` (no slice / sort). */
export function assignTalkerSlots(
  talkerById: Map<string, RateTalker>,
  prev: (TalkerSlot | null)[],
  cap: number,
  simTime: number,
  pools: AssignTalkerSlotsPools,
): (TalkerSlot | null)[] {
  const slots = pools.out;
  const occ = pools.occupied;

  slots.length = cap;
  for (let i = 0; i < cap; i++) {
    slots[i] = i < prev.length ? prev[i] : null;
  }

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (s && !talkerById.has(s.id)) slots[i] = null;
  }

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (!s) continue;
    const t = talkerById.get(s.id);
    if (t) s.rate = t.rate;
  }

  occ.clear();
  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (s) occ.add(s.id);
  }

  const pickBestUnassigned = (): RateTalker | null => {
    let best: RateTalker | null = null;
    for (const t of talkerById.values()) {
      if (occ.has(t.id)) continue;
      if (!best || t.rate > best.rate) best = t;
    }
    return best;
  };

  for (let i = 0; i < cap; i++) {
    if (!slots[i]) {
      assignTalkerSlotsEmptySlotSearches++;
      const t = pickBestUnassigned();
      if (!t) break;
      slots[i] = { id: t.id, assignedAt: simTime, rate: t.rate };
      occ.add(t.id);
    }
  }

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (!s) continue;
    if (simTime - s.assignedAt < TALKER_SLOT_HOLD_S) continue;
    let best: RateTalker | null = null;
    for (const t of talkerById.values()) {
      if (occ.has(t.id)) continue;
      if (t.rate >= s.rate * TALKER_SLOT_CHALLENGER_MARGIN) {
        if (!best || t.rate > best.rate) best = t;
      }
    }
    if (best) {
      occ.delete(s.id);
      slots[i] = { id: best.id, assignedAt: simTime, rate: best.rate };
      occ.add(best.id);
    }
  }

  return slots;
}

export function slottedTalkerIds(slots: (TalkerSlot | null)[]): string[] {
  const out: string[] = [];
  for (const s of slots) if (s) out.push(s.id);
  return out;
}
