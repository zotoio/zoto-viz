import { PLUGIN_SDK } from "./sdk";
import type { VizDataFrame, VizPluginContract, VizUniformValue } from "./viz-host";

const ALLOWED = new Set([
  "graph.read", "graph.style", "ui.overlay", "config.read", "viz.read", "viz.write",
]);

export function hostAllows(type: string, caps: string[]): boolean {
  if (type === "setStyle" || type === "setNodeColor") return caps.includes("graph.style");
  if (type === "writeBuffer" || type === "writeUniform" || type === "writeParticles") {
    return caps.includes("viz.write");
  }
  return false;
}

export type HostMsg =
  | { source: "zoto-viz-plugin"; type: "ready" }
  | { source: "zoto-viz-plugin"; type: "setStyle"; payload: Record<string, unknown> }
  | { source: "zoto-viz-plugin"; type: "setNodeColor"; payload: { id: string; hex: number } }
  | { source: "zoto-viz-plugin"; type: "writeBuffer"; payload: { slot: number; data: number[] } }
  | { source: "zoto-viz-plugin"; type: "writeUniform"; payload: { name: string; value: VizUniformValue } }
  | { source: "zoto-viz-plugin"; type: "writeParticles"; payload: { data: number[]; stride?: number } }
  | { source: "zoto-viz-plugin"; type: "log"; payload: string }
  | { source: "zoto-viz-plugin"; type: "drawState"; payload: { drawing: boolean } }
  | { source: "zoto-viz-plugin"; type: "loseHostContext"; payload?: Record<string, never> };

export type ParentMsg =
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
  drawState?: (drawing: boolean) => void;
  loseHostContext?: () => void;
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

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private caps: string[] = [];
  private vizContract: VizPluginContract | undefined;
  handlers: PluginHostHandlers = {};

  constructor() {
    window.addEventListener("message", this.onMessage);
  }

  unload(): void {
    this.iframe?.remove();
    this.iframe = null;
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
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("csp", "default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline'");
    iframe.hidden = true;
    iframe.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    const plugin = js.replace(/<\/script/gi, "<\\/script");
    iframe.srcdoc = `<!doctype html><meta charset="utf-8">
<script>window.__zotoConfig = ${JSON.stringify(config)};</script>
<script data-caps='${JSON.stringify(this.caps)}'>${PLUGIN_SDK}</script>
<script type="module">const zoto = globalThis.zoto; ${plugin}</script>`;
    document.body.appendChild(iframe);
    this.iframe = iframe;
    this.iframe.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "init", caps: this.caps, config, viz } satisfies ParentMsg,
      "*",
    );
  }

  async loadModule(
    id: string,
    caps: string[],
    config: Record<string, string>,
    hash?: string,
    viz?: VizPluginContract,
  ): Promise<void> {
    const r = await fetch(pluginModuleUrl(id, hash));
    if (!r.ok) throw new Error(`module ${r.status}`);
    const js = await r.text();
    await this.load(id, js, caps, config, viz);
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
    if (!hostAllows(d.type, this.caps)) return;
    if (d.type === "setStyle") this.handlers.setStyle?.(d.payload);
    if (d.type === "setNodeColor") this.handlers.setNodeColor?.(d.payload.id, d.payload.hex);
    if (d.type === "writeBuffer") this.handlers.writeBuffer?.(d.payload.slot, d.payload.data);
    if (d.type === "writeUniform") this.handlers.writeUniform?.(d.payload.name, d.payload.value);
    if (d.type === "writeParticles") this.handlers.writeParticles?.(d.payload.data, d.payload.stride);
    if (d.type === "drawState") this.handlers.drawState?.(d.payload.drawing);
    if (d.type === "loseHostContext") this.handlers.loseHostContext?.();
  };
}
