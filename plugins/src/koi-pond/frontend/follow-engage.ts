/**
 * Occasional follow-fish engagement for the koi pond.
 * Most of the time the stage camera drifts; periodically we engage follow for a dwell
 * window, then release back to drift — never always-on.
 */
export const KOI_FOLLOW_ENGAGE = {
  /** Mean seconds between follow engagements while drifting. */
  periodSec: 28,
  /** How long a follow bout lasts once engaged. */
  boutSec: 11,
  /** Random jitter (±) on period and bout. */
  jitter: 0.35,
} as const;

export type FollowEngageState = {
  /** Absolute sim time when the current (or next) bout starts. */
  nextStart: number;
  /** Absolute sim time when the current bout ends (0 when drifting). */
  boutEnd: number;
  engaged: boolean;
};

export function newFollowEngage(seed = 0.37): FollowEngageState {
  const period = KOI_FOLLOW_ENGAGE.periodSec * (1 + (seed - 0.5) * KOI_FOLLOW_ENGAGE.jitter);
  return { nextStart: period * 0.4, boutEnd: 0, engaged: false };
}

function jittered(base: number, u: number): number {
  return base * (1 + (u - 0.5) * 2 * KOI_FOLLOW_ENGAGE.jitter);
}

/** Advance engage state; returns whether follow should drive the camera this frame. */
export function stepFollowEngage(state: FollowEngageState, simT: number, rand: () => number): boolean {
  if (state.engaged) {
    if (simT >= state.boutEnd) {
      state.engaged = false;
      state.nextStart = simT + jittered(KOI_FOLLOW_ENGAGE.periodSec, rand());
      state.boutEnd = 0;
    }
    return state.engaged;
  }
  if (simT >= state.nextStart) {
    state.engaged = true;
    state.boutEnd = simT + jittered(KOI_FOLLOW_ENGAGE.boutSec, rand());
  }
  return state.engaged;
}
