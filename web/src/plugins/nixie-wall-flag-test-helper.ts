import { monoMs } from "../core/viz-time";
import { clearDevWallFlagClock, setDevWallFlagClock } from "./nixie-wall-parts";

/** Test-only stand-in for 52b `applyDevVizWallFlagsOnBuild` wall-clock flag parsing. */
export function applyNixieWallClockQuery(query: string): void {
  clearDevWallFlagClock();
  const m = query.match(/vizWallClock=([^&]+)/);
  if (!m) return;
  const parts = m[1].split(":").map((x) => Number(x));
  setDevWallFlagClock(parts[0] ?? 0, parts[1] ?? 0, monoMs(0));
}
