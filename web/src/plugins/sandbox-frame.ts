/**
 * Same-origin plugin runtime frame (loaded in a sandboxed iframe).
 * External module only — no inline script, so the app CSP never needs 'unsafe-inline'.
 */

import {
  HOST_SOURCE,
  isHostBootChannel,
  PLUGIN_SOURCE,
  type HostBootPayload,
  type HostPortMsg,
  type PluginPortMsg,
} from "./sandbox-channel";

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
};

type HostMsg =
  | { source: "zoto-viz-host"; type: "init"; caps: string[]; config: Record<string, string>; viz?: unknown }
  | { source: "zoto-viz-host"; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: "zoto-viz-host"; type: "frame"; frame: unknown }
  | { source: "zoto-viz-host"; type: "present"; tick: VizPresentTick }
  | { source: "zoto-viz-host"; type: "config"; config: Record<string, string> };
const PACK_ASSETS = "/pack-assets/";
const TOKEN_REDACT = "<sandbox-token>";

/** Best-effort WebRTC lockdown before any pack module loads (CSP does not cover WebRTC). */
export function freezeSandboxWebRtc(): void {
  const names = ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"];
  for (const name of names) {
    try {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        writable: false,
        value: undefined,
      });
    } catch {
      try {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (globalThis as Record<string, unknown>)[name];
      } catch { /* ignore */ }
    }
  }
}

freezeSandboxWebRtc();

export function packAssetTokenFromLocation(href = location.href): string {
  try {
    const p = new URL(href).pathname;
    const m = p.match(/^\/pack-assets\/([^/]+)\//);
    return m?.[1] ? decodeURIComponent(m[1]) : "";
  } catch {
    return "";
  }
}

export function bootNonceFromLocation(href = location.href): string {
  try {
    const h = new URL(href).hash.replace(/^#/, "");
    const params = new URLSearchParams(h.startsWith("zoto-boot=") ? h : h.replace(/^.*\?/, ""));
    if (h.startsWith("zoto-boot=")) {
      return decodeURIComponent(h.slice("zoto-boot=".length));
    }
    return params.get("zoto-boot") || "";
  } catch {
    return "";
  }
}

function moduleSrcForSandbox(src: string, token: string): string {
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
  const t = (token ?? packAssetTokenFromLocation()).trim();
  if (!text || !t) return text;
  return text
    .split(t)
    .join(TOKEN_REDACT)
    .split(`/pack-assets/${t}/`)
    .join(`/pack-assets/${TOKEN_REDACT}/`);
}

type HostMsg =
  | { source: typeof HOST_SOURCE; type: "init"; caps: string[]; config: Record<string, string>; viz?: unknown }
  | { source: typeof HOST_SOURCE; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: typeof HOST_SOURCE; type: "frame"; frame: unknown }
  | { source: typeof HOST_SOURCE; type: "present"; tick: VizPresentTick }
  | { source: typeof HOST_SOURCE; type: "config"; config: Record<string, string> };

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
let bootDone = false;
let postTargetOrigin = "";
let hostPort: MessagePort | null = null;

function send(type: string, payload?: unknown): void {
  let msg: PluginPortMsg;
  if (type === "ready") {
    msg = {
      source: PLUGIN_SOURCE,
      type: "ready",
      bootNonce: (payload as { bootNonce?: string } | undefined)?.bootNonce,
    };
  } else if (type === "log") {
    msg = { source: PLUGIN_SOURCE, type: "log", payload: String(payload ?? "") };
  } else if (type === "setStyle") {
    msg = { source: PLUGIN_SOURCE, type: "setStyle", payload: payload as Record<string, unknown> };
  } else if (type === "setNodeColor") {
    msg = { source: PLUGIN_SOURCE, type: "setNodeColor", payload: payload as { id: string; hex: number } };
  } else if (type === "writeBuffer") {
    msg = { source: PLUGIN_SOURCE, type: "writeBuffer", payload: payload as { slot: number; data: number[] } };
  } else if (type === "writeUniform") {
    msg = { source: PLUGIN_SOURCE, type: "writeUniform", payload: payload as { name: string; value: unknown } };
  } else if (type === "writeParticles") {
    msg = {
      source: PLUGIN_SOURCE,
      type: "writeParticles",
      payload: payload as { data: number[]; stride?: number },
    };
  } else if (type === "frame-ready") {
    parent.postMessage({ source: PLUGIN_SOURCE, type: "frame-ready" }, window.location.origin);
    return;
  } else {
    msg = { source: PLUGIN_SOURCE, type: "log", payload: `unknown sandbox send type: ${type}` };
  }
  if (hostPort) {
    hostPort.postMessage(msg);
    return;
  }
  const origin = postTargetOrigin || location.origin;
  parent.postMessage(msg, origin);
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
  d: HostMsg | HostBootPayload | undefined,
  caps: Set<string>,
  api: SandboxZoto,
  opts?: { source?: MessageEventSource | null; bootNonce?: string; bootDone?: boolean },
): void {
  if (!d || d.source !== HOST_SOURCE) return;
  if (d.type === "boot") return;
  if (opts?.source && opts.source !== window.parent) return;
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
    await import(/* @vite-ignore */ d.moduleSrc);
    send("ready");
  } catch (e) {
    send("log", String(e));
export function handleSandboxBootChannel(
  ev: MessageEvent,
  opts: { bootNonce: string; bootDone: boolean },
): { bootDone: boolean; postTargetOrigin: string; port: MessagePort | null } {
  if (opts.bootDone) {
    return { bootDone: true, postTargetOrigin, port: hostPort };
  }
  if (ev.source !== window.parent) {
    return { bootDone: false, postTargetOrigin, port: hostPort };
  }
  if (!isHostBootChannel(ev.data)) {
    return { bootDone: false, postTargetOrigin, port: hostPort };
  }
  const d = ev.data;
  if (d.bootNonce !== opts.bootNonce) {
    return { bootDone: false, postTargetOrigin, port: hostPort };
  }
  if (ev.origin !== window.location.origin) {
    return { bootDone: false, postTargetOrigin, port: hostPort };
  }
  const port = ev.ports?.[0] ?? null;
  if (!port) return { bootDone: false, postTargetOrigin, port: hostPort };
  return { bootDone: false, postTargetOrigin: d.parentOrigin, port };
}

export async function handleSandboxBootPayload(
  d: HostBootPayload,
  nonce: string,
): Promise<void> {
  if (bootDone) return;
  if (d.bootNonce !== nonce) return;
  if (!d.parentOrigin) return;
  applyInit(d);
  bootDone = true;
  postTargetOrigin = d.parentOrigin;
  const token = packAssetTokenFromLocation();
  try {
    await import(/* @vite-ignore */ moduleSrcForSandbox(d.moduleSrc, token));
    send("ready", { bootNonce: nonce });
  } catch (e) {
    const raw = String(e);
    send("log", redactSandboxAssetPath(raw, token));
  }
}

export function handleSandboxPortMessage(
  data: HostPortMsg | undefined,
  caps: Set<string>,
  api: SandboxZoto,
  nonce: string,
): void {
  if (!data || data.source !== HOST_SOURCE) return;
  if (data.type === "boot") {
    if (bootDone) return;
    void handleSandboxBootPayload(data, nonce);
    return;
  }
  handleSandboxHostMessage(data, caps, api);
}

export function attachSandboxPort(
  port: MessagePort,
  nonce: string,
): void {
  hostPort = port;
  port.start();
  port.onmessage = (ev) => {
    handleSandboxPortMessage(ev.data as HostPortMsg, allowed, zoto, nonce);
  };
}

window.addEventListener("message", (ev) => {
  const nonce = bootNonceFromLocation();
  const ch = handleSandboxBootChannel(ev, { bootDone: !!hostPort, bootNonce: nonce });
  if (ch.port) {
    postTargetOrigin = ch.postTargetOrigin;
    attachSandboxPort(ch.port, nonce);
  }
});

send("frame-ready");
