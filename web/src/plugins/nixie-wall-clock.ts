import { vizWallMs } from "../core/viz-clock";
import {
  type NixieLook,
  clamp,
  parseNixieLook,
} from "../../../shared/nixie-tubes";

export const NIXIE_SIM_TICKS_PER_FRAME = 5000;

/** Packed slot value: tube draws blank (12h leading zero suppression). */
export const NIXIE_DIGIT_BLANK = -1;

/** Dogfood N1: wall ms from integer ticks (5000 ticks per frame, 300 ticks/ms). */
export function nixieSimWallMs(t0Ms: number, frameIndex: number): number {
  return t0Ms + Math.floor((frameIndex * NIXIE_SIM_TICKS_PER_FRAME) / 300);
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterForZone(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? "local";
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    formatterCache.set(key, fmt);
  }
  return fmt;
}

export function wallPartsFromMs(wallMs: number, timeZone?: string): { h: number; m: number; s: number; ms: number } {
  const fmt = formatterForZone(timeZone);
  const parts = fmt.formatToParts(new Date(wallMs));
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: pick("hour"), m: pick("minute"), s: pick("second"), ms: wallMs % 1000 };
}

/** 24-hour wall hour → display hour (12h uses 1–12). */
export function hourForDisplay(h24: number, hour12: boolean): number {
  if (!hour12) return h24;
  const h = h24 % 12;
  return h === 0 ? 12 : h;
}

export function digitsFromParts(
  h24: number,
  m: number,
  s: number,
  hour12: boolean,
): [number, number, number, number, number, number] {
  const hour = hourForDisplay(h24, hour12);
  const h10 = hour12 && hour >= 1 && hour <= 9
    ? NIXIE_DIGIT_BLANK
    : Math.floor(hour / 10);
  const h1 = hour % 10;
  return [
    h10, h1,
    Math.floor(m / 10), m % 10,
    Math.floor(s / 10), s % 10,
  ];
}

export function digitsFromWallMs(
  wallMs: number,
  look: NixieLook,
  timeZone?: string,
): [number, number, number, number, number, number] {
  const { h, m, s } = wallPartsFromMs(wallMs, timeZone);
  return digitsFromParts(h, m, s, look.hour12);
}

export interface NixieWallClock {
  readonly digitBuffer: number[];
  readonly formatCalls: number;
  tick(
    wallMs: number,
    look: NixieLook,
    audio?: number,
    pulse?: number,
    canvas?: { w: number; h: number },
    wallParts?: { h: number; m: number; s: number },
  ): number[];
}

export function createNixieWallClock(timeZone?: string, canvas: { w: number; h: number } = { w: 1280, h: 800 }): NixieWallClock {
  const digitBuffer = new Array<number>(15).fill(0);
  let lastSecond = -1;
  let formatCalls = 0;
  let cachedH = 0;
  let cachedM = 0;
  let cachedS = 0;
  const clock: NixieWallClock = {
    get digitBuffer() { return digitBuffer; },
    get formatCalls() { return formatCalls; },
    tick(wallMs, look, audio = 0, pulse = 0, size = canvas, wallParts?) {
      const sec = Math.floor(wallMs / 1000);
      if (wallParts) {
        if (sec !== lastSecond || lastSecond < 0) lastSecond = sec;
        cachedH = wallParts.h;
        cachedM = wallParts.m;
        cachedS = wallParts.s;
      } else if (sec !== lastSecond || lastSecond < 0) {
        lastSecond = sec;
        formatCalls++;
        const parts = wallPartsFromMs(wallMs, timeZone);
        cachedH = parts.h;
        cachedM = parts.m;
        cachedS = parts.s;
      }
      const d = digitsFromParts(cachedH, cachedM, cachedS, look.hour12);
      digitBuffer[0] = d[0];
      digitBuffer[1] = d[1];
      digitBuffer[2] = d[2];
      digitBuffer[3] = d[3];
      digitBuffer[4] = d[4];
      digitBuffer[5] = d[5];
      digitBuffer[6] = wallMs % 1000 < 500 ? 1 : 0;
      digitBuffer[7] = look.seconds ? 1 : 0;
      digitBuffer[8] = look.glow;
      digitBuffer[9] = look.flicker;
      digitBuffer[10] = clamp(audio, 0, 1);
      digitBuffer[11] = size.w;
      digitBuffer[12] = size.h;
      digitBuffer[13] = look.hour12 ? 1 : 0;
      digitBuffer[14] = clamp(pulse, 0, 1);
      return digitBuffer;
    },
  };
  return clock;
}

export function resetNixieFormatterCache(): void {
  formatterCache.clear();
}

/** Host path: pack slot 0 from wall ms without per-frame digit allocations. */
export function packNixieWallBuffer(
  clock: NixieWallClock,
  look: NixieLook = parseNixieLook(),
  audio = 0,
  pulse = 0,
  canvas?: { w: number; h: number },
): number[] {
  return clock.tick(vizWallMs(), look, audio, pulse, canvas);
}
