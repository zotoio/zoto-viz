import type { Packet } from "../core/types";

/** Shipped with `plugins/src/tetris/visualisation.yml` → `workBudget.maxPacketsPerFrame`. */
export const TETRIS_MAX_PACKETS_PER_FRAME = 8;

/** Caps idle/live packet delivery per frame and accumulates HUD skips (marble-run parity). */
export class TetrisTrafficBudget {
  hudSkips = 0;
  delivered = 0;

  reset(): void {
    this.hudSkips = 0;
    this.delivered = 0;
  }

  deliver(fresh: Packet[]): Packet[] {
    if (!fresh.length) return [];
    const take = Math.min(fresh.length, TETRIS_MAX_PACKETS_PER_FRAME);
    const skipped = fresh.length - take;
    this.hudSkips += skipped;
    this.delivered += take;
    return fresh.slice(0, take);
  }
}
