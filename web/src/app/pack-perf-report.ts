import { apiFetch } from "../core/http";
import { packHostPerfSnapshot, packPerfEnabled } from "../core/pack-host-perf";

let lastPost = 0;
const POST_MS = 2000;

export async function maybeReportPackHostPerf(now = performance.now()): Promise<void> {
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
