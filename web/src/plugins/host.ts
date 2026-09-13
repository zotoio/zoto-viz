import { PLUGIN_SDK } from "./sdk";

const ALLOWED = new Set(["graph.read", "graph.style", "ui.overlay", "config.read"]);

export function hostAllows(type: string, caps: string[]): boolean {
  if (type === "setStyle" || type === "setNodeColor") return caps.includes("graph.style");
  return false;
}

export type HostMsg =
  | { source: "zoto-viz-plugin"; type: "ready" }
  | { source: "zoto-viz-plugin"; type: "setStyle"; payload: Record<string, unknown> }
  | { source: "zoto-viz-plugin"; type: "setNodeColor"; payload: { id: string; hex: number } }
  | { source: "zoto-viz-plugin"; type: "log"; payload: string };

export type ParentMsg =
  | { source: "zoto-viz-host"; type: "init"; caps: string[]; config: Record<string, string> }
  | { source: "zoto-viz-host"; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: "zoto-viz-host"; type: "config"; config: Record<string, string> };

export interface PluginHostHandlers {
  setStyle?: (s: Record<string, unknown>) => void;
  setNodeColor?: (id: string, hex: number) => void;
}

const TS_STORE = "zoto-viz.tsPlugins";
const HASH_STORE = "zoto-viz.tsHashes";

export function tsPluginsAllowed(): boolean {
  return localStorage.getItem(TS_STORE) === "1";
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

export class PluginSandbox {
  private iframe: HTMLIFrameElement | null = null;
  private caps: string[] = [];
  handlers: PluginHostHandlers = {};

  constructor() {
    window.addEventListener("message", this.onMessage);
  }

  unload(): void {
    this.iframe?.remove();
    this.iframe = null;
  }

  async load(id: string, js: string, caps: string[], config: Record<string, string>): Promise<void> {
    this.unload();
    this.caps = caps.filter((c) => ALLOWED.has(c));
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
  }

  tick(nodes: { id: string; rate: number; role: string }[]): void {
    this.iframe?.contentWindow?.postMessage(
      { source: "zoto-viz-host", type: "tick", nodes } satisfies ParentMsg,
      "*",
    );
  }

  private onMessage = (ev: MessageEvent): void => {
    if (this.iframe && ev.source !== this.iframe.contentWindow) return;
    const d = ev.data as HostMsg | undefined;
    if (!d || d.source !== "zoto-viz-plugin") return;
    if (!hostAllows(d.type, this.caps)) return;
    if (d.type === "setStyle") this.handlers.setStyle?.(d.payload);
    if (d.type === "setNodeColor") this.handlers.setNodeColor?.(d.payload.id, d.payload.hex);
  };
}
