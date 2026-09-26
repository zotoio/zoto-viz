import { PLUGIN_SDK } from "./sdk";
import type { VizDataFrame, VizPluginContract, VizUniformValue } from "./viz-host";
import { noteSandboxWrite, setSandboxReady } from "./viz-drive";

const ALLOWED = new Set([
  "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
]);

/** Same-origin bootstrap page for the sandboxed iframe (no srcdoc / inline script). */
export function pluginSandboxFrameUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  const root = base.endsWith("/") ? base : `${base}/`;
  return new URL("plugin-sandbox.html", `${location.origin}${root}`).href;
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
  return hash ? `${path}?h=${encodeURIComponent(hash)}` : path;
}

/** @deprecated Legacy inline bootstrap kept for tests that assert SDK shape. */
export const LEGACY_SRCDOC_SDK = PLUGIN_SDK;

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private caps: string[] = [];
  private vizContract: VizPluginContract | undefined;
  private moduleBlobUrl: string | null = null;
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
    const rel = pluginModuleUrl(id, hash);
    const r = await fetch(rel);
    if (!r.ok) throw new Error(`module ${r.status}`);
    const js = await r.text();
    await this.load(id, js, caps, config, viz);
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
    iframe.src = pluginSandboxFrameUrl();
    document.body.appendChild(iframe);
    this.iframe = iframe;
    if (iframe.srcdoc) {
      throw new Error("plugin sandbox must not use srcdoc under page CSP");
    }
    if (import.meta.env.MODE === "test") {
      await Promise.resolve();
    } else {
      await waitPluginMsg(iframe, "frame-ready");
    }
    iframe.contentWindow?.postMessage({
      source: "zoto-viz-host",
      type: "boot",
      caps: this.caps,
      config,
      viz,
      moduleSrc,
    } satisfies ParentMsg, "*");
    if (import.meta.env.MODE === "test") {
      await Promise.resolve();
    } else {
      await waitPluginMsg(iframe, "ready");
    }
  }

  tick(nodes: { id: string; rate: number; role: string }[]): void {
    if (!this.caps.includes("graph.read")) return;
    this.iframe?.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "tick", nodes } satisfies ParentMsg,
      "*",
    );
  }

  frame(data: VizDataFrame): void {
    if (!this.caps.includes("viz.read")) return;
    this.iframe?.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "frame", frame: data } satisfies ParentMsg,
      "*",
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

function waitPluginMsg(iframe: HTMLIFrameElement, type: HostMsg["type"]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error(`sandbox ${type} timeout`));
    }, 15000);
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      const d = ev.data as HostMsg | undefined;
      if (d?.source === "zoto-viz-plugin" && d.type === type) {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        resolve();
      }
    };
    window.addEventListener("message", onMsg);
  });
}
