import { mintPackAssetToken } from "../core/http";
import {
  closePackAssetFrameForTile,
  openPackAssetFrame,
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
import { noteSandboxWrite, setSandboxReady } from "./viz-drive";
import { syncVizTileScope } from "./viz-tile-budget";
import { validateVizWriteBatch, vizWriteBatchByteSize, type VizWriteBatchPayload } from "./viz-write-batch";
import { notePackWriteBatch } from "../core/pack-host-perf";

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
const sandboxAssetTokenByFrame = new Map<string, string>();
let lastSandboxBootNonce = "";

export function packAssetFrameIdForTests(tileId = "main"): string {
  return activePackAssetFrameByTile.get(tileId) ?? "";
}

function resolvePackAssetFrameId(tileId = "main"): string {
  return activePackAssetFrameByTile.get(tileId) || packAssetFrameForTile(tileId) || "";
}

export async function packAssetUrl(packId: string, ...parts: string[]): Promise<string> {
  const frameId = resolvePackAssetFrameId();
  if (!frameId) throw new Error("pack asset frame required");
  const sandboxTok = sandboxAssetTokenByFrame.get(frameId);
  const token = sandboxTok ?? await mintPackAssetToken(packId, frameId);
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
let pluginModuleSandboxUrlOverride: ((id: string, hash?: string) => Promise<string>) | null = null;

/** @internal unit tests — avoid http module imports under the Node ESM loader. */
export function setPluginModuleSandboxUrlForTests(
  fn: ((id: string, hash?: string) => Promise<string>) | null,
): void {
  pluginModuleSandboxUrlOverride = fn;
}

export async function pluginModuleSandboxUrl(id: string, hash?: string): Promise<string> {
  if (pluginModuleSandboxUrlOverride) return pluginModuleSandboxUrlOverride(id, hash);
  const path = await packAssetUrl(id, "module.js");
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
  private onIframeLoad: (() => void) | null = null;
  private activePackLabel = "";
  private activePackId = "";
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

  unload(): void {
    window.removeEventListener("message", this.onWindowMessage);
    setSandboxReady(false);
    this.cancelBootWait();
    this.bootReject = null;
    this.activePackId = "";
    this.teardownPort();
    const tile = this.activeTileId;
    const fid = this.frameId;
    this.frameId = "";
    this.bootNonce = "";
    if (fid) sandboxAssetTokenByFrame.delete(fid);
    if (activePackAssetFrameByTile.get(tile) === fid) activePackAssetFrameByTile.delete(tile);
    void closePackAssetFrameForTile(tile);
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
    syncVizTileScope(["main"]);
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
    this.activePackId = id;
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    const plugin = js.replace(/<\/script/gi, "<\\/script");
    const src = `const zoto = globalThis.zoto;\n${plugin}\n`;
    this.moduleBlobUrl = `data:text/javascript,${encodeURIComponent(src)}`;
    await this.bootFrame(this.moduleBlobUrl, config, viz);
  }

  async loadModule(
    id: string,
    caps: string[],
    config: Record<string, string>,
    hash?: string,
    viz?: VizPluginContract,
  ): Promise<void> {
    this.unload();
    this.activePackId = "";
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    // Production has no test fallback frame: module.js mint needs a live frame id.
    this.frameId = await openPackAssetFrame(this.activeTileId);
    activePackAssetFrameByTile.set(this.activeTileId, this.frameId);
    const moduleSrc = await pluginModuleSandboxUrl(id, hash);
    await this.bootFrame(moduleSrc, config, viz);
  }

  async loadModuleUrl(
    moduleSrc: string,
    caps: string[],
    config: Record<string, string>,
    viz?: VizPluginContract,
  ): Promise<void> {
    this.unload();
    this.activePackId = "";
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    await this.bootFrame(moduleSrc, config, viz);
  }

  private async bootFrame(
    moduleSrc: string,
    config: Record<string, string>,
    viz?: VizPluginContract,
  ): Promise<void> {
    this.ensureWindowMessageListener();
    if (!this.frameId) {
      this.frameId = await openPackAssetFrame(this.activeTileId);
      activePackAssetFrameByTile.set(this.activeTileId, this.frameId);
    }
    const bootOut = { nonce: "" };
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.hidden = true;
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    iframe.src = await pluginSandboxFrameUrl(this.frameId, bootOut);
    this.bootNonce = bootOut.nonce;
    document.body.appendChild(iframe);
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
    if (!this.iframe) return;
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
    if (fid) sandboxAssetTokenByFrame.delete(fid);
    if (activePackAssetFrameByTile.get(tile) === fid) activePackAssetFrameByTile.delete(tile);
    if (this.onIframeLoad && this.iframe) {
      this.iframe.removeEventListener("load", this.onIframeLoad);
      this.onIframeLoad = null;
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    await closePackAssetFrameForTile(tile);
    setSandboxReady(false);
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
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      setBootWaitCancel(sandbox, null);
      fn();
    };
    const fail = (err: Error) => finish(() => reject(err));
    onReject?.(fail);
    setBootWaitCancel(sandbox, () => finish(() => resolve()));
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`sandbox ${type} timeout`)));
    }, sandboxMsgTimeoutMs);
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
      window.clearTimeout(timer);
      port.removeEventListener("message", onMsg);
      setBootWaitCancel(sandbox, null);
      fn();
    };
    const fail = (err: Error) => finish(() => reject(err));
    onReject?.(fail);
    setBootWaitCancel(sandbox, () => finish(() => resolve()));
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`sandbox ${type} timeout`)));
    }, sandboxMsgTimeoutMs);
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
