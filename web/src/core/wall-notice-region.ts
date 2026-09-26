/** Shared wall status region — bottom-centre above the HUD; one role=status host for all notices. */

export type WallNoticeKey = "context-lost" | "context-not-restored";

export type WallNoticeAction = {
  label: string;
  onClick: () => void;
};

export type PostWallNoticeOpts = {
  key: WallNoticeKey;
  text: string;
  action?: WallNoticeAction;
  autoClearMs?: number;
};

export const WALL_NOTICE_REGION_CLASS = "wall-notice-region";
export const WALL_NOTICE_CLASS = "wall-notice";
export const WALL_NOTICE_ACTION_CLASS = "wall-notice-action";

const NOTICE_TONE: Record<WallNoticeKey, "polite" | "alert"> = {
  "context-lost": "polite",
  "context-not-restored": "alert",
};

const autoClearTimers = new WeakMap<HTMLElement, Map<WallNoticeKey, ReturnType<typeof setTimeout>>>();

export function getWallNoticeRegion(host: HTMLElement): HTMLElement | null {
  return host.querySelector(`:scope > .${WALL_NOTICE_REGION_CLASS}`);
}

function ensureWallNoticeRegion(host: HTMLElement): HTMLElement {
  const existing = getWallNoticeRegion(host);
  if (existing) return existing;
  const region = document.createElement("div");
  region.className = WALL_NOTICE_REGION_CLASS;
  region.setAttribute("role", "status");
  host.appendChild(region);
  return region;
}

export function getWallNotice(host: HTMLElement, key: WallNoticeKey): HTMLElement | null {
  return host.querySelector(`[data-wall-notice-key="${key}"]`);
}

function clearAutoClear(host: HTMLElement, key: WallNoticeKey): void {
  const map = autoClearTimers.get(host);
  const t = map?.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    map?.delete(key);
  }
}

export function clearWallNotice(host: HTMLElement, key: WallNoticeKey): void {
  clearAutoClear(host, key);
  getWallNotice(host, key)?.remove();
  const region = getWallNoticeRegion(host);
  if (region && region.childElementCount === 0) region.remove();
}

export function postWallNotice(opts: PostWallNoticeOpts, host: HTMLElement): HTMLElement {
  clearWallNotice(host, opts.key);
  const region = ensureWallNoticeRegion(host);
  const el = document.createElement("div");
  el.className = WALL_NOTICE_CLASS;
  el.dataset.wallNoticeKey = opts.key;
  el.dataset.tone = NOTICE_TONE[opts.key];
  el.setAttribute("aria-live", NOTICE_TONE[opts.key] === "alert" ? "assertive" : "polite");
  const span = document.createElement("span");
  span.textContent = opts.text;
  el.append(span);
  if (opts.action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = WALL_NOTICE_ACTION_CLASS;
    btn.textContent = opts.action.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.action!.onClick();
    });
    el.append(btn);
  }
  region.appendChild(el);
  if (opts.autoClearMs != null) {
    let map = autoClearTimers.get(host);
    if (!map) {
      map = new Map();
      autoClearTimers.set(host, map);
    }
    map.set(
      opts.key,
      setTimeout(() => clearWallNotice(host, opts.key), opts.autoClearMs),
    );
  }
  return el;
}
