import { TILE_LOAD_GRACE_MS, resetTileHealthProgress, type PerTileHealthState } from "./tile-health";

export interface TileExemptInput {
  tabVisible: boolean;
  onScreen: boolean;
  awaitingApproval: boolean;
  graceUntil: number;
  now: number;
}

export function tileHealthExempt(input: TileExemptInput): boolean {
  if (!input.tabVisible) return true;
  if (!input.onScreen) return true;
  if (input.awaitingApproval) return true;
  if (input.now < input.graceUntil) return true;
  return false;
}

export function applyTileExemptReset(
  state: PerTileHealthState,
  input: TileExemptInput,
): PerTileHealthState {
  if (!tileHealthExempt(input)) return state;
  return resetTileHealthProgress(state);
}

export function graceUntilFrom(now: number, ms = TILE_LOAD_GRACE_MS): number {
  return now + ms;
}
