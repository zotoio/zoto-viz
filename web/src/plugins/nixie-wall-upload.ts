import type { NixieLook } from "../../../shared/nixie-tubes";

/** Per-tile latch for nixie buffer uploads (production mosaic + main). */
export interface NixieUploadLatch {
  lastH: number;
  lastM: number;
  lastS: number;
}

export function createNixieUploadLatch(): NixieUploadLatch {
  return { lastH: -1, lastM: -1, lastS: -1 };
}

/** True when wall time (per look.seconds) changed since last upload for this tile. */
export function nixieWallUploadDue(
  look: NixieLook,
  parts: { h: number; m: number; s: number },
  latch: NixieUploadLatch,
): boolean {
  const timeChanged = look.seconds
    ? parts.s !== latch.lastS || parts.m !== latch.lastM || parts.h !== latch.lastH
    : parts.m !== latch.lastM || parts.h !== latch.lastH;
  const first = latch.lastH < 0;
  if (!first && !timeChanged) return false;
  latch.lastH = parts.h;
  latch.lastM = parts.m;
  latch.lastS = parts.s;
  return true;
}
