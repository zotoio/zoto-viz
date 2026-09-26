/** Seconds to leave the final stack visible after a top-out before clearing. */
export const TETRIS_TOPOUT_HOLD_S = 2;

export function shouldHoldTopout(now: number, holdUntil: number): boolean {
  return holdUntil > 0 && now < holdUntil;
}

export function topoutHoldExpired(now: number, holdUntil: number): boolean {
  return holdUntil > 0 && now >= holdUntil;
}
