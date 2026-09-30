/** User-facing copy for blocked-zip retry (keep aligned with service/pack_install_retry.py). */

import { packUpdateCopy } from "./pack-install-copy-table";

export const PACK_RETRY_BUTTON_IDLE = "Retry";
export const PACK_RETRY_BUTTON_BUSY = "Retrying…";

export const PACK_INSTALL_RETRY_RESULTS = [
  "success",
  "start_failed",
  "zip_changed",
  "in_progress",
  "not_blocked",
] as const;

export type PackInstallRetryResult = (typeof PACK_INSTALL_RETRY_RESULTS)[number];

export function packLabel(name: string | undefined, id?: string): string {
  const label = (name || id || "Plugin").trim();
  return label || "Plugin";
}

/**
 * #111: Retry ran the install again and the new version failed to start again. The words are the shared
 * table's `updates.retry_couldnt_start` (the service sends the same sentence as `message`); this is the
 * fallback when a response has none. `installedVersion` is the version still in place, if known.
 */
export function packRetryStartFailedMessage(
  name: string | undefined,
  version: string | number | undefined,
  installedVersion?: string | number,
): string {
  return packUpdateCopy("retry_couldnt_start", packLabel(name), version, installedVersion);
}

export function packRetryZipChangedMessage(name: string | undefined, id?: string): string {
  const label = packLabel(name, id);
  return `${label} has changed since it was blocked. It'll be checked again on the next scan.`;
}

export function packRetrySuccessHistoryMessage(name: string | undefined, version: string | number = 2): string {
  const label = packLabel(name);
  const ver = String(version).trim() || "2";
  return `${label} v${ver} installed`;
}

export function packUnreadableBlockRecordsNotice(count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n <= 0) return "";
  if (n === 1) {
    return (
      "1 blocked install record couldn't be read. That pack stays blocked until you use Retry "
      + "or remove the damaged file under ~/.zoto-viz/plugins/local/blocks/."
    );
  }
  return (
    `${n} blocked install records couldn't be read. Those packs stay blocked until you use Retry `
    + "or remove the damaged files under ~/.zoto-viz/plugins/local/blocks/."
  );
}
