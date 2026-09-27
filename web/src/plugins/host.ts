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
  type HostBootChannelMsg,
  type HostPortMsg,
  type PluginPortMsg,
} from "./sandbox-channel";
import {
  applyPackNavigationStoppedNotice,
  clearPackNavigationStopped,
  markPackNavigationStopped,
  registerPackNavigationRemove,
} from "./pack-asset-navigation";
import { noteSandboxWrite, setSandboxReady } from "./viz-drive";
import { syncVizTileScope } from "./viz-tile-budget";

/** Test hook: shorten sandbox handshake waits. */
let sandboxMsgTimeoutMs = 15_000;
let sandboxBootWaitInTests = false;

export function setSandboxMsgTimeoutMs(ms: number): void {
  sandboxMsgTimeoutMs = Math.max(1, ms | 0);
}

export function setSandboxBootWaitInTests(on: boolean): void {
  sandboxBootWaitInTests = on;
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
  return (
    activePackAssetFrameByTile.get(tileId)
    || packAssetFrameForTile(tileId)
    || (import.meta.env.MODE === "test" ? TEST_FALLBACK_FRAME_ID : "")
  );
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

export function hostAllows(type: string, caps: string[]): boolean {
  if (type === "drawState" || type === "loseHostContext") return true;
  if (type === "setStyle" || type === "setNodeColor") return caps.includes("graph.style");
  if (
    type === "writeBuffer"
    || type === "writeUniform"
    || type === "writeParticles"
    || type === "publishBitmap"
    || type === "publishBitmapFailed"
  ) {
    return caps.includes("viz.write");
  }
  if (type === "fetchPackAsset") return caps.includes("viz.read");
  return false;
}

export type HostMsg =
  | { source: "zoto-viz-plugin"; type: "frame-ready" }
  | { source: "zoto-viz-plugin"; type: "ready"; bootNonce?: string }
  | { source: "zoto-viz-plugin"; type: "setStyle"; payload: Record<string, unknown> }
  | { source: "zoto-viz-plugin"; type: "setNodeColor"; payload: { id: string; hex: number } }
  | { source: "zoto-viz-plugin"; type: "writeBuffer"; payload: { slot: number; data: number[] } }
  | { source: "zoto-viz-plugin"; type: "writeUniform"; payload: { name: string; value: VizUniformValue } }
  | { source: "zoto-viz-plugin"; type: "writeParticles"; payload: { data: number[]; stride?: number } }
  | { source: "zoto-viz-plugin"; type: "publishBitmap"; payload: { bitmap: ImageBitmap } }
  | { source: "zoto-viz-plugin"; type: "publishBitmapFailed"; payload: Record<string, never> }
  | { source: "zoto-viz-plugin"; type: "log"; payload: string }
  | { source: "zoto-viz-plugin"; type: "fetchPackAsset"; payload: { reqId: number; path: string } };

export type ParentPortMsg =
  | {
    source: typeof HOST_SOURCE;
    type: "boot";
    caps: string[];
    config: Record<string, string>;
    viz?: VizPluginContract;
    contractVersion?: number;
    moduleSrc: string;
    bootNonce: string;
    parentOrigin: string;
  }
  | { source: typeof HOST_SOURCE; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: typeof HOST_SOURCE; type: "frame"; frame: VizDataFrame }
  | { source: typeof HOST_SOURCE; type: "config"; config: Record<string, string> };

export interface PluginHostHandlers {
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
  writeBuffer?: (slot: number, data: number[]) => void;
  writeUniform?: (name: string, value: VizUniformValue) => void;
  writeParticles?: (data: number[], stride?: number) => void;
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
export async function pluginModuleSandboxUrl(id: string, hash?: string): Promise<string> {
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

  unload(): void {
    setSandboxReady(false);
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
    if (this.moduleBlobUrl) {
      URL.revokeObjectURL(this.moduleBlobUrl);
      this.moduleBlobUrl = null;
    }
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

  setDuplicateTileCount(count: number): void {
    this.iframe?.contentWindow?.postMessage(
      { source: HOST_SOURCE, type: "dupTiles", count },
      "*",
    );
  }

  private teardownPort(): void {
    if (this.hostPort) {
      try { this.hostPort.close(); } catch { /* ignore */ }
      this.hostPort.onmessage = null;
      this.hostPort = null;
    }
  }

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
    const blob = new Blob([`const zoto = globalThis.zoto;\n${plugin}\n`], { type: "text/javascript" });
    this.moduleBlobUrl = URL.createObjectURL(blob);
    await this.bootFrame(this.moduleBlobUrl, config, viz);
  }

  async loadModule(
    id: string,
    caps: string[],
    config: Record<string, string>,
    hash?: string,
    viz?: VizPluginContract,
  ): Promise<void> {
    await this.loadModuleUrl(await pluginModuleSandboxUrl(id, hash), caps, config, viz);
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
    this.frameId = await openPackAssetFrame(this.activeTileId);
    activePackAssetFrameByTile.set(this.activeTileId, this.frameId);
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
    if (import.meta.env.MODE === "test" && !sandboxBootWaitInTests) {
      await Promise.resolve();
    } else {
      await waitPluginMsg(iframe, "frame-ready", this.bootNonce, (fail) => { this.bootReject = fail; });
    }
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
    if (import.meta.env.MODE === "test" && !sandboxBootWaitInTests) {
      await Promise.resolve();
    } else {
      await waitPluginPortMsg(this.hostPort, "ready", this.bootNonce, (fail) => { this.bootReject = fail; });
    }
    this.bootReject = null;
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
    const d = ev.data as HostMsg | undefined;
    if (this.iframe && ev.source !== this.iframe.contentWindow) {
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
    this.dispatchPluginMsg(d, ev.source);
  };

  private dispatchPluginMsg(d: HostMsg | PluginPortMsg, evSource: MessageEventSource | null = null): void {
    if (!hostAllows(d.type, this.caps)) return;
    if (d.type === "setStyle") this.handlers.setStyle?.(d.payload);
    if (d.type === "setNodeColor") this.handlers.setNodeColor?.(d.payload.id, d.payload.hex);
    if (d.type === "writeBuffer") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeBuffer?.(d.payload.slot, d.payload.data);
    }
    if (d.type === "writeUniform") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeUniform?.(d.payload.name, d.payload.value as VizUniformValue);
    }
    if (d.type === "writeParticles") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeParticles?.(d.payload.data, d.payload.stride);
    }
    if (d.type === "publishBitmap") {
      const bmp = d.payload.bitmap;
      if (this.iframe && evSource !== this.iframe.contentWindow) {
        bmp.close();
        return;
      }
      try {
        this.handlers.publishBitmap?.(this.activePackId, bmp);
      } catch {
        bmp.close();
      }
      return;
    }
    if (d.type === "publishBitmapFailed") {
      this.handlers.publishBitmapFailed?.(this.activePackId);
    }
    if (d.type === "fetchPackAsset") {
      void this.replyPackAsset(evSource, d.payload.reqId, d.payload.path);
    }
  }

  private async replyPackAsset(
    evSource: MessageEventSource | null,
    reqId: number,
    relPath: string,
  ): Promise<void> {
    const target = this.iframe?.contentWindow;
    if (!target || evSource !== target || !this.activePackId) return;
    const path = relPath.replace(/^\/+/, "").replace(/\.\./g, "");
    const url = `${location.origin}/api/plugins/${encodeURIComponent(this.activePackId)}/asset/${path}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.arrayBuffer();
      target.postMessage(
        { source: HOST_SOURCE, type: "packAsset", payload: { reqId, ok: true, bytes } },
        location.origin,
      );
    } catch {
      target.postMessage(
        { source: HOST_SOURCE, type: "packAsset", payload: { reqId, ok: false } },
        location.origin,
      );
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

function recordSandboxBoot(type: HostMsg["type"]): void {
  const w = window as unknown as { __zotoSandboxBoot?: HostMsg["type"][] };
  w.__zotoSandboxBoot = [...(w.__zotoSandboxBoot ?? []), type];
}

function waitPluginMsg(
  iframe: HTMLIFrameElement,
  type: HostMsg["type"],
  expectedBootNonce: string,
  onReject?: (fail: (err: Error) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      reject(err);
    };
    onReject?.(fail);
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error(`sandbox ${type} timeout`));
    }, sandboxMsgTimeoutMs);
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const d = ev.data as HostMsg | undefined;
      if (d?.source !== "zoto-viz-plugin") return;
      if (d.type === "log" && type === "ready") {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        fail(new Error(String(d.payload ?? "sandbox module load failed")));
        return;
      }
      if (d.type === type) {
        if (type === "ready" && d.type === "ready" && d.bootNonce !== expectedBootNonce) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve();
      }
    };
    window.addEventListener("message", onMsg);
  });
}

function waitPluginPortMsg(
  port: MessagePort,
  type: PluginPortMsg["type"],
  expectedBootNonce: string,
  onReject?: (fail: (err: Error) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (err: Error) => {
      window.clearTimeout(timer);
      port.removeEventListener("message", onMsg);
      reject(err);
    };
    onReject?.(fail);
    const timer = window.setTimeout(() => {
      port.removeEventListener("message", onMsg);
      reject(new Error(`sandbox ${type} timeout`));
    }, sandboxMsgTimeoutMs);
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as PluginPortMsg | undefined;
      if (d?.source !== PLUGIN_SOURCE) return;
      if (d.type === "log" && type === "ready") {
        window.clearTimeout(timer);
        port.removeEventListener("message", onMsg);
        fail(new Error(String(d.payload ?? "sandbox module load failed")));
        return;
      }
      if (d.type === type) {
        if (type === "ready") {
          if (d.type !== "ready" || d.bootNonce !== expectedBootNonce) return;
        }
        window.clearTimeout(timer);
        port.removeEventListener("message", onMsg);
        resolve();
      }
    };
    port.addEventListener("message", onMsg);
  });
}
