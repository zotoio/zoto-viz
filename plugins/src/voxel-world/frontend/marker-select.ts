import type { FlowMarker } from "./talker-cache";

export const SCREEN_MARKER_SLOTS = 6;

const MIN_HOLD_S = 2;
const CHALLENGE_MARGIN = 1.2;
const FADE_PER_S = 3.5;

interface IncumbentSlot {
  key: string;
  pickedAt: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  label: number;
  target: number;
  display: number;
}

const incumbents: IncumbentSlot[] = Array.from({ length: SCREEN_MARKER_SLOTS }, () => ({
  key: "",
  pickedAt: -1,
  kind: 0,
  x: 0,
  y: 0,
  z: 0,
  label: 0,
  target: 0,
  display: 0,
}));

const candRefs: (FlowMarker | null)[] = new Array(24).fill(null);
let candCount = 0;

function keyInSlots(key: string): boolean {
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    if (incumbents[i]!.key === key) return true;
  }
  return false;
}

function findCandidate(key: string): FlowMarker | null {
  for (let i = 0; i < candCount; i++) {
    const m = candRefs[i];
    if (m && m.key === key) return m;
  }
  return null;
}

function strongestOpenCandidate(): FlowMarker | null {
  let best: FlowMarker | null = null;
  let bestS = 0;
  for (let i = 0; i < candCount; i++) {
    const m = candRefs[i];
    if (!m || m.kind <= 0 || m.strength <= 0) continue;
    if (keyInSlots(m.key)) continue;
    if (!best || m.strength > bestS) {
      best = m;
      bestS = m.strength;
    }
  }
  return best;
}

function countOpenCandidates(): number {
  let n = 0;
  for (let i = 0; i < candCount; i++) {
    const m = candRefs[i];
    if (!m || m.kind <= 0 || m.strength <= 0) continue;
    if (keyInSlots(m.key)) continue;
    n++;
  }
  return n;
}

/** Defer spare-slot fill when a lone challenger would replace a vanished incumbent. */
function deferSingleChallengerToReplacement(): boolean {
  if (countOpenCandidates() !== 1) return false;
  const challenger = strongestOpenCandidate();
  if (!challenger) return false;
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const s = incumbents[i]!;
    if (!s.key || s.key === challenger.key) continue;
    if (s.target > 0) continue;
    return true;
  }
  return false;
}

function vacatedSlotAfterHold(t: number): number {
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const s = incumbents[i]!;
    if (!s.key) continue;
    if (s.target > 0) continue;
    if (t - s.pickedAt < MIN_HOLD_S) continue;
    return i;
  }
  return -1;
}

function weakestHeldSlot(t: number): number {
  let idx = -1;
  let weak = Infinity;
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const s = incumbents[i]!;
    if (!s.key) continue;
    if (t - s.pickedAt < MIN_HOLD_S) continue;
    if (s.target <= 0) continue;
    const eff = s.target;
    if (eff < weak) {
      weak = eff;
      idx = i;
    }
  }
  return idx;
}

function assignSlot(i: number, m: FlowMarker, t: number): void {
  const s = incumbents[i]!;
  s.key = m.key;
  s.pickedAt = t;
  s.kind = m.kind;
  s.x = m.x;
  s.y = m.y;
  s.z = m.z;
  s.label = m.label;
  s.target = m.strength;
  if (s.display <= 0) s.display = 0;
}

export function resetTopMarkers(): void {
  candCount = 0;
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const s = incumbents[i]!;
    s.key = "";
    s.pickedAt = -1;
    s.kind = 0;
    s.target = 0;
    s.display = 0;
  }
}

export function beginCandidatePass(): void {
  candCount = 0;
}

export function offerMarker(m: FlowMarker): void {
  if (m.kind <= 0 || m.strength <= 0) return;
  if (candCount >= candRefs.length) return;
  candRefs[candCount++] = m;
}

export function commitScreenMarkers(t: number, dt: number): void {
  const fadeStep = Math.min(1, Math.max(0, dt) * FADE_PER_S);

  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const s = incumbents[i]!;
    if (!s.key) continue;
    const live = findCandidate(s.key);
    if (live) {
      s.kind = live.kind;
      s.x = live.x;
      s.y = live.y;
      s.z = live.z;
      s.label = live.label;
      s.target = live.strength;
    } else {
      s.target = 0;
    }
    if (s.display < s.target) s.display = Math.min(s.target, s.display + fadeStep);
    else if (s.display > s.target) s.display = Math.max(s.target, s.display - fadeStep);
    if (s.target <= 0 && s.display <= 0.02) {
      if (t - s.pickedAt >= MIN_HOLD_S) {
        s.key = "";
        s.kind = 0;
        s.pickedAt = -1;
      }
    }
  }

  if (!deferSingleChallengerToReplacement()) {
    for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
      if (incumbents[i]!.key) continue;
      const m = strongestOpenCandidate();
      if (!m) break;
      assignSlot(i, m, t);
      if (incumbents[i]!.display <= 0) incumbents[i]!.display = 0.02;
    }
  }

  const vacI = vacatedSlotAfterHold(t);
  if (vacI >= 0) {
    const m = strongestOpenCandidate();
    if (m) {
      assignSlot(vacI, m, t);
      if (incumbents[vacI]!.display <= 0) incumbents[vacI]!.display = 0.02;
      return;
    }
  }

  const weakI = weakestHeldSlot(t);
  if (weakI < 0) return;
  const challenger = strongestOpenCandidate();
  if (!challenger) return;
  const weak = incumbents[weakI]!;
  if (challenger.strength < weak.target * CHALLENGE_MARGIN) return;
  assignSlot(weakI, challenger, t);
}

export function readScreenMarker(i: number): IncumbentSlot | null {
  const s = incumbents[i];
  if (!s || !s.key || s.display <= 0.01) return null;
  return s;
}

/** For tests: count membership changes in the active key set (order ignored). */
export function screenMarkerMembershipFingerprint(): string {
  const keys: string[] = [];
  for (let i = 0; i < SCREEN_MARKER_SLOTS; i++) {
    const k = incumbents[i]!.key;
    if (k) keys.push(k);
  }
  keys.sort();
  return keys.join("|");
}
