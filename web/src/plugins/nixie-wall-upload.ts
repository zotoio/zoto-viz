import type { NixieLook } from "../../../shared/nixie-tubes";

/** Per-tile latch for nixie buffer uploads (production mosaic + main). */
export interface NixieUploadLatch {
  lastH: number;
  lastM: number;
  lastS: number;
  lookSig: string;
}

export function createNixieUploadLatch(): NixieUploadLatch {
  return { lastH: -1, lastM: -1, lastS: -1, lookSig: "" };
}

function nixieLookSig(look: NixieLook, canvasW: number, canvasH: number): string {
  return `${look.hour12 ? 1 : 0}|${look.seconds ? 1 : 0}|${look.glow}|${look.flicker}|${canvasW}|${canvasH}`;
}

/** True when wall time or look/canvas changed since last upload for this wall latch. */
export function nixieWallUploadDue(
  look: NixieLook,
  parts: { h: number; m: number; s: number },
  latch: NixieUploadLatch,
  canvasW: number,
  canvasH: number,
): boolean {
  const sig = nixieLookSig(look, canvasW, canvasH);
  const timeChanged = look.seconds
    ? parts.s !== latch.lastS || parts.m !== latch.lastM || parts.h !== latch.lastH
    : parts.m !== latch.lastM || parts.h !== latch.lastH;
  const lookChanged = sig !== latch.lookSig;
  const first = latch.lastH < 0;
  if (!first && !timeChanged && !lookChanged) return false;
  latch.lastH = parts.h;
  latch.lastM = parts.m;
  latch.lastS = parts.s;
  latch.lookSig = sig;
  return true;
}
