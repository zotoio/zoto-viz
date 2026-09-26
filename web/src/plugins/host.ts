import { mintPackAssetToken } from "../core/http";
import { PLUGIN_SDK } from "./sdk";
import type { VizDataFrame, VizPluginContract, VizUniformValue } from "./viz-host";
import { noteSandboxWrite, setSandboxReady } from "./viz-drive";

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

const ALLOWED = new Set([
  "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
]);

const PACK_ASSETS_PREFIX = "/pack-assets/";
const SANDBOX_PACK = "_sandbox";

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

export async function packAssetUrl(packId: string, ...parts: string[]): Promise<string> {
  const token = await mintPackAssetToken(packId);
  return packAssetUrlWithToken(token, packId, ...parts);
}

let sandboxBootNonce = "";

export function sandboxBootNonceForTests(): string {
  return sandboxBootNonce;
}

/** Same-origin bootstrap page for the sandboxed iframe (no srcdoc / inline script). */
export async function pluginSandboxFrameUrl(): Promise<string> {
  const token = await mintPackAssetToken(SANDBOX_PACK);
  sandboxBootNonce = crypto.randomUUID();
  const path = packAssetUrlWithToken(token, SANDBOX_PACK, "plugin-sandbox.html");
  return `${location.origin}${path}#zoto-boot=${encodeURIComponent(sandboxBootNonce)}`;
}

export function hostAllows(type: string, caps: string[]): boolean {
  if (type === "setStyle" || type === "setNodeColor") return caps.includes("graph.style");
  if (type === "writeBuffer" || type === "writeUniform" || type === "writeParticles") {
    return caps.includes("viz.write");
  }
  return false;
}

export type HostMsg =
  | { source: "zoto-viz-plugin"; type: "frame-ready" }
  | { source: "zoto-viz-plugin"; type: "ready" }
  | { source: "zoto-viz-plugin"; type: "setStyle"; payload: Record<string, unknown> }
  | { source: "zoto-viz-plugin"; type: "setNodeColor"; payload: { id: string; hex: number } }
  | { source: "zoto-viz-plugin"; type: "writeBuffer"; payload: { slot: number; data: number[] } }
  | { source: "zoto-viz-plugin"; type: "writeUniform"; payload: { name: string; value: VizUniformValue } }
  | { source: "zoto-viz-plugin"; type: "writeParticles"; payload: { data: number[]; stride?: number } }
  | { source: "zoto-viz-plugin"; type: "log"; payload: string };

export type ParentMsg =
  | {
    source: "zoto-viz-host";
    type: "boot";
    caps: string[];
    config: Record<string, string>;
    viz?: VizPluginContract;
    moduleSrc: string;
    bootNonce: string;
    parentOrigin: string;
  }
  | { source: "zoto-viz-host"; type: "init"; caps: string[]; config: Record<string, string>; viz?: VizPluginContract }
  | { source: "zoto-viz-host"; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: "zoto-viz-host"; type: "frame"; frame: VizDataFrame }
  | { source: "zoto-viz-host"; type: "config"; config: Record<string, string> };

export interface PluginHostHandlers {
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
  writeBuffer?: (slot: number, data: number[]) => void;
  writeUniform?: (name: string, value: VizUniformValue) => void;
  writeParticles?: (data: number[], stride?: number) => void;
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

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private caps: string[] = [];
  private vizContract: VizPluginContract | undefined;
  private moduleBlobUrl: string | null = null;
  private bootReject: ((err: Error) => void) | null = null;
  handlers: PluginHostHandlers = {};
  /** Mosaic tile or `main` receiving sandbox plugin writes. */
  activeTileId = "main";

  setActiveTile(tileId: string): void {
    const id = tileId.trim();
    this.activeTileId = id || "main";
  }

  constructor() {
    window.addEventListener("message", this.onMessage);
  }

  unload(): void {
    setSandboxReady(false);
    this.bootReject = null;
    if (this.moduleBlobUrl) {
      URL.revokeObjectURL(this.moduleBlobUrl);
      this.moduleBlobUrl = null;
    }
    if (this.iframe) {
      this.iframe.src = "about:blank";
      this.iframe.remove();
    }
    this.iframe = null;
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
    this.caps = caps.filter((c) => ALLOWED.has(c));
    this.vizContract = viz;
    await this.bootFrame(moduleSrc, config, viz);
  }

  private async bootFrame(
    moduleSrc: string,
    config: Record<string, string>,
    viz?: VizPluginContract,
  ): Promise<void> {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.hidden = true;
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    iframe.src = await pluginSandboxFrameUrl();
    document.body.appendChild(iframe);
    this.iframe = iframe;
    if (iframe.srcdoc) {
      throw new Error("plugin sandbox must not use srcdoc under page CSP");
    }
    if (import.meta.env.MODE === "test" && !sandboxBootWaitInTests) {
      await Promise.resolve();
    } else {
      await waitPluginMsg(iframe, "frame-ready", (fail) => { this.bootReject = fail; });
    }
    iframe.contentWindow?.postMessage({
      source: "zoto-viz-host",
      type: "boot",
      caps: this.caps,
      config,
      viz,
      moduleSrc,
      bootNonce: sandboxBootNonce,
      parentOrigin: location.origin,
    } satisfies ParentMsg, location.origin);
    if (import.meta.env.MODE === "test" && !sandboxBootWaitInTests) {
      await Promise.resolve();
    } else {
      await waitPluginMsg(iframe, "ready", (fail) => { this.bootReject = fail; });
    }
    this.bootReject = null;
  }

  tick(nodes: { id: string; rate: number; role: string }[]): void {
    if (!this.caps.includes("graph.read")) return;
    this.iframe?.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "tick", nodes } satisfies ParentMsg,
      location.origin,
    );
  }

  frame(data: VizDataFrame): void {
    if (!this.caps.includes("viz.read")) return;
    this.iframe?.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "frame", frame: data } satisfies ParentMsg,
      location.origin,
    );
  }

  contract(): VizPluginContract | undefined {
    return this.vizContract;
  }

  private onMessage = (ev: MessageEvent): void => {
    if (this.iframe && ev.source !== this.iframe.contentWindow) return;
    const d = ev.data as HostMsg | undefined;
    if (!d || d.source !== "zoto-viz-plugin") return;
    if (d.type === "frame-ready" || d.type === "ready") {
      recordSandboxBoot(d.type);
      if (d.type === "ready") setSandboxReady(true);
      return;
    }
    if (d.type === "log" && this.bootReject) {
      const fail = this.bootReject;
      this.bootReject = null;
      fail(new Error(String(d.payload ?? "sandbox module load failed")));
      return;
    }
    if (!hostAllows(d.type, this.caps)) return;
    if (d.type === "setStyle") this.handlers.setStyle?.(d.payload);
    if (d.type === "setNodeColor") this.handlers.setNodeColor?.(d.payload.id, d.payload.hex);
    if (d.type === "writeBuffer") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeBuffer?.(d.payload.slot, d.payload.data);
    }
    if (d.type === "writeUniform") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeUniform?.(d.payload.name, d.payload.value);
    }
    if (d.type === "writeParticles") {
      noteSandboxWrite(this.activeTileId);
      this.handlers.writeParticles?.(d.payload.data, d.payload.stride);
    }
  };
}

function recordSandboxBoot(type: HostMsg["type"]): void {
  const w = window as unknown as { __zotoSandboxBoot?: HostMsg["type"][] };
  w.__zotoSandboxBoot = [...(w.__zotoSandboxBoot ?? []), type];
}

function waitPluginMsg(
  iframe: HTMLIFrameElement,
  type: HostMsg["type"],
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
        window.clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve();
      }
    };
    window.addEventListener("message", onMsg);
  });
}
