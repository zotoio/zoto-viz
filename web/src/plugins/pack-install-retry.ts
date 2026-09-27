import { apiFetch } from "../core/http";
import type { BlockedCatalogEntry } from "./pack-install-surface";
import {
  blockedCatalogEntries,
  removeBlockedCatalogEntryBySha,
  syncBlockedCatalogFromErrors,
  updateBlockedCatalogEntryBySha,
} from "./pack-install-surface";
import {
  PACK_RETRY_BUTTON_BUSY,
  PACK_RETRY_BUTTON_IDLE,
  type PackInstallRetryResult,
  packRetryStartFailedMessage,
  packRetrySuccessHistoryMessage,
  packRetryZipChangedMessage,
} from "./pack-install-retry-copy";

export type PackInstallRetryApiBody = {
  ok?: boolean;
  retryResult?: PackInstallRetryResult | string;
  error?: string;
  name?: string;
  id?: string;
  version?: string | number;
  message?: string;
  zipSha256?: string;
};

const retryInFlight = new Set<string>();
const installHistory: string[] = [];

export function packInstallHistory(): readonly string[] {
  return installHistory;
}

export function isPackRetryInFlight(zipSha256: string): boolean {
  return retryInFlight.has(zipSha256.toLowerCase());
}

export function packRetryButtonState(zipSha256: string): { disabled: boolean; label: string } {
  const sha = zipSha256.toLowerCase();
  if (retryInFlight.has(sha)) {
    return { disabled: true, label: PACK_RETRY_BUTTON_BUSY };
  }
  return { disabled: false, label: PACK_RETRY_BUTTON_IDLE };
}

export function blockedRecordDisplayMessage(entry: BlockedCatalogEntry): string {
  if (entry.message) return entry.message;
  const name = entry.name || entry.id;
  return packRetryZipChangedMessage(name, entry.id);
}

export function parseRetryResult(body: PackInstallRetryApiBody): PackInstallRetryResult | null {
  const raw = body.retryResult;
  if (
    raw === "success"
    || raw === "start_failed"
    || raw === "zip_changed"
    || raw === "in_progress"
    || raw === "not_blocked"
  ) {
    return raw;
  }
  return null;
}

/** Apply a retry API response to blocked catalog + history (no toast). */
export function applyPackInstallRetryResponse(
  zipSha256: string,
  status: number,
  body: PackInstallRetryApiBody,
): PackInstallRetryResult | null {
  const sha = zipSha256.toLowerCase();
  const fromBody = parseRetryResult(body);
  const result: PackInstallRetryResult | null = fromBody
    ?? (body.ok ? "success" : null)
    ?? ((status === 423 || (status === 409 && body.error === "retry_in_progress")) ? "in_progress" : null);

  if (result === "success" || body.ok) {
    const name = body.name || body.id;
    const ver = body.version ?? 2;
    removeBlockedCatalogEntryBySha(sha);
    installHistory.push(packRetrySuccessHistoryMessage(name, ver));
    return "success";
  }
  if (result === "start_failed") {
    const name = body.name || body.id;
    const ver = body.version ?? 2;
    const message = body.message || packRetryStartFailedMessage(name, ver);
    updateBlockedCatalogEntryBySha(sha, { message, retryable: "true" });
    return "start_failed";
  }
  if (result === "zip_changed") {
    const name = body.name || body.id;
    const message = body.message || packRetryZipChangedMessage(name, body.id);
    updateBlockedCatalogEntryBySha(sha, { message, retryable: "true" });
    return "zip_changed";
  }
  if (result === "in_progress") {
    return "in_progress";
  }
  return result;
}

export async function submitPackInstallRetry(zipSha256: string): Promise<PackInstallRetryResult | null> {
  const sha = zipSha256.toLowerCase();
  if (retryInFlight.has(sha)) return "in_progress";
  retryInFlight.add(sha);
  try {
    const r = await apiFetch("/api/ai/plugin/local/blocked/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha256: sha }),
    });
    const body = (await r.json()) as PackInstallRetryApiBody;
    return applyPackInstallRetryResponse(sha, r.status, body);
  } finally {
    retryInFlight.delete(sha);
  }
}

export function blockedRetryableEntries(): BlockedCatalogEntry[] {
  return blockedCatalogEntries().filter((e) => e.retryable === "true" && e.zipSha256);
}

export { syncBlockedCatalogFromErrors };
