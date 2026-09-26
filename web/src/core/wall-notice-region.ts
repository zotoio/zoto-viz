/** Shared wall status region — single role=status host for all wall notices (#83 / #88). */

export const WALL_NOTICE_REGION_CLASS = "wall-notice-region";

export function getWallNoticeRegion(host: HTMLElement): HTMLElement | null {
  return host.querySelector(`.${WALL_NOTICE_REGION_CLASS}`);
}

export function ensureWallNoticeRegion(host: HTMLElement): HTMLElement {
  const existing = getWallNoticeRegion(host);
  if (existing) return existing;
  const region = document.createElement("div");
  region.className = WALL_NOTICE_REGION_CLASS;
  region.setAttribute("role", "status");
  host.appendChild(region);
  return region;
}

/** Append one notice row inside the shared region (callers style the returned element). */
export function postWallNotice(host: HTMLElement): HTMLElement {
  const region = ensureWallNoticeRegion(host);
  const row = document.createElement("div");
  row.className = "wall-notice-row";
  region.appendChild(row);
  return row;
}
