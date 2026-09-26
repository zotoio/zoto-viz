/**
 * Test-only sort-based reference for {@link assignTalkerSlots} parity checks.
 * Do not import from pack code.
 */
import type { SlotTalker, TalkerSlot, TalkerSlotRules, TalkerSlotScratch } from "./talker-slots";
import { TALKER_SLOT_CHALLENGER_MARGIN, TALKER_SLOT_HOLD_S } from "./talker-slots";

const DEFAULT_RULES: TalkerSlotRules = {
  holdS: TALKER_SLOT_HOLD_S,
  challengerMargin: TALKER_SLOT_CHALLENGER_MARGIN,
};

function emptySlot(): TalkerSlot {
  return { id: null, assignedAt: 0 };
}

function pickBestUnassignedRef(
  byId: ReadonlyMap<string, SlotTalker>,
  occupied: ReadonlySet<string>,
): string | null {
  const candidates: { id: string; rate: number }[] = [];
  for (const [id, t] of byId) {
    if (!occupied.has(id)) candidates.push({ id, rate: t.rate });
  }
  candidates.sort((a, b) => b.rate - a.rate);
  return candidates[0]?.id ?? null;
}

/** Mirrors production rules using sorts instead of linear scans (reference only). */
export function assignTalkerSlotsReference(
  byId: ReadonlyMap<string, SlotTalker>,
  prev: readonly TalkerSlot[],
  out: TalkerSlot[],
  scratch: TalkerSlotScratch,
  simTime: number,
): void {
  const cap = out.length;
  const rules = { ...DEFAULT_RULES, ...scratch.rules };
  const occ = new Set<string>();

  for (let i = 0; i < cap; i++) {
    const p = prev[i];
    if (!p?.id || !byId.has(p.id)) out[i] = emptySlot();
    else out[i] = { id: p.id, assignedAt: p.assignedAt };
  }

  for (let i = 0; i < cap; i++) {
    const s = out[i];
    if (s.id) occ.add(s.id);
  }

  for (let i = 0; i < cap; i++) {
    if (out[i].id) continue;
    const id = pickBestUnassignedRef(byId, occ);
    if (!id) break;
    out[i] = { id, assignedAt: simTime };
    occ.add(id);
  }

  for (let i = 0; i < cap; i++) {
    const s = out[i];
    if (!s.id) continue;
    const incumbent = byId.get(s.id);
    if (!incumbent) continue;
    if (simTime - s.assignedAt < rules.holdS) continue;

    const challengers: { id: string; rate: number }[] = [];
    for (const [id, t] of byId) {
      if (occ.has(id)) continue;
      if (t.rate >= incumbent.rate * rules.challengerMargin) challengers.push({ id, rate: t.rate });
    }
    challengers.sort((a, b) => b.rate - a.rate);
    const bestId = challengers[0]?.id;
    if (bestId) {
      occ.delete(s.id);
      out[i] = { id: bestId, assignedAt: simTime };
      occ.add(bestId);
    }
  }
}
