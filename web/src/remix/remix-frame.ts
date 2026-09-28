import type { MonoMs } from "../core/viz-time";
import type { VizDataFrame } from "../plugins/viz-host";
import { loadRemixDemoSnapshot } from "./remix-fetch";
import { mergeDemoSnapshotIntoFrame } from "./remix-snapshot";
import type { DemoSnapshotPayload, RemixPairing } from "./remix-types";

let cachedKey = "";
let cachedFrame: VizDataFrame | null = null;

function pairingKey(p: RemixPairing): string {
  return `${p.dataPluginId}:${p.sourceId}:${p.visualPackId}`;
}

export function resetRemixFrameCache(): void {
  cachedFrame = null;
  cachedKey = "";
}

/** Build a viz frame from the remix pairing's demo snapshot (no live network). */
export async function ensureRemixFrame(
  pairing: RemixPairing,
  prevClockMs: MonoMs,
  audio: number,
): Promise<VizDataFrame> {
  const key = pairingKey(pairing);
  if (cachedFrame && cachedKey === key) {
    return { ...cachedFrame, t: prevClockMs / 1000, audio: cachedFrame.audio * 0.7 + audio * 0.3 };
  }
  const payload = await loadRemixDemoSnapshot(pairing.dataPluginId, pairing.sourceId);
  const frame = mergeDemoSnapshotIntoFrame(payload, prevClockMs, audio);
  cachedFrame = frame;
  cachedKey = key;
  return frame;
}

export function remixFrameFromPayload(
  payload: DemoSnapshotPayload,
  prevClockMs: MonoMs,
  audio: number,
): VizDataFrame {
  return mergeDemoSnapshotIntoFrame(payload, prevClockMs, audio);
}
