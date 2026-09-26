/** User-facing copy for blocked-zip retry (keep aligned with service/pack_install_retry.py). */

export const PACK_RETRY_BUTTON_IDLE = "Retry";
export const PACK_RETRY_BUTTON_BUSY = "Retrying…";

export type PackInstallRetryResult =
  | "success"
  | "start_failed"
  | "zip_changed"
  | "in_progress"
  | "not_blocked";

export function packLabel(name: string | undefined, id?: string): string {
  const label = (name || id || "Plugin").trim();
  return label || "Plugin";
}

export function packRetryStartFailedMessage(name: string | undefined, version: string | number = 2): string {
  const label = packLabel(name);
  const ver = String(version).trim() || "2";
  return `${label} v${ver} still couldn't start, so v1 is still active`;
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
