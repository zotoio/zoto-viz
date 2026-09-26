import { wallPartsFromMs } from "./nixie-wall-clock";

/** IANA zone for nixie wall digit formatting; default = host local. */
let displayTimeZone: string | undefined;

export function nixieWallDisplayTimeZone(): string | undefined {
  return displayTimeZone;
}

export function setNixieWallDisplayTimeZone(timeZone: string | undefined): void {
  displayTimeZone = timeZone;
}

export function resetNixieWallDisplayTimeZone(): void {
  displayTimeZone = undefined;
}

/** Host local IANA zone (cached). */
export function hostLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Epoch ms for wall clock parts in `timeZone` on a fixed calendar day (dogfood anchor). */
export function wallEpochMsForParts(
  year: number,
  month: number,
  day: number,
  h: number,
  min: number,
  sec: number,
  timeZone: string,
): number {
  const base = Date.UTC(year, month - 1, day);
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const wantDay = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  for (let off = -86_400; off <= 86_400 * 2; off++) {
    const ms = base + off * 1000;
    const d = new Date(ms);
    const dayParts = dayFmt.formatToParts(d);
    const y = dayParts.find((p) => p.type === "year")?.value;
    const mo = dayParts.find((p) => p.type === "month")?.value;
    const da = dayParts.find((p) => p.type === "day")?.value;
    const isoDay = `${y}-${mo}-${da}`;
    if (isoDay !== wantDay) continue;
    const parts = wallPartsFromMs(ms, timeZone);
    if (parts.h === h && parts.m === min && parts.s === sec) return ms;
  }
  return base;
}
