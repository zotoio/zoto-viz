import { apiFetch } from "../core/http";
import type { DemoSnapshotPayload } from "./remix-types";

const cache = new Map<string, DemoSnapshotPayload>();

function cacheKey(pluginId: string, sourceId: string): string {
  return `${pluginId}::${sourceId}`;
}

/**
 * TODO(live-fetch): Andrew chooses (a) Python service fetch after #103 consent on declared hosts,
 * or (b) pack-side fetch with widened connect-src under #122 sandbox CSP. Until then, demo JSON only.
 */
export async function loadRemixDemoSnapshot(
  dataPluginId: string,
  sourceId: string,
): Promise<DemoSnapshotPayload> {
  const hit = cache.get(cacheKey(dataPluginId, sourceId));
  if (hit) return hit;
  const r = await apiFetch(
    `/api/plugins/${encodeURIComponent(dataPluginId)}/data-source/${encodeURIComponent(sourceId)}/demo`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new Error(`demo snapshot ${r.status}`);
  const payload = await r.json() as DemoSnapshotPayload;
  if (payload?.demo !== true) throw new Error("response is not demo data");
  cache.set(cacheKey(dataPluginId, sourceId), payload);
  return payload;
}

export function clearRemixDemoCache(): void {
  cache.clear();
}
