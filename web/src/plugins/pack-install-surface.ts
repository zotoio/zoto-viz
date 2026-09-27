/** Surface pack install / bundle boundary failures in the open UI. */

export type PackInstallBlockedPayload = {
  ok?: false;
  error: "pack_boundary" | string;
  id?: string;
  name?: string;
  file?: string;
  import?: string;
  message?: string;
  hint?: string;
  zip?: string;
  zipSha256?: string;
  blockReason?: string;
  retryable?: string;
  upgrade_blocked?: string;
};

export type BlockedCatalogEntry = PackInstallBlockedPayload & {
  zipPath: string;
  zipDir: string;
};

export const PACK_BLOCKED_SELECT_VALUE = "__pack_blocked_catalog__";

let pendingNotice: string | null = null;
const toastedKeys = new Set<string>();
let blockedCatalog: BlockedCatalogEntry[] = [];

function zipPathFromPayload(payload: PackInstallBlockedPayload): string {
  const z = payload.zip || payload.file;
  return z ? String(z) : "";
}

function zipDirname(zipPath: string): string {
  const i = Math.max(zipPath.lastIndexOf("/"), zipPath.lastIndexOf("\\"));
  return i <= 0 ? zipPath : zipPath.slice(0, i);
}

function toastKey(payload: PackInstallBlockedPayload): string {
  const zipPath = zipPathFromPayload(payload);
  const msg = formatPackInstallBlocked(payload);
  return zipPath ? `${zipPath}::${msg}` : msg;
}

function toBlockedEntry(payload: PackInstallBlockedPayload): BlockedCatalogEntry {
  const zipPath = zipPathFromPayload(payload);
  const zipDir = zipPath ? zipDirname(zipPath) : "";
  return { ...payload, zipPath, zipDir };
}

export function blockedCatalogEntries(): readonly BlockedCatalogEntry[] {
  return blockedCatalog;
}

export function isPackInstallBlockedPayload(v: unknown): v is PackInstallBlockedPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as PackInstallBlockedPayload;
  const text = `${o.message ?? ""} ${o.error ?? ""}`;
  return (
    o.error === "pack_boundary"
    || o.error === "pack_sdk_contract"
    || o.error === "pack_install_blocked"
    || o.error === "pack_install_start_failed"
    || o.error === "pack_install_interrupted"
    || text.includes("was blocked")
    || text.includes("v1 is still running")
    || text.includes("v1 was restored")
    || text.includes("was interrupted")
    || text.includes("couldn't start")
    || o.blockReason === "couldnt_start"
    || o.blockReason === "block_record_unreadable"
  );
}

export function formatPackInstallBlocked(payload: PackInstallBlockedPayload): string {
  if (payload.message) return payload.message;
  if (typeof payload.error === "string" && payload.error.includes("was blocked")) return payload.error;
  const name = payload.name || payload.id || "Plugin";
  const file = payload.file ? ` (\`${payload.file}\`)` : "";
  const imp = payload.import ? ` (\`${payload.import}\`)` : "";
  return (
    `${name} was blocked: it imports a file outside its own folder${file}${imp}. `
    + "Nothing was installed and the current wall is unchanged. "
    + "Ask the pack author to run pack lint — see plugins/sdk/starter/README.md#2-pack-lint."
  );
}

export function formatBlockedCatalogNotice(entries: readonly BlockedCatalogEntry[]): string {
  if (!entries.length) return "";
  return entries
    .map((e) => {
      const body = formatPackInstallBlocked(e);
      const folder = e.zipDir ? `\nZip folder: ${e.zipDir}` : "";
      return `${body}${folder}`;
    })
    .join("\n\n");
}

export { submitPackInstallRetry as retryPackInstallBlock } from "./pack-install-retry";

export function syncBlockedCatalogFromErrors(errors: readonly Record<string, unknown>[]): void {
  const next: BlockedCatalogEntry[] = [];
  for (const e of errors) {
    if (!isPackInstallBlockedPayload(e)) continue;
    next.push(toBlockedEntry(e));
  }
  blockedCatalog = next;
}

function entrySha(entry: BlockedCatalogEntry): string {
  return String(entry.zipSha256 || "").toLowerCase();
}

export function updateBlockedCatalogEntryBySha(
  sha256: string,
  patch: Partial<BlockedCatalogEntry>,
): void {
  const sha = sha256.toLowerCase();
  blockedCatalog = blockedCatalog.map((e) => (
    entrySha(e) === sha ? { ...e, ...patch } : e
  ));
}

export function removeBlockedCatalogEntryBySha(sha256: string): void {
  const sha = sha256.toLowerCase();
  blockedCatalog = blockedCatalog.filter((e) => entrySha(e) !== sha);
}

export function queuePackInstallBlockedNotice(payload: PackInstallBlockedPayload): string | null {
  const text = formatPackInstallBlocked(payload);
  const key = toastKey(payload);
  if (!toastedKeys.has(key)) {
    toastedKeys.add(key);
    pendingNotice = text;
    return text;
  }
  return null;
}

export function takePackInstallBlockedNotice(): string | null {
  const out = pendingNotice;
  pendingNotice = null;
  return out;
}

export type PackInstallNotice = { error: string; message: string };

function installNoticeKey(notice: PackInstallNotice): string {
  return `${notice.error}::${notice.message}`;
}

/** Consume server `installNotices` (interrupted restore, failed start, etc.) exactly once each. */
export function consumePackInstallNotices(notices: readonly PackInstallNotice[] | undefined): string[] {
  if (!notices?.length) return [];
  const shown: string[] = [];
  for (const notice of notices) {
    const message = String(notice.message || "").trim();
    if (!message) continue;
    const key = installNoticeKey({ error: String(notice.error || "pack_install"), message });
    if (toastedKeys.has(key)) continue;
    toastedKeys.add(key);
    shown.push(message);
    if (!pendingNotice) pendingNotice = message;
  }
  return shown;
}

export function catalogErrorLooksBlocked(error: string): boolean {
  return (
    error.includes("was blocked")
    || error.includes("pack-bundle-boundary")
    || error.includes("Built for an older zoto-viz SDK")
    || error.includes("v1 is still running")
    || error.includes("v1 was restored")
    || error.includes("was interrupted")
  );
}

export function blockedViewSelectRow(
  entries: readonly BlockedCatalogEntry[],
): { value: string; label: string; hint: string; group: string } | null {
  const n = entries.length;
  if (!n) return null;
  return {
    value: PACK_BLOCKED_SELECT_VALUE,
    label: `Blocked (${n})`,
    hint: "",
    group: "blocked",
  };
}
