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

function occupiedIds(slots: (TalkerSlot | null)[]): Set<string> {
  const s = new Set<string>();
  for (const slot of slots) if (slot) s.add(slot.id);
  return s;
}

/** Assign up to `cap` slots; mutates a copy of `prev` slots. */
export function assignTalkerSlots(
  talkers: RateTalker[],
  prev: (TalkerSlot | null)[],
  cap: number,
  simTime: number,
): (TalkerSlot | null)[] {
  const slots: (TalkerSlot | null)[] = prev.slice(0, cap);
  while (slots.length < cap) slots.push(null);

  const byId = new Map(talkers.map((t) => [t.id, t]));

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (s && !byId.has(s.id)) slots[i] = null;
  }

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (!s) continue;
    const t = byId.get(s.id);
    if (t) s.rate = t.rate;
  }

  const unassignedSorted = (): RateTalker[] => {
    const occ = occupiedIds(slots);
    return talkers
      .filter((t) => !occ.has(t.id))
      .sort((a, b) => b.rate - a.rate);
  };

  let pool = unassignedSorted();
  for (let i = 0; i < cap && pool.length > 0; i++) {
    if (!slots[i]) {
      const t = pool.shift()!;
      slots[i] = { id: t.id, assignedAt: simTime, rate: t.rate };
      pool = unassignedSorted();
    }
  }

  for (let i = 0; i < cap; i++) {
    const s = slots[i];
    if (!s) continue;
    if (simTime - s.assignedAt < TALKER_SLOT_HOLD_S) continue;
    const occ = occupiedIds(slots);
    let best: RateTalker | null = null;
    for (const t of talkers) {
      if (occ.has(t.id)) continue;
      if (t.rate >= s.rate * TALKER_SLOT_CHALLENGER_MARGIN) {
        if (!best || t.rate > best.rate) best = t;
      }
    }
    if (best) {
      slots[i] = { id: best.id, assignedAt: simTime, rate: best.rate };
    }
  }

  return slots;
}

export function slottedTalkerIds(slots: (TalkerSlot | null)[]): string[] {
  const out: string[] = [];
  for (const s of slots) if (s) out.push(s.id);
  return out;
}
