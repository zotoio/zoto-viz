import { setVizWallClockInjector } from "./viz-clock";

/** DEV-only `?vizWallClock=HH:MM` (24h local interpret as UTC wall for dogfood shots). */
export function applyDevVizWallClockQuery(search: string): void {
  if (!import.meta.env.DEV) return;
  const raw = new URLSearchParams(search).get("vizWallClock");
  if (!raw) return;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return;
  const base = Date.UTC(2024, 5, 15, h, min, 0, 0);
  setVizWallClockInjector(() => base);
}
