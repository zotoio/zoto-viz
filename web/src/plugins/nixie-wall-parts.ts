import type { MonoMs } from "../core/viz-time";

/** Reused wall parts for every nixie tile on the wall (one formatter path). */
export const nixieWallPartsScratch = { h: 0, m: 0, s: 0 };

/** Real wall clock: local `Date` fields (no epoch math for display). */
export function localWallPartsFromDate(d: Date): { h: number; m: number; s: number } {
  return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
}

export function fillRealWallPartsScratch(wallMs?: number): typeof nixieWallPartsScratch {
  const d = wallMs !== undefined ? new Date(wallMs) : new Date();
  const p = localWallPartsFromDate(d);
  nixieWallPartsScratch.h = p.h;
  nixieWallPartsScratch.m = p.m;
  nixieWallPartsScratch.s = p.s;
  return nixieWallPartsScratch;
}

let flagStartH = 0;
let flagStartM = 0;
let flagAnchorMono: MonoMs = 0 as MonoMs;
let flagWallActive = false;

export function setDevWallFlagClock(h: number, m: number, anchorMono: MonoMs): void {
  flagStartH = h;
  flagStartM = m;
  flagAnchorMono = anchorMono;
  flagWallActive = true;
}

export function clearDevWallFlagClock(): void {
  flagWallActive = false;
}

export function devWallFlagClockActive(): boolean {
  return flagWallActive;
}

/** Dev `?vizWallClock=HH:MM`: HH:MM:00 + whole seconds from frame mono; wraps at 24h. No `Date`. */
export function fillDevWallFlagPartsScratch(mono: MonoMs): typeof nixieWallPartsScratch {
  const elapsed = Math.floor((Number(mono) - Number(flagAnchorMono)) / 1000);
  let total = flagStartH * 3600 + flagStartM * 60 + elapsed;
  total = ((total % 86_400) + 86_400) % 86_400;
  nixieWallPartsScratch.h = Math.floor(total / 3600);
  nixieWallPartsScratch.m = Math.floor((total % 3600) / 60);
  nixieWallPartsScratch.s = total % 60;
  return nixieWallPartsScratch;
}

export function wallSecondKeyFromScratch(): number {
  return nixieWallPartsScratch.h * 3600 + nixieWallPartsScratch.m * 60 + nixieWallPartsScratch.s;
}
