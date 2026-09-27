import { vizWallMs } from "../core/viz-clock";
import type { MonoMs } from "../core/viz-time";

/** Reused wall parts for every nixie tile on the wall (one formatter path). */
export const nixieWallPartsScratch = { h: 0, m: 0, s: 0 };

/** One `Date` for real wall display: `setTime` each frame, field reads once per wall second. */
const realWallDate = new Date(0);
let realWallBooted = false;
let realWallLastSecKey = -1;

export function bootNixieRealWallClock(): void {
  realWallBooted = true;
}

export function resetNixieRealWallClockForTests(): void {
  realWallLastSecKey = -1;
  realWallBooted = false;
  nixieWallPartsScratch.h = 0;
  nixieWallPartsScratch.m = 0;
  nixieWallPartsScratch.s = 0;
}

/** Test hook: the singleton wall `Date` (same instance every frame after boot). */
export function nixieRealWallDateSingleton(): Date {
  return realWallDate;
}

/** Real wall clock: local `Date` fields (no epoch math for display). */
export function localWallPartsFromDate(d: Date): { h: number; m: number; s: number } {
  return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
}

export function fillRealWallPartsScratch(wallMs?: number): typeof nixieWallPartsScratch {
  if (!realWallBooted) bootNixieRealWallClock();
  const ms = wallMs !== undefined ? Number(wallMs) : Number(vizWallMs());
  realWallDate.setTime(ms);
  const secKey = Math.floor(ms / 1000);
  if (secKey !== realWallLastSecKey) {
    realWallLastSecKey = secKey;
    const p = localWallPartsFromDate(realWallDate);
    nixieWallPartsScratch.h = p.h;
    nixieWallPartsScratch.m = p.m;
    nixieWallPartsScratch.s = p.s;
  }
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
