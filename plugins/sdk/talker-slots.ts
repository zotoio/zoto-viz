/**
 * Rate-ranked talker slots (voxel-world #22 / aquarium rules).
 *
 * Caller owns `prev` and `out` and swaps them each simulation step. `out` is overwritten in
 * place; it must not be the same array reference as `prev` (dev builds throw). `out.length` is
 * the slot cap and must equal `prev.length` (dev builds throw on mismatch). Ties on equal rate
 * go to the talker inserted into `byId` first. No heap allocation per `assignTalkerSlots` call.
 *
 * Future tuning knobs are additive fields on {@link TalkerSlotRules} / {@link TalkerSlotScratch},
 * not new positional parameters to {@link assignTalkerSlots}.
 */

export const TALKER_SLOT_HOLD_S = 2;
export const TALKER_SLOT_CHALLENGER_MARGIN = 1.2;

export type SlotTalker = { rate: number };

export interface TalkerSlot {
  id: string | null;
  assignedAt: number;
}

export interface TalkerSlotRules {
  holdS: number;
  challengerMargin: number;
}

export interface TalkerSlotScratch {
  readonly rules: Readonly<TalkerSlotRules>;
}

type ScratchInternal = TalkerSlotScratch & {
  occupied: Set<string>;
};

const DEFAULT_RULES: TalkerSlotRules = {
  holdS: TALKER_SLOT_HOLD_S,
  challengerMargin: TALKER_SLOT_CHALLENGER_MARGIN,
};

/** Mutable counters for vitest (assign/resize instrumentation). */
export const talkerSlotStats = {
  emptySlotSearches: 0,
  pickBestUnassignedCalls: 0,
  resizeAllocations: 0,
  challengerScans: 0,
};

export function createTalkerSlotScratch(rules?: Partial<TalkerSlotRules>): TalkerSlotScratch {
  const merged: TalkerSlotRules = { ...DEFAULT_RULES, ...rules };
  const scratch: ScratchInternal = {
    rules: merged,
    occupied: new Set<string>(),
  };
  return scratch;
}

/** Two distinct slot arrays of distinct slot objects (length `cap`). */
export function createTalkerSlotArrays(cap: number): [TalkerSlot[], TalkerSlot[]] {
  const a: TalkerSlot[] = [];
  const b: TalkerSlot[] = [];
  for (let i = 0; i < cap; i++) {
    a.push({ id: null, assignedAt: 0 });
    b.push({ id: null, assignedAt: 0 });
  }
  return [a, b];
}

/**
 * Resize the caller's `[prev, out]` pair to `cap` slots per buffer.
 *
 * When `cap` equals the current length, returns the same pair reference (no allocation).
 * Otherwise allocates two new arrays of `cap` distinct slot objects. Copies slots
 * `0 .. min(oldLength, cap) - 1` from the pair's **prev** buffer into the new prev (id +
 * assignedAt only). Indices at and above `cap` are dropped — **#22 shrink keeps the lowest
 * indexes**. New slots and the entire new out buffer start empty (`id: null`). Replace both
 * caller buffers with the returned pair before the next {@link assignTalkerSlots} step.
 */
export function resizeTalkerSlotArrays(
  pair: readonly [TalkerSlot[], TalkerSlot[]],
  cap: number,
): [TalkerSlot[], TalkerSlot[]] {
  const [prev, out] = pair;
  const oldLen = prev.length;
  if (oldLen !== out.length) {
    if (isDevBuild()) {
      throw new Error("resizeTalkerSlotArrays: prev and out must have the same length");
    }
    return [prev, out];
  }
  if (cap === oldLen) return [prev, out];

  talkerSlotStats.resizeAllocations++;
  const copyCount = Math.min(oldLen, cap);
  const newPrev: TalkerSlot[] = [];
  const newOut: TalkerSlot[] = [];
  for (let i = 0; i < cap; i++) {
    if (i < copyCount) {
      const p = prev[i];
      newPrev.push({ id: p.id, assignedAt: p.assignedAt });
    } else {
      newPrev.push(emptySlot());
    }
    newOut.push(emptySlot());
  }
  return [newPrev, newOut];
}

/** Shallow field copies for exposing slots without leaking mutable buffer objects. */
export function copyTalkerSlots(slots: readonly TalkerSlot[]): TalkerSlot[] {
  const out: TalkerSlot[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    out.push({ id: s.id, assignedAt: s.assignedAt });
  }
  return out;
}

function isDevBuild(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return false;
  return true;
}

function emptySlot(): TalkerSlot {
  return { id: null, assignedAt: 0 };
}

/**
 * Best unassigned talker by strict `>` rate; equal rates keep the first seen in `byId` iteration.
 * @internal Exported for tests (call-count / allocation guard).
 */
export function pickBestUnassigned(
  byId: ReadonlyMap<string, SlotTalker>,
  occupied: ReadonlySet<string>,
): string | null {
  talkerSlotStats.pickBestUnassignedCalls++;
  let bestId: string | null = null;
  let bestRate = -Infinity;
  for (const [id, t] of byId) {
    if (occupied.has(id)) continue;
    if (!bestId || t.rate > bestRate) {
      bestId = id;
      bestRate = t.rate;
    }
  }
  return bestId;
}

/**
 * Assign talkers into `out` from `prev` using live `byId` (refilled in host order each step).
 */
export function assignTalkerSlots(
  byId: ReadonlyMap<string, SlotTalker>,
  prev: readonly TalkerSlot[],
  out: TalkerSlot[],
  scratch: TalkerSlotScratch,
  simTime: number,
): void {
  if (out === prev) {
    if (isDevBuild()) {
      throw new Error("assignTalkerSlots: out must not be the same array as prev");
    }
    return;
  }
  if (out.length !== prev.length) {
    if (isDevBuild()) {
      throw new Error("assignTalkerSlots: out.length must equal prev.length");
    }
    return;
  }

  const cap = out.length;
  const { rules } = scratch;
  const internal = scratch as ScratchInternal;
  const occ = internal.occupied;

  for (let i = 0; i < cap; i++) {
    const o = out[i];
    const p = prev[i];
    if (!p?.id) {
      o.id = null;
      o.assignedAt = 0;
      continue;
    }
    if (!byId.has(p.id)) {
      o.id = null;
      o.assignedAt = 0;
      continue;
    }
    o.id = p.id;
    o.assignedAt = p.assignedAt;
  }

  occ.clear();
  for (let i = 0; i < cap; i++) {
    const s = out[i];
    if (s.id) occ.add(s.id);
  }

  for (let i = 0; i < cap; i++) {
    if (out[i].id) continue;
    talkerSlotStats.emptySlotSearches++;
    const id = pickBestUnassigned(byId, occ);
    if (!id) break;
    const t = byId.get(id)!;
    out[i].id = id;
    out[i].assignedAt = simTime;
    occ.add(id);
    void t;
  }

  for (let i = 0; i < cap; i++) {
    const s = out[i];
    if (!s.id) continue;
    const incumbent = byId.get(s.id);
    if (!incumbent) continue;
    if (simTime - s.assignedAt < rules.holdS) continue;

    let bestId: string | null = null;
    let bestRate = -Infinity;
    for (const [id, t] of byId) {
      talkerSlotStats.challengerScans++;
      if (occ.has(id)) continue;
      if (t.rate >= incumbent.rate * rules.challengerMargin) {
        if (!bestId || t.rate > bestRate) {
          bestId = id;
          bestRate = t.rate;
        }
      }
    }
    if (bestId) {
      occ.delete(s.id);
      out[i].id = bestId;
      out[i].assignedAt = simTime;
      occ.add(bestId);
    }
  }
}

export function slottedTalkerIds(slots: readonly TalkerSlot[]): string[] {
  const ids: string[] = [];
  for (const s of slots) if (s.id) ids.push(s.id);
  return ids;
}

export function talkerRate(byId: ReadonlyMap<string, SlotTalker>, slot: TalkerSlot): number {
  if (!slot.id) return 0;
  return byId.get(slot.id)?.rate ?? 0;
}
