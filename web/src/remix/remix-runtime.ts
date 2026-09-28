import type { MonoMs } from "../core/viz-time";
import type { VizDataFrame } from "../plugins/viz-host";
import { resetRemixFrameCache, remixFrameFromPayload } from "./remix-frame";
import { clearRemixDemoCache, loadRemixDemoSnapshot } from "./remix-fetch";
import type { DemoSnapshotPayload, RemixPairing } from "./remix-types";
import { loadRemixPairing, saveRemixPairing as persistPairing, clearRemixPairing as clearStored } from "./remix-store";

let activePairing: RemixPairing | null = loadRemixPairing();
let activePayload: DemoSnapshotPayload | null = null;

export function remixPairingActive(): RemixPairing | null {
  return activePairing;
}

export function remixVisualPackId(): string | null {
  return activePairing?.visualPackId ?? null;
}

export async function activateRemixPairing(pairing: RemixPairing): Promise<void> {
  const payload = await loadRemixDemoSnapshot(pairing.dataPluginId, pairing.sourceId);
  activePairing = pairing;
  activePayload = payload;
  persistPairing(pairing);
  resetRemixFrameCache();
}

export function deactivateRemix(): void {
  activePairing = null;
  activePayload = null;
  clearStored();
  clearRemixDemoCache();
  resetRemixFrameCache();
}

/** Synchronous frame for the viz budget tick (demo snapshot only). */
export function remixDeliverFrame(prevClockMs: MonoMs, audio: number): VizDataFrame | null {
  if (!activePairing || !activePayload) return null;
  return remixFrameFromPayload(activePayload, prevClockMs, audio);
}

/** Boot: prefetch demo JSON for a stored pairing without switching views. */
export async function hydrateRemixFromStorage(): Promise<void> {
  const stored = loadRemixPairing();
  if (!stored) return;
  try {
    await activateRemixPairing(stored);
  } catch (e) {
    console.warn("zoto-viz remix:", e);
    deactivateRemix();
  }
}
