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
  /** #111: stable code next to `error` (e.g. PACK_UPDATE_REFUSED); branch on this, never on `message`. */
  reasonCode?: string;
};

export type BlockedCatalogEntry = PackInstallBlockedPayload & {
  zipPath: string;
  zipDir: string;
};

export const PACK_BLOCKED_SELECT_VALUE = "__pack_blocked_catalog__";

/**
 * #185: the service refused an install because the pack install lint couldn't run (or gave no valid
 * verdict, or timed out). The UI shows the service's message as is:
 * - fresh install: "Couldn't safety-check <Name>, so it wasn't installed. <fix>"
 * - upgrade: "Couldn't safety-check the new version of <Name>, so it wasn't updated. You're still on
 *   version <old>. <fix>" ("The version you had is still installed." when the old version isn't known)
 * where <fix> is "Run `pnpm run prepare` in `web/` and try again." for a missing, stale or unloadable built lint
 * (#186) and "Run `pnpm install` in `web/` and try again." otherwise. The wording is the service's,
 * from web/scripts/pack-install-lint-setup-copy.json; nothing here depends on it.
 */
export const PACK_INSTALL_CHECK_UNAVAILABLE = "pack_install_check_unavailable";

/**
 * #111: the service refused an update and the version you had is still installed (the new version
 * couldn't be checked, or couldn't start and the old one was put back). service/pack_install_copy.py's
 * REASON_UPDATE_REFUSED, carried as `reasonCode`. The surface picks the refused branch from this code
 * alone; the service's message is shown as is and its wording can change without breaking this. When the
 * new version couldn't be safety-checked at all, that message is UX Pro's "Couldn't safety-check the new
 * version of <Name>, so it wasn't updated. You're still on version <old>." ("The version you had is still
 * installed." when the old version isn't known), from the same table as the #185 sentences.
 */
export const PACK_UPDATE_REFUSED = "update_refused";

/**
 * #240: a pack check blocked the install or update ("<Name> was blocked because …", the #185 copy).
 * service/pack_block_copy.py's REASON_PACK_BLOCKED, carried as `reasonCode` the way #111 carries
 * PACK_UPDATE_REFUSED. The surface takes the block from this code alone, never from the words, so the
 * service's copy can be reworded without a block being missed; the message is shown as is.
 */
export const PACK_BLOCKED = "pack_blocked";

/** Row `error` categories; anything else in `error` next to PACK_BLOCKED is the service's own words. */
const PACK_REFUSAL_CATEGORIES = new Set<string>([
  "pack_boundary",
  "pack_sdk_contract",
  "pack_install_blocked",
  "pack_install_start_failed",
  "pack_install_interrupted",
  PACK_INSTALL_CHECK_UNAVAILABLE,
]);

const CHAT_SERVICE_WORDED_ERRORS = new Set<string>([
  PACK_INSTALL_CHECK_UNAVAILABLE,
  "pack_boundary",
  "pack_install_blocked",
]);

/** Agent chat line for a POST /api/ai/plugin/local result (install + activate). */
export function localPluginPublishChatLine(
  d: { ok?: boolean; error?: string; message?: string; id?: string; activated?: boolean; consentRequired?: boolean },
  names: string,
): string {
  if (d.activated) return `plugin ${d.id} built and activated (${names})`;
  if (d.consentRequired) return `plugin ${d.id} installed (${names}) — source review required`;
  // #185: refusals the service words for users (lint couldn't run, lint block, upgrade blocked):
  // show that text unchanged, not "plugin invalid: <code>".
  if (!d.ok && d.message && CHAT_SERVICE_WORDED_ERRORS.has(String(d.error))) return d.message;
  return d.ok ? `plugin ${d.id} built (${names})` : `plugin invalid: ${d.error}`;
}

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
    PACK_REFUSAL_CATEGORIES.has(String(o.error))
    // #240: a block is known by its code, never by the words "was blocked".
    || o.reasonCode === PACK_BLOCKED
    || text.includes("Couldn't safety-check")
    || text.includes("was interrupted")
    || text.includes("couldn't start")
    || o.reasonCode === PACK_UPDATE_REFUSED
    || o.blockReason === "couldnt_start"
    || o.blockReason === "block_record_unreadable"
  );
}

export function formatPackInstallBlocked(payload: PackInstallBlockedPayload): string {
  if (payload.message) return payload.message;
  // #240: a block whose words came in `error` (the catalog's fallback row): show them as is.
  if (payload.reasonCode === PACK_BLOCKED && typeof payload.error === "string" && payload.error
    && !PACK_REFUSAL_CATEGORIES.has(payload.error)) return payload.error;
  // #185: same shape as service/pack_block_copy.py; file / import stay in the payload, not the text.
  const name = payload.name || payload.id || "Plugin";
  return (
    `${name} was blocked because it loads code from outside its own folder. `
    + "Nothing was installed, and your wall is unchanged. "
    + "If you made this pack, run pack lint to see what to fix."
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

/** `reasonCode` is the row's code (#240: PACK_BLOCKED makes it a block, whatever `error` says). */
export function catalogErrorLooksBlocked(error: string, reasonCode?: string): boolean {
  return (
    reasonCode === PACK_BLOCKED
    || error.includes("Couldn't safety-check")
    || error.includes("pack-bundle-boundary")
    || error.includes("Built for an older zoto-viz SDK")
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
