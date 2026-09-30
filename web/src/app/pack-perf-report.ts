import { apiFetch } from "../core/http";
import { notePackHostPresentInterval, packHostPerfSnapshot, packPerfEnabled } from "../core/pack-host-perf";

let lastPost = 0;
const POST_MS = 2000;
/** Gate evaluations (tests: prove the per-frame callers ran). Integer bumps, no reads. */
let presentGateRuns = 0;
let reportGateRuns = 0;

export function packPerfReportGateRunsForTests(): { present: number; report: number } {
  return { present: presentGateRuns, report: reportGateRuns };
}

export function resetPackPerfReportGateRunsForTests(): void {
  presentGateRuns = 0;
  reportGateRuns = 0;
}

/** main.ts present listener's pack-perf step: cached gate, present interval, throttled report. */
export function notePackPerfPresent(ts: number, presentInterval: () => number): void {
  presentGateRuns++;
  if (!packPerfEnabled()) return;
  const dt = presentInterval();
  if (dt > 0) notePackHostPresentInterval(dt);
  void maybeReportPackHostPerf(ts);
}

export async function maybeReportPackHostPerf(now = performance.now()): Promise<void> {
  reportGateRuns++;
  if (!packPerfEnabled()) return;
  if (now - lastPost < POST_MS) return;
  lastPost = now;
  const snap = packHostPerfSnapshot(now);
  try {
    await apiFetch("/api/pack-perf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snap),
    });
  } catch {
    /* loopback monitor may be offline in unit tests */
  }
}

export async function fetchPackHostPerfRemote(): Promise<Record<string, unknown> | null> {
  try {
    const res = await apiFetch("/api/pack-perf");
    if (!res.ok) return null;
    return await res.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}
