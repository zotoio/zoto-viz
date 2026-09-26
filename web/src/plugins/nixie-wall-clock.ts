import { vizWallMs } from "../core/viz-clock";
import {
  type NixieLook,
  clamp,
  parseNixieLook,
} from "../../../plugins/src/nixie-clock/frontend/tubes";

export const NIXIE_SIM_TICKS_PER_FRAME = 5000;

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
      hour12: false,
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

export function digitsFromWallMs(
  wallMs: number,
  look: NixieLook,
  timeZone?: string,
): [number, number, number, number, number, number] {
  const { h, m, s } = wallPartsFromMs(wallMs, timeZone);
  let hour = h;
  if (look.hour12) {
    hour = hour % 12;
    if (hour === 0) hour = 12;
  }
  return [
    Math.floor(hour / 10), hour % 10,
    Math.floor(m / 10), m % 10,
    Math.floor(s / 10), s % 10,
  ];
}

export interface NixieWallClock {
  readonly digitBuffer: number[];
  readonly formatCalls: number;
  tick(wallMs: number, look: NixieLook, audio?: number, pulse?: number, canvas?: { w: number; h: number }): number[];
}

export function createNixieWallClock(timeZone?: string, canvas: { w: number; h: number } = { w: 1280, h: 800 }): NixieWallClock {
  const digitBuffer = new Array<number>(15).fill(0);
  let lastSecond = -1;
  let formatCalls = 0;
  const clock: NixieWallClock = {
    get digitBuffer() { return digitBuffer; },
    get formatCalls() { return formatCalls; },
    tick(wallMs, look, audio = 0, pulse = 0, size = canvas) {
      const sec = Math.floor(wallMs / 1000);
      if (sec !== lastSecond || lastSecond < 0) {
        lastSecond = sec;
        formatCalls++;
        const d = digitsFromWallMs(wallMs, look, timeZone);
        digitBuffer[0] = d[0];
        digitBuffer[1] = d[1];
        digitBuffer[2] = d[2];
        digitBuffer[3] = d[3];
        digitBuffer[4] = d[4];
        digitBuffer[5] = d[5];
      }
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
