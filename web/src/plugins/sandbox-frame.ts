/**
 * Same-origin plugin runtime frame (loaded in a sandboxed iframe).
 * External module only — no inline script, so the app CSP never needs 'unsafe-inline'.
 */

/** Matches contract v2 `VizPresentTick` (plugins/sdk/viz-contract.ts on host-change). */
export type VizPresentTick = {
  frameMs: number;
  tileId: string;
  pluginClock?: number;
};

type HostBoot = {
  source: "zoto-viz-host";
  type: "boot";
  caps: string[];
  config: Record<string, string>;
  viz?: unknown;
  moduleSrc: string;
  /** Session asset token for opaque-origin pack fetches (follow-up: host-posted blob module). */
  sandboxAssetToken?: string;
};

const PACK_ASSETS = "/pack-assets/";
const TOKEN_REDACT = "<sandbox-token>";

function moduleSrcForSandbox(src: string, token?: string): string {
  if (src.startsWith("blob:")) return src;
  try {
    const u = new URL(src, location.href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return src;
    if (u.pathname.startsWith(PACK_ASSETS)) return u.href;
    const api = u.pathname.match(/^\/api\/plugins\/([^/]+)\/module\.js$/);
    if (api && token) {
      const packId = decodeURIComponent(api[1]);
      const segs = [encodeURIComponent(token), encodeURIComponent(packId), "module.js"];
      u.pathname = `${PACK_ASSETS}${segs.join("/")}`;
      u.search = "";
      return u.href;
    }
    return u.href;
  } catch {
    return src;
  }
}

/** Redact session token segments before posting to the host console. */
export function redactSandboxAssetPath(text: string, token?: string): string {
  if (!text || !token) return text;
  return text
    .split(token)
    .join(TOKEN_REDACT)
    .split(`/pack-assets/${token}/`)
    .join(`/pack-assets/${TOKEN_REDACT}/`);
}

type HostMsg =
  | { source: "zoto-viz-host"; type: "init"; caps: string[]; config: Record<string, string>; viz?: unknown }
  | { source: "zoto-viz-host"; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: "zoto-viz-host"; type: "frame"; frame: unknown }
  | { source: "zoto-viz-host"; type: "present"; tick: VizPresentTick }
  | { source: "zoto-viz-host"; type: "config"; config: Record<string, string> };

export type SandboxZoto = {
  onTick: ((nodes: { id: string; rate: number; role: string }[]) => void) | null;
  onConfig: ((config: Record<string, string>) => void) | null;
  onFrame: ((frame: unknown) => void) | null;
  onPresent: ((tick: VizPresentTick) => void) | null;
  setStyle(s: Record<string, unknown>): void;
  setNodeColor(id: string, hex: number): void;
  writeBuffer(_slot: number, _data: number[] | ArrayLike<number>): void;
  writeUniform(_name: string, _value: unknown): void;
  writeParticles(_data: number[] | ArrayLike<number>, _stride?: number): void;
  getConfig(): Record<string, string>;
};

let allowed = new Set<string>();

function send(type: string, payload?: unknown): void {
  parent.postMessage({ source: "zoto-viz-plugin", type, payload }, "*");
}

const zoto: SandboxZoto = {
  onTick: null,
  onConfig: null,
  onFrame: null,
  onPresent: null,
  setStyle(s) { if (allowed.has("graph.style")) send("setStyle", s); },
  setNodeColor(id, hex) { if (allowed.has("graph.style")) send("setNodeColor", { id, hex }); },
  writeBuffer(_slot, _data) { /* viz.write patched after boot */ },
  writeUniform(_name, _value) { /* viz.write patched after boot */ },
  writeParticles(_data, _stride) { /* viz.write patched after boot */ },
  getConfig() { return (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig || {}; },
};

(globalThis as unknown as { zoto: SandboxZoto }).zoto = zoto;

function vizAllowed(cap: string): boolean {
  return allowed.has(cap);
}

function patchVizWriters(): void {
  zoto.writeBuffer = (slot, data) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    send("writeBuffer", { slot, data: arr });
  };
  zoto.writeUniform = (name, value) => {
    if (!vizAllowed("viz.write")) return;
    send("writeUniform", { name, value });
  };
  zoto.writeParticles = (data, stride) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    send("writeParticles", { data: arr, stride: stride || 4 });
  };
}

function applyInit(d: { caps?: string[]; config?: Record<string, string>; viz?: unknown }): void {
  allowed = new Set(d.caps ?? []);
  (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig = d.config || {};
  (window as unknown as { __zotoViz?: unknown }).__zotoViz = d.viz || null;
  patchVizWriters();
}

/** Host → sandbox dispatch (unit-tested; hot path passes message tick by reference). */
export function handleSandboxHostMessage(
  d: HostMsg | HostBoot | undefined,
  caps: Set<string>,
  api: SandboxZoto,
): void {
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "config") {
    (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig = d.config || {};
    api.onConfig?.(d.config || {});
    return;
  }
  if (d.type === "tick" && caps.has("graph.read") && api.onTick) api.onTick(d.nodes);
  if (d.type === "frame" && caps.has("viz.read") && api.onFrame) api.onFrame(d.frame);
  if (d.type === "present" && caps.has("viz.write")) {
    const fn = api.onPresent;
    if (fn) fn(d.tick);
  }
}

window.addEventListener("message", (ev) => {
  handleSandboxHostMessage(ev.data as HostMsg | HostBoot | undefined, allowed, zoto);
});

window.addEventListener("message", async (ev) => {
  const d = ev.data as HostBoot | undefined;
  if (!d || d.source !== "zoto-viz-host" || d.type !== "boot") return;
  applyInit(d);
  try {
    await import(/* @vite-ignore */ moduleSrcForSandbox(d.moduleSrc, d.sandboxAssetToken));
    send("ready");
  } catch (e) {
    const raw = String(e);
    send("log", redactSandboxAssetPath(raw, d.sandboxAssetToken));
  }
});

send("frame-ready");
