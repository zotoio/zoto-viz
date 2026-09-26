/** Catalog rows the host cannot load (unknown manifest keys, newer SDK). */

export type ManifestBlockedPlugin = {
  id: string;
  name: string;
  file: string;
  blocked: true;
  reasonCode: string;
  message: string;
  keys?: string[];
  packSdk?: number;
  hostSdk?: number;
};

export const MANIFEST_BLOCKED_VIEW_ID = "__manifest_blocked_catalog__";

let blockedCatalog: ManifestBlockedPlugin[] = [];

export function resetManifestBlockedCatalogForTests(): void {
  blockedCatalog = [];
}

export function setManifestBlockedCatalog(rows: ManifestBlockedPlugin[]): void {
  blockedCatalog = rows.filter((r) => r?.blocked && r.message);
}

export function manifestBlockedCatalog(): readonly ManifestBlockedPlugin[] {
  return blockedCatalog;
}

export function manifestBlockedViewSelectRow(): {
  value: string;
  label: string;
  hint: string;
  group: string;
} | null {
  const n = blockedCatalog.length;
  if (!n) return null;
  return {
    value: MANIFEST_BLOCKED_VIEW_ID,
    label: `Blocked (${n})`,
    hint: "",
    group: "Blocked",
  };
}

export function renderManifestBlockedPanel(host: HTMLElement): void {
  host.replaceChildren();
  if (!blockedCatalog.length) {
    host.innerHTML = `<div class="sec-hint">No blocked packs.</div>`;
    return;
  }
  for (const row of blockedCatalog) {
    const card = document.createElement("div");
    card.className = "sec plugin-blocked-card";
    card.setAttribute("data-blocked-id", row.id);
    const title = document.createElement("div");
    title.className = "sec-title";
    title.textContent = row.name || row.id;
    const body = document.createElement("div");
    body.className = "sec-hint plugin-blocked-message";
    body.textContent = row.message;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.textContent = "Retry";
    retry.setAttribute("data-action", "retry-catalog");
    card.append(title, body, retry);
    host.append(card);
  }
}
