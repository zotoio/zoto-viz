import { mintPackAssetToken } from "../core/http";
import {
  closePackAssetFrameForTile,
  openPackAssetFrame,
  markSandboxOwnedFrame,
  packAssetFrameForTile,
} from "./pack-asset-frame";
import { PLUGIN_SDK } from "./sdk";
import type { VizDataFrame, VizPluginContract, VizPresentTick, VizUniformValue } from "./viz-host";
import {
  HOST_SOURCE,
  PLUGIN_SOURCE,
  hostAllows,
  type HostBootChannelMsg,
  type HostPortMsg,
  type PluginHostMsg,
  type PluginPortMsg,
  type PluginWindowMsg,
} from "./sandbox-channel";

export { hostAllows } from "./sandbox-channel";
import {
  applyPackNavigationStoppedNotice,
  clearPackNavigationStopped,
  markPackNavigationStopped,
  registerPackNavigationRemove,
} from "./pack-asset-navigation";
import { clearSandboxWrote, noteSandboxWrite, setSandboxReady } from "./viz-drive";
import { syncVizTileScope } from "./viz-tile-budget";
import { validateVizWriteBatch, vizWriteBatchByteSize, type VizWriteBatchPayload } from "./viz-write-batch";
import { notePackWriteBatch } from "../core/pack-host-perf";
import { SKY_WAIT_DRIFT_MS } from "../app/sky-wait";

/** Test hook: shorten sandbox handshake waits. */
let sandboxMsgTimeoutMs = 15_000;

export function setSandboxMsgTimeoutMs(ms: number): void {
  sandboxMsgTimeoutMs = Math.max(1, ms | 0);
}

/** @internal unit tests — seed pack-asset frame id without opening a frame. */
export function seedPackAssetFrameForTests(tileId = "main", frameId = TEST_FALLBACK_FRAME_ID): void {
  activePackAssetFrameByTile.set(tileId, frameId);
}

export function sandboxMsgTimeoutForTests(): number {
  return sandboxMsgTimeoutMs;
}

/** Late fires a boot wait re-arms for; the next late fire (or any on-time expiry) rejects. */
export const SANDBOX_BOOT_LATE_REARMS = 1;

/**
 * #216: a boot-wait deadline that fires more than SKY_WAIT_DRIFT_MS late means the host main
 * thread was blocked (e.g. a synchronous sky compile), so the frame had no fair window. First
 * yield one task: an answer the frame posted meanwhile is handled then, and the wait's finish()
 * clears this timer (resolved, no re-arm, no log). Still waiting: start the window again, as
 * sky-wait does, at most SANDBOX_BOOT_LATE_REARMS times. `expire` rejects the wait.
 */
function armBootDeadline(type: string, expire: () => void): () => void {
  let timer = 0;
  let rearms = 0;
  const arm = (): void => {
    const due = performance.now() + sandboxMsgTimeoutMs;
    timer = window.setTimeout(() => {
      if (performance.now() - due <= SKY_WAIT_DRIFT_MS) {
        expire();
        return;
      }
      timer = window.setTimeout(() => {
        if (rearms >= SANDBOX_BOOT_LATE_REARMS) {
          expire();
          return;
        }
        rearms++;
        console.info(`[zoto-viz plugin] wait=${type} step=deadline-restart reason=main-thread-blocked`);
        arm();
      }, 0);
    }, sandboxMsgTimeoutMs);
  };
  arm();
  return () => window.clearTimeout(timer);
}

let sandboxFramePostMessageCount = 0;

export function sandboxFramePostMessageCountForTests(): number {
  return sandboxFramePostMessageCount;
}

export function resetSandboxFramePostMessageCountForTests(): void {
  sandboxFramePostMessageCount = 0;
}

const ALLOWED = new Set([
  "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
]);

const PACK_ASSETS_PREFIX = "/pack-assets/";
const SANDBOX_PACK = "_sandbox";
const TEST_FALLBACK_FRAME_ID = "11111111-1111-4111-8111-111111111111";

/** Pack asset path with an already-minted token (never omit the token). */
export function packAssetUrlWithToken(token: string, packId: string, ...parts: string[]): string {
  if (!token) throw new Error("pack asset token required");
  const segs = [
    encodeURIComponent(token),
    encodeURIComponent(packId),
    ...parts.map((p) => encodeURIComponent(p)),
  ];
  return `${PACK_ASSETS_PREFIX}${segs.join("/")}`;
}

const activePackAssetFrameByTile = new Map<string, string>();
/** #233: sandboxes with a pack loaded, and those whose frame sent `ready` (one per tile). */
const liveSandboxes = new Set<PluginSandbox>();
const readySandboxes = new Set<PluginSandbox>();
const sandboxAssetTokenByFrame = new Map<string, string>();
let lastSandboxBootNonce = "";

export function packAssetFrameIdForTests(tileId = "main"): string {
  return activePackAssetFrameByTile.get(tileId) ?? "";
}

function resolvePackAssetFrameId(tileId: string): string {
  return activePackAssetFrameByTile.get(tileId) || packAssetFrameForTile(tileId) || "";
}

/**
 * Pack file URL for the sandbox frame on `tileId`, using that frame's own `_sandbox` token.
 *
 * The frame's CSP only allows scripts under `/pack-assets/<its _sandbox token>/`, and the server accepts
 * that token for pack files, so a pack-bound token here would always be CSP-blocked. Call it only after
 * {@link pluginSandboxFrameUrl} has minted the frame's token.
 */
export async function packAssetUrl(tileId: string, packId: string, ...parts: string[]): Promise<string> {
  const frameId = resolvePackAssetFrameId(tileId);
  if (!frameId) throw new Error(`pack asset frame required for tile ${tileId}`);
  const token = sandboxAssetTokenByFrame.get(frameId);
  if (!token) throw new Error(`sandbox frame token not minted yet for tile ${tileId}`);
  return packAssetUrlWithToken(token, packId, ...parts);
}

export function sandboxBootNonceForTests(): string {
  return lastSandboxBootNonce;
}

export function countPluginSandboxIframes(): number {
  return document.querySelectorAll("iframe[sandbox]").length;
}

/** Same-origin bootstrap page for the sandboxed iframe (no srcdoc / inline script). */
export async function pluginSandboxFrameUrl(
  frameId: string,
  bootNonceOut?: { nonce: string },
): Promise<string> {
  if (!frameId) throw new Error("pack asset frame required");
  const token = await mintPackAssetToken(SANDBOX_PACK, frameId);
  sandboxAssetTokenByFrame.set(frameId, token);
  const bootNonce = crypto.randomUUID();
  lastSandboxBootNonce = bootNonce;
  if (bootNonceOut) bootNonceOut.nonce = bootNonce;
  const path = packAssetUrlWithToken(token, SANDBOX_PACK, "plugin-sandbox.html");
  return `${location.origin}${path}#zoto-boot=${encodeURIComponent(bootNonce)}`;
}

export interface PluginHostHandlers {
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
  writeBuffer?: (slot: number, data: number[]) => void;
  writeUniform?: (name: string, value: VizUniformValue) => void;
  writeParticles?: (data: number[], stride?: number) => void;
  writeBatch?: (batch: VizWriteBatchPayload) => void;
  publishBitmap?: (packId: string, bitmap: ImageBitmap) => void;
  publishBitmapFailed?: (packId: string) => void;
}

const TS_STORE = "zoto-viz.tsPlugins";
const HASH_STORE = "zoto-viz.tsHashes";

export function tsPluginsAllowed(): boolean {
  return localStorage.getItem(TS_STORE) !== "0";
}

export function setTsPluginsAllowed(on: boolean): void {
  localStorage.setItem(TS_STORE, on ? "1" : "0");
}

export function hashConsented(id: string, hash: string): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem(HASH_STORE) || "{}") as Record<string, string>;
    return raw[id] === hash;
  } catch {
    return false;
  }
}

export function consentHash(id: string, hash: string): void {
  let raw: Record<string, string> = {};
  try { raw = JSON.parse(localStorage.getItem(HASH_STORE) || "{}") as Record<string, string>; } catch { raw = {}; }
  raw[id] = hash;
  localStorage.setItem(HASH_STORE, JSON.stringify(raw));
}

export function pluginModuleUrl(id: string, hash?: string): string {
  const path = `/api/plugins/${encodeURIComponent(id)}/module.js`;
  const base = hash ? `${path}?h=${encodeURIComponent(hash)}` : path;
  return base;
}

/** Pack module URL for opaque-origin sandbox import (token in path). */
let pluginModuleSandboxUrlOverride: ((id: string, hash: string | undefined, tileId: string) => Promise<string>) | null = null;

/** @internal unit tests — avoid http module imports under the Node ESM loader. */
export function setPluginModuleSandboxUrlForTests(
  fn: ((id: string, hash: string | undefined, tileId: string) => Promise<string>) | null,
): void {
  pluginModuleSandboxUrlOverride = fn;
}

export async function pluginModuleSandboxUrl(id: string, hash: string | undefined, tileId: string): Promise<string> {
  if (pluginModuleSandboxUrlOverride) return pluginModuleSandboxUrlOverride(id, hash, tileId);
  const path = await packAssetUrl(tileId, id, "module.js");
  let url = `${location.origin}${path}`;
  if (hash) url += `?h=${encodeURIComponent(hash)}`;
  return url;
}

/** @deprecated Legacy inline bootstrap kept for tests that assert SDK shape. */
export const LEGACY_SRCDOC_SDK = PLUGIN_SDK;

export type NavigationStopHost = {
  setPaneNotice?: import("./plugin-pack-feed").MosaicNoticeHost["setPaneNotice"];
  closeTile?: (tileId: string) => void;
};

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private caps: string[] = [];
  private vizContract: VizPluginContract | undefined;
  private moduleBlobUrl: string | null = null;
  private bootReject: ((err: Error) => void) | null = null;
  private frameId = "";
  private bootNonce = "";
  private hostPort: MessagePort | null = null;
  private iframeLoadCount = 0;
  /** Bumped on every {@link unload} so an in-flight boot cannot append a second iframe. */
  private bootEpoch = 0;
  private onIframeLoad: (() => void) | null = null;
  private activePackLabel = "";
  private activePackId = "";
  /** Pack whose sandbox frame reached `ready` (cleared on unload). */
  private readyPackId = "";
  /** Identical in-flight {@link loadModule} shares one frame instead of churning a new one. */
  private inflightModule: { key: string; epoch: number; promise: Promise<void> } | null = null;
  private navigationHost: NavigationStopHost | null = null;
  private readonly presentTickPayload: VizPresentTick = { frameMs: 0, tileId: "" };
  private lastPresentFrameMs = -1;
  handlers: PluginHostHandlers = {};
  /** Mosaic tile or `main` receiving sandbox plugin writes. */
  activeTileId = "main";

  setActiveTile(tileId: string): void {
    const id = tileId.trim();
    this.activeTileId = id || "main";
  }

  /** Pack id whose frame has booted to `ready`, or "" while loading / unloaded. */
  get readyPack(): string {
    return this.readyPackId;
  }

  setActivePackLabel(label: string): void {
    this.activePackLabel = label.trim();
  }

  setNavigationStopHost(host: NavigationStopHost | null): void {
    this.navigationHost = host;
  }

  constructor() {
    window.addEventListener("message", this.onWindowMessage);
  }

  /** Re-register the host window listener after {@link unload}. */
  private ensureWindowMessageListener(): void {
    window.removeEventListener("message", this.onWindowMessage);
    window.addEventListener("message", this.onWindowMessage);
  }

  /** This sandbox is no longer ready: only its own tile's drive drops while another tile's runs. */
  private dropReady(): void {
    readySandboxes.delete(this);
    if (readySandboxes.size) clearSandboxWrote(this.activeTileId);
    else setSandboxReady(false);
  }

  unload(): void {
    this.bootEpoch += 1;
    window.removeEventListener("message", this.onWindowMessage);
    this.dropReady();
    this.cancelBootWait();
    this.bootReject = null;
    this.activePackId = "";
    this.readyPackId = "";
    this.inflightModule = null;
    this.teardownPort();
    const tile = this.activeTileId;
    const fid = this.frameId;
    this.frameId = "";
    this.bootNonce = "";
    if (fid) {
      sandboxAssetTokenByFrame.delete(fid);
      if (activePackAssetFrameByTile.get(tile) === fid) activePackAssetFrameByTile.delete(tile);
      markSandboxOwnedFrame(fid, false);
      void closePackAssetFrameForTile(tile, fid);
    }
    this.moduleBlobUrl = null;
    if (this.onIframeLoad && this.iframe) {
      this.iframe.removeEventListener("load", this.onIframeLoad);
      this.onIframeLoad = null;
    }
    if (this.iframe) {
      this.iframe.src = "about:blank";
      this.iframe.remove();
    }
    this.iframe = null;
    this.iframeLoadCount = 0;
    this.lastPresentFrameMs = -1;
    liveSandboxes.delete(this);
    // #233: the tile scope resets with the last sandbox, not under another tile's live one.
    if (!liveSandboxes.size) syncVizTileScope(["main"]);
  }

  private teardownPort(): void {
    if (this.hostPort) {
      try { this.hostPort.close(); } catch { /* ignore */ }
      this.hostPort.onmessage = null;
      this.hostPort = null;
    }
  }

  /**
   * Opaque sandbox iframes have no origin to name; only the frame's contentWindow receives the port.
   * targetOrigin "*" is required so the transferred MessagePort reaches the sandbox document.
   */
  private postToFrameWindow(msg: HostBootChannelMsg, transfer: Transferable[]): void {
    sandboxFramePostMessageCount += 1;
    this.iframe?.contentWindow?.postMessage(msg, "*", transfer);
  }

  private postToFramePort(msg: HostPortMsg): void {
    if (!this.hostPort) return;
    this.hostPort.postMessage(msg);
  }

  get liveFrame(): HTMLIFrameElement | null {
    return this.iframe;
  }

  /** Test hook: host side of the sandbox MessageChannel (null after unload). */
  sandboxHostPort(): MessagePort | null {
    return this.hostPort;
  }

  async load(
    id: string,
    js: string,
    caps: string[],
    config: Record<string, string>,
    viz?: VizPluginContract,
  ): Promise<void> {
    this.unload();
    liveSandboxes.add(this);
    this.activePackId = id;
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    const plugin = js.replace(/<\/script/gi, "<\\/script");
    const src = `const zoto = globalThis.zoto;\n${plugin}\n`;
    this.moduleBlobUrl = `data:text/javascript,${encodeURIComponent(src)}`;
    const epoch = this.bootEpoch;
    await this.bootFrame(this.moduleBlobUrl, config, viz, epoch);
    this.noteReady(id, epoch);
  }

  private noteReady(id: string, epoch: number): void {
    if (epoch === this.bootEpoch && this.hostPort && this.iframe) this.readyPackId = id;
  }

  /** Own a freshly opened frame, or close it if a newer load superseded this one mid-open. */
  private adoptFrame(frameId: string, tile: string, epoch: number): boolean {
    if (epoch !== this.bootEpoch) {
      // Orphan from a superseded open. Never close an id a newer load already owns (ids repeat
      // when the server hands back the tile's existing frame).
      if (frameId !== this.frameId && activePackAssetFrameByTile.get(tile) !== frameId) {
        void closePackAssetFrameForTile(tile, frameId);
      }
      return false;
    }
    this.frameId = frameId;
    markSandboxOwnedFrame(frameId, true);
    activePackAssetFrameByTile.set(tile, frameId);
    return true;
  }

  loadModule(
    id: string,
    caps: string[],
    config: Record<string, string>,
    hash?: string,
    viz?: VizPluginContract,
  ): Promise<void> {
    // One frame per pick: a repeat of the same load while it is still booting joins it rather
    // than unloading a frame whose token is mid-mint and opening another.
    const key = JSON.stringify([id, hash ?? "", this.activeTileId, caps, config]);
    const inflight = this.inflightModule;
    if (inflight && inflight.key === key && inflight.epoch === this.bootEpoch) return inflight.promise;
    this.unload();
    liveSandboxes.add(this);
    this.activePackId = "";
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    const epoch = this.bootEpoch;
    // Hand back bootModule's own promise (no extra await layer) so callers see the same timing.
    const promise = this.bootModule(id, hash, config, viz, epoch);
    this.inflightModule = { key, epoch, promise };
    return promise;
  }

  private async bootModule(
    id: string,
    hash: string | undefined,
    config: Record<string, string>,
    viz: VizPluginContract | undefined,
    epoch: number,
  ): Promise<void> {
    const tile = this.activeTileId;
    try {
      // Production has no test fallback frame: module.js mint needs a live frame id.
      const frameId = await openPackAssetFrame(tile);
      if (!this.adoptFrame(frameId, tile, epoch)) return;
      // module.js must carry the frame's _sandbox token, which bootFrame mints, so resolve it there.
      await this.bootFrame(() => pluginModuleSandboxUrl(id, hash, tile), config, viz, epoch);
      this.noteReady(id, epoch);
    } finally {
      if (this.inflightModule?.epoch === epoch) this.inflightModule = null;
    }
  }

  async loadModuleUrl(
    moduleSrc: string,
    caps: string[],
    config: Record<string, string>,
    viz?: VizPluginContract,
  ): Promise<void> {
    this.unload();
    liveSandboxes.add(this);
    this.activePackId = "";
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    await this.bootFrame(moduleSrc, config, viz, this.bootEpoch);
  }

  private dropStaleIframe(iframe: HTMLIFrameElement): void {
    iframe.remove();
    if (this.iframe === iframe) this.iframe = null;
  }

  private async bootFrame(
    moduleSrcOrResolve: string | (() => Promise<string>),
    config: Record<string, string>,
    viz: VizPluginContract | undefined,
    epoch: number,
  ): Promise<void> {
    if (epoch !== this.bootEpoch) return;
    this.ensureWindowMessageListener();
    if (!this.frameId) {
      const tile = this.activeTileId;
      const frameId = await openPackAssetFrame(tile);
      if (!this.adoptFrame(frameId, tile, epoch)) return;
    }
    const bootOut = { nonce: "" };
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.hidden = true;
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    iframe.src = await pluginSandboxFrameUrl(this.frameId, bootOut);
    if (epoch !== this.bootEpoch) return;
    const moduleSrc = typeof moduleSrcOrResolve === "string" ? moduleSrcOrResolve : await moduleSrcOrResolve();
    if (epoch !== this.bootEpoch) return;
    this.bootNonce = bootOut.nonce;
    document.body.appendChild(iframe);
    if (epoch !== this.bootEpoch) {
      this.dropStaleIframe(iframe);
      return;
    }
    this.iframe = iframe;
    this.iframeLoadCount = 0;
    this.onIframeLoad = () => {
      this.iframeLoadCount += 1;
      if (this.iframeLoadCount >= 2) void this.handleSandboxNavigation();
    };
    iframe.addEventListener("load", this.onIframeLoad);
    if (iframe.srcdoc) {
      throw new Error("plugin sandbox must not use srcdoc under page CSP");
    }
    await waitPluginMsg(this, iframe, "frame-ready", this.bootNonce, (fail) => { this.bootReject = fail; });
    if (epoch !== this.bootEpoch || this.iframe !== iframe) return;
    const channel = new MessageChannel();
    this.hostPort = channel.port1;
    this.hostPort.start();
    this.hostPort.onmessage = (ev) => this.onPortMessage(ev);
    this.postToFrameWindow({
      source: HOST_SOURCE,
      type: "boot-channel",
      bootNonce: this.bootNonce,
      parentOrigin: location.origin,
    }, [channel.port2]);
    this.postToFramePort({
      source: HOST_SOURCE,
      type: "boot",
      caps: this.caps,
      config,
      viz,
      contractVersion: viz?.contract,
      moduleSrc,
      bootNonce: this.bootNonce,
      parentOrigin: location.origin,
    });
    await waitPluginPortMsg(this, this.hostPort, "ready", this.bootNonce, (fail) => { this.bootReject = fail; });
    if (epoch !== this.bootEpoch || this.iframe !== iframe) return;
    this.bootReject = null;
    if (!this.iframe) {
      this.teardownPort();
    }
  }

  private cancelBootWait(): void {
    const cancel = bootWaitCancelBySandbox.get(this);
    if (cancel) {
      bootWaitCancelBySandbox.delete(this);
      cancel();
    }
  }

  private async handleSandboxNavigation(): Promise<void> {
    const tile = this.activeTileId;
    const pack = this.activePackLabel || "Pack";
    if (!markPackNavigationStopped(tile)) return;
    this.teardownPort();
    const fid = this.frameId;
    this.frameId = "";
    this.bootNonce = "";
    this.readyPackId = "";
    if (fid) {
      sandboxAssetTokenByFrame.delete(fid);
      markSandboxOwnedFrame(fid, false);
    }
    if (activePackAssetFrameByTile.get(tile) === fid) activePackAssetFrameByTile.delete(tile);
    if (this.onIframeLoad && this.iframe) {
      this.iframe.removeEventListener("load", this.onIframeLoad);
      this.onIframeLoad = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    if (fid) await closePackAssetFrameForTile(tile, fid);
    // #233: stays in liveSandboxes: its tile (and notice) remains until unload() tears it down,
    // and that unload is what resets the scope, which is what this path did before #233.
    this.dropReady();
    registerPackNavigationRemove(tile, () => {
      this.navigationHost?.closeTile?.(tile);
    });
    const host = this.navigationHost;
    if (host?.setPaneNotice) {
      applyPackNavigationStoppedNotice(
        { setPaneNotice: host.setPaneNotice },
        tile,
        pack,
      );
    }
  }

  tick(nodes: { id: string; rate: number; role: string }[]): void {
    if (!this.caps.includes("graph.read") || !this.hostPort) return;
    this.postToFramePort({ source: HOST_SOURCE, type: "tick", nodes });
  }

  frame(data: VizDataFrame): void {
    if (!this.caps.includes("viz.read") || !this.hostPort) return;
    this.postToFramePort({ source: HOST_SOURCE, type: "frame", frame: data });
  }

  /**
   * One {@link VizPresentTick} per sandbox per display frame (mosaic tiles share a sandbox).
   */
  deliverPresentTick(frameMs: number, tileId: string, pluginClock?: number, aspect?: number): void {
    if (!this.caps.includes("viz.write") || !this.vizContract?.presentTick || !this.hostPort) return;
    if (frameMs === this.lastPresentFrameMs) return;
    this.lastPresentFrameMs = frameMs;
    const tick = this.presentTickPayload;
    tick.frameMs = frameMs;
    tick.tileId = tileId;
    if (pluginClock != null && Number.isFinite(pluginClock)) tick.pluginClock = pluginClock;
    else delete tick.pluginClock;
    if (aspect != null && Number.isFinite(aspect) && aspect > 0) tick.aspect = aspect;
    else delete tick.aspect;
    this.postToFramePort({ source: HOST_SOURCE, type: "present", tick });
  }

  setConfig(config: Record<string, string>): void {
    if (!this.caps.includes("config.read") || !this.hostPort) return;
    this.postToFramePort({ source: HOST_SOURCE, type: "config", config });
  }

  contract(): VizPluginContract | undefined {
    return this.vizContract;
  }

  /** Test hook: simulate iframe `postMessage` (publishBitmap still uses the window path). */
  onMessage = (ev: MessageEvent): void => {
    this.onWindowMessage(ev);
  };

  private onWindowMessage = (ev: MessageEvent): void => {
    if (!this.iframe) return;
    const d = ev.data as PluginHostMsg | undefined;
    if (ev.source !== this.iframe.contentWindow) {
      if (d?.source === PLUGIN_SOURCE && d.type === "publishBitmap") {
        try { d.payload.bitmap.close(); } catch { /* already closed */ }
      }
      return;
    }
    if (!d || d.source !== PLUGIN_SOURCE) return;
    if (d.type === "frame-ready") {
      recordSandboxBoot(d.type);
      return;
    }
    if (d.type === "publishBitmap" || d.type === "publishBitmapFailed") {
      this.dispatchPluginMsg(d, ev.source);
      return;
    }
  };

  private dispatchPluginMsg(d: PluginPortMsg, evSource: MessageEventSource | null = null): void {
    if (!hostAllows(d.type, this.caps)) return;
    switch (d.type) {
      case "ready":
      case "drawState":
      case "loseHostContext":
      case "log":
        break;
      case "setStyle":
        this.handlers.setStyle?.(d.payload);
        break;
      case "setNodeColor":
        this.handlers.setNodeColor?.(d.payload.id, d.payload.hex);
        break;
      case "writeBuffer":
        noteSandboxWrite(this.activeTileId);
        this.handlers.writeBuffer?.(d.payload.slot, d.payload.data);
        break;
      case "writeUniform":
        noteSandboxWrite(this.activeTileId);
        this.handlers.writeUniform?.(d.payload.name, d.payload.value as VizUniformValue);
        break;
      case "writeParticles":
        noteSandboxWrite(this.activeTileId);
        this.handlers.writeParticles?.(d.payload.data, d.payload.stride);
        break;
      case "writeBatch": {
        noteSandboxWrite(this.activeTileId);
        const err = validateVizWriteBatch(d.payload as VizWriteBatchPayload);
        if (err) {
          console.warn("zoto-viz viz.write batch:", err);
          break;
        }
        notePackWriteBatch(
          d.payload.buffers.length + d.payload.uniforms.length + (d.payload.particles ? 1 : 0),
          vizWriteBatchByteSize(d.payload as VizWriteBatchPayload),
        );
        this.handlers.writeBatch?.(d.payload as VizWriteBatchPayload);
        break;
      }
      case "publishBitmap": {
        const bmp = d.payload.bitmap;
        if (this.iframe && evSource !== this.iframe.contentWindow) {
          bmp.close();
          break;
        }
        try {
          this.handlers.publishBitmap?.(this.activePackId, bmp);
        } catch {
          bmp.close();
        }
        break;
      }
      case "publishBitmapFailed":
        this.handlers.publishBitmapFailed?.(this.activePackId);
        break;
      default: {
        const _exhaustive: never = d;
        void _exhaustive;
      }
    }
  }

  private onPortMessage(ev: MessageEvent): void {
    const d = ev.data as PluginPortMsg | undefined;
    if (!d || d.source !== PLUGIN_SOURCE) return;
    if (d.type === "ready") {
      if (d.bootNonce !== this.bootNonce) return;
      recordSandboxBoot("ready");
      readySandboxes.add(this);
      setSandboxReady(true);
      return;
    }
    if (d.type === "log" && this.bootReject) {
      const fail = this.bootReject;
      this.bootReject = null;
      fail(new Error(String(d.payload ?? "sandbox module load failed")));
      return;
    }
    this.dispatchPluginMsg(d, this.iframe?.contentWindow ?? null);
  }
}

const bootWaitCancelBySandbox = new WeakMap<PluginSandbox, () => void>();

function setBootWaitCancel(sandbox: PluginSandbox, cancel: (() => void) | null): void {
  if (cancel) bootWaitCancelBySandbox.set(sandbox, cancel);
  else bootWaitCancelBySandbox.delete(sandbox);
}

function recordSandboxBoot(type: PluginWindowMsg["type"] | PluginPortMsg["type"]): void {
  const w = window as unknown as { __zotoSandboxBoot?: (PluginWindowMsg["type"] | PluginPortMsg["type"])[] };
  w.__zotoSandboxBoot = [...(w.__zotoSandboxBoot ?? []), type];
}

function waitPluginMsg(
  sandbox: PluginSandbox,
  iframe: HTMLIFrameElement,
  type: PluginWindowMsg["type"],
  _expectedBootNonce: string,
  onReject?: (fail: (err: Error) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearDeadline();
      window.removeEventListener("message", onMsg);
      setBootWaitCancel(sandbox, null);
      fn();
    };
    const fail = (err: Error) => finish(() => reject(err));
    onReject?.(fail);
    setBootWaitCancel(sandbox, () => finish(() => resolve()));
    const clearDeadline = armBootDeadline(type, () => finish(() => reject(new Error(`sandbox ${type} timeout`))));
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const d = ev.data as PluginWindowMsg | undefined;
      if (d?.source !== PLUGIN_SOURCE) return;
      if (d.type === type) finish(() => resolve());
    };
    window.addEventListener("message", onMsg);
  });
}

function waitPluginPortMsg(
  sandbox: PluginSandbox,
  port: MessagePort,
  type: PluginPortMsg["type"],
  expectedBootNonce: string,
  onReject?: (fail: (err: Error) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (fn: () => void) => {
      clearDeadline();
      port.removeEventListener("message", onMsg);
      setBootWaitCancel(sandbox, null);
      fn();
    };
    const fail = (err: Error) => finish(() => reject(err));
    onReject?.(fail);
    setBootWaitCancel(sandbox, () => finish(() => resolve()));
    const clearDeadline = armBootDeadline(type, () => finish(() => reject(new Error(`sandbox ${type} timeout`))));
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as PluginPortMsg | undefined;
      if (d?.source !== PLUGIN_SOURCE) return;
      if (d.type === "log" && type === "ready") {
        fail(new Error(String(d.payload ?? "sandbox module load failed")));
        return;
      }
      if (d.type === type) {
        if (type === "ready") {
          if (d.type !== "ready" || d.bootNonce !== expectedBootNonce) return;
        }
        finish(() => resolve());
      }
    };
    port.addEventListener("message", onMsg);
  });
}
