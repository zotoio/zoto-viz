import type { NixieLook } from "../../../shared/nixie-tubes";
import {
  createNixieWallClock,
  type NixieWallClock,
  wallPartsFromMs,
} from "./nixie-wall-clock";
import { packNixieWallBuffer } from "./nixie-wall-clock";

/** One wall-clock format per second for every nixie tile on the wall. */
export class SharedNixieWallSecond {
  private lastSec = -1;
  private cachedH = 0;
  private cachedM = 0;
  private cachedS = 0;
  wallReads = 0;

  reset(): void {
    this.lastSec = -1;
    this.wallReads = 0;
  }

  /** Advance shared wall parts; increments {@link wallReads} once per new wall second. */
  syncWallSecond(wallMs: number, timeZone?: string): { h: number; m: number; s: number } {
    const sec = Math.floor(wallMs / 1000);
    if (sec !== this.lastSec || this.lastSec < 0) {
      this.lastSec = sec;
      this.wallReads++;
      const parts = wallPartsFromMs(wallMs, timeZone);
      this.cachedH = parts.h;
      this.cachedM = parts.m;
      this.cachedS = parts.s;
    }
    return { h: this.cachedH, m: this.cachedM, s: this.cachedS };
  }
}

interface NixieTileDrive {
  readonly id: string;
  readonly clock: NixieWallClock;
  uploads: number;
  lastUploadH: number;
  lastUploadM: number;
  lastUploadS: number;
}

export interface NixieWallBroadcast {
  readonly shared: SharedNixieWallSecond;
  readonly tiles: readonly NixieTileDrive[];
  reset(): void;
  /** One host frame at 60 fps; returns total uploads this frame. */
  frame(
    frameIndex: number,
    wallMs: number,
    lookByTile: (id: string) => NixieLook,
    upload: (tileId: string, data: number[]) => void,
    timeZone?: string,
  ): number;
}

export function createNixieWallBroadcast(tileIds: readonly string[]): NixieWallBroadcast {
  const shared = new SharedNixieWallSecond();
  const tiles: NixieTileDrive[] = tileIds.map((id) => ({
    id,
    clock: createNixieWallClock(),
    uploads: 0,
    lastUploadH: -1,
    lastUploadM: -1,
    lastUploadS: -1,
  }));

  return {
    shared,
    tiles,
    reset() {
      shared.reset();
      for (const t of tiles) t.uploads = 0;
    },
    frame(frameIndex, wallMs, lookByTile, upload, timeZone) {
      const parts = shared.syncWallSecond(wallMs, timeZone);
      let n = 0;
      for (const tile of tiles) {
        const look = lookByTile(tile.id);
        const data = tile.clock.tick(wallMs, look, 0, 0, undefined, parts);
        const timeChanged = look.seconds
          ? parts.s !== tile.lastUploadS || parts.m !== tile.lastUploadM || parts.h !== tile.lastUploadH
          : parts.m !== tile.lastUploadM || parts.h !== tile.lastUploadH;
        const first = tile.lastUploadH < 0;
        if (first || timeChanged) {
          tile.lastUploadH = parts.h;
          tile.lastUploadM = parts.m;
          tile.lastUploadS = parts.s;
          tile.uploads++;
          n++;
          upload(tile.id, data);
        }
      }
      return n;
    },
  };
}

/** Revert F1: upload every wall-second tick even when digits unchanged. */
export function nixieWallBroadcastRevertOnSecond(
  broadcast: NixieWallBroadcast,
  frameIndex: number,
  wallMs: number,
  lookByTile: (id: string) => NixieLook,
  upload: (tileId: string, data: number[]) => void,
  timeZone?: string,
): number {
  const parts = broadcast.shared.syncWallSecond(wallMs, timeZone);
  const secTick = frameIndex % 60 === 0;
  let n = 0;
  for (const tile of broadcast.tiles) {
    const data = tile.clock.tick(wallMs, lookByTile(tile.id), 0, 0, undefined, parts);
    if (secTick) {
      tile.uploads++;
      n++;
      upload(tile.id, data);
    }
  }
  return n;
}

export { packNixieWallBuffer };
