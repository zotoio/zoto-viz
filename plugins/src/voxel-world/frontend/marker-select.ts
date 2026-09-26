import type { FlowMarker } from "./talker-cache";

export const SCREEN_MARKER_SLOTS = 6;

const topSlots: (FlowMarker | null)[] = new Array(SCREEN_MARKER_SLOTS).fill(null);

export function resetTopMarkers(): void {
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) topSlots[i] = null;
}

/** Fixed-size top-N by strength (no sort/spread/map allocations). */
export function considerTopMarker(m: FlowMarker): void {
  if (m.kind <= 0 || m.strength <= 0) return;
  let minI = -1;
  let minS = Infinity;
  let empty = -1;
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const cur = topSlots[i];
    if (!cur) {
      empty = i;
      break;
    }
    if (cur.strength < minS) {
      minS = cur.strength;
      minI = i;
    }
  }
  if (empty >= 0) {
    topSlots[empty] = m;
    return;
  }
  if (minI >= 0 && m.strength > minS) topSlots[minI] = m;
}

export function topMarkerSlots(): readonly (FlowMarker | null)[] {
  return topSlots;
}
