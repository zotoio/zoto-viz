/** Mosaic tile copy: sandbox boot failure vs running pack with an empty viz feed. */

export const NO_PACK_FEED = "NO PACK FEED";
const TOKEN_REDACT = "<sandbox-token>";
const PACK_ASSETS = "/pack-assets/";

export function redactSandboxTokenInText(text: string, token?: string): string {
  if (!text) return text;
  let out = text;
  const sat = (token ?? "").trim();
  if (sat) {
    out = out.split(sat).join(TOKEN_REDACT);
  }
  return out.replace(/\/pack-assets\/[^/]+\//g, `${PACK_ASSETS}${TOKEN_REDACT}/`);
}

export function formatSandboxStartupFailure(packName: string): string {
  const name = packName.trim() || "Pack";
  return `${name} couldn't start, its sandbox didn't respond`;
}

export function classifySandboxBootError(err: unknown): string {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
    if (/sandbox frame-ready timeout/i.test(msg)) return `sandbox frame-ready timeout: ${redactSandboxTokenInText(msg)}`;
    if (/sandbox ready timeout/i.test(msg)) return `sandbox ready timeout: ${redactSandboxTokenInText(msg)}`;
    if (/module \d{3}/i.test(msg)) return `module.js HTTP ${redactSandboxTokenInText(msg)}`;
    if (/failed to fetch/i.test(msg)) return `module.js fetch failed (network/CORS): ${redactSandboxTokenInText(msg)}`;
    if (/CORS/i.test(msg)) return `module.js blocked (CORS): ${redactSandboxTokenInText(msg)}`;
    return redactSandboxTokenInText(msg);
  }
  if (typeof err === "string" && err.trim()) msg = err.trim();
  else msg = String(err);
  return redactSandboxTokenInText(msg);
}

type TileRow = {
  startupFailed: boolean;
  sandboxLive: boolean;
  frameTicks: number;
  sawWrite: boolean;
  expectsViz: boolean;
};

const tiles = new Map<string, TileRow>();
const bootLogged = new Set<string>();

export function resetPluginPackFeedState(): void {
  tiles.clear();
  bootLogged.clear();
  feedNoticeShown.clear();
}

function row(tileId: string): TileRow {
  let r = tiles.get(tileId);
  if (!r) {
    r = {
      startupFailed: false,
      sandboxLive: false,
      frameTicks: 0,
      sawWrite: false,
      expectsViz: false,
    };
    tiles.set(tileId, r);
  }
  return r;
}

export function clearTilePackFeed(tileId: string): void {
  tiles.delete(tileId);
  bootLogged.delete(tileId);
}

export function setTileExpectsVizFeed(tileId: string, expects: boolean): void {
  const r = row(tileId);
  r.expectsViz = expects;
  if (!expects) {
    r.frameTicks = 0;
    r.sawWrite = false;
  }
}

export function markSandboxStartupFailed(tileId: string): void {
  const r = row(tileId);
  r.startupFailed = true;
  r.sandboxLive = false;
  r.frameTicks = 0;
  r.sawWrite = false;
}

export function markSandboxStartupOk(tileId: string): void {
  const r = row(tileId);
  r.startupFailed = false;
  r.sandboxLive = true;
  r.frameTicks = 0;
  r.sawWrite = false;
}

export function markSandboxUnloaded(tileId: string): void {
  clearTilePackFeed(tileId);
}

export function noteSandboxFrameTick(tileId: string): void {
  const r = tiles.get(tileId);
  if (!r || r.startupFailed || !r.sandboxLive) return;
  r.frameTicks += 1;
}

export function noteSandboxPackWrite(tileId: string): void {
  const r = tiles.get(tileId);
  if (!r || r.startupFailed) return;
  r.sawWrite = true;
}

/** Log the underlying boot failure once per tile (timeout / HTTP / CORS). Never log the session token. */
export function logSandboxBootFailureOnce(tileId: string, reason: string, packId?: string): void {
  if (bootLogged.has(tileId)) return;
  bootLogged.add(tileId);
  const safe = redactSandboxTokenInText(reason);
  const pack = (packId ?? "").trim();
  const prefix = pack
    ? `zoto-viz plugin sandbox boot (${tileId}, pack=${pack})`
    : `zoto-viz plugin sandbox boot (${tileId})`;
  console.warn(`${prefix}: ${safe}`);
}

export type PaneNoticeRecipe = "default" | "fail" | "reconnecting";

export function packFeedPaneNotice(
  tileId: string,
  packName: string | null | undefined,
): { text: string; recipe: PaneNoticeRecipe } | null {
  const r = tiles.get(tileId);
  if (!r) return null;
  if (r.startupFailed) {
    return { text: formatSandboxStartupFailure(packName ?? "Pack"), recipe: "fail" };
  }
  if (
    r.expectsViz
    && r.sandboxLive
    && !r.sawWrite
    && r.frameTicks >= 2
  ) {
    return { text: NO_PACK_FEED, recipe: "default" };
  }
  return null;
}

const feedNoticeShown = new Set<string>();

type MosaicNoticeHost = {
  setPaneNotice: (id: string, text: string | null | undefined, recipe?: PaneNoticeRecipe) => void;
};

/** Push pack-feed / sandbox-startup copy to a mosaic tile without clobbering unrelated notices. */
export function applyPackFeedPaneNotice(
  mosaic: MosaicNoticeHost | null | undefined,
  tileId: string,
  packName: string | null | undefined,
): void {
  if (!mosaic) return;
  const next = packFeedPaneNotice(tileId, packName);
  if (next) {
    feedNoticeShown.add(tileId);
    mosaic.setPaneNotice(tileId, next.text, next.recipe);
    return;
  }
  if (feedNoticeShown.delete(tileId)) mosaic.setPaneNotice(tileId, null);
}
