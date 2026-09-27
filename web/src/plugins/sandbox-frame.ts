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
  bootNonce: string;
  parentOrigin: string;
};

const PACK_ASSETS = "/pack-assets/";
const TOKEN_REDACT = "<sandbox-token>";

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
let bootDone = false;
let postTargetOrigin = "";

function send(type: string, payload?: unknown): void {
  const origin = postTargetOrigin || location.origin;
  parent.postMessage({ source: "zoto-viz-plugin", type, payload }, origin);
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

function applyInit(d: { caps?: string[]; config?: Record<string, string>; viz?: unknown; contractVersion?: number }): void {
  allowed = new Set(d.caps ?? []);
  (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig = d.config || {};
  (window as unknown as { __zotoViz?: unknown }).__zotoViz = d.viz || null;
  const viz = d.viz as { contract?: number } | null | undefined;
  const version = typeof d.contractVersion === "number"
    ? d.contractVersion
    : typeof viz?.contract === "number"
      ? viz.contract
      : undefined;
  if (typeof version === "number") {
    (window as unknown as { __zotoContractVersion?: number }).__zotoContractVersion = version;
  }
  patchVizWriters();
}

/** Host → sandbox dispatch (unit-tested; hot path passes message tick by reference). */
export function handleSandboxHostMessage(
  d: HostMsg | HostBoot | undefined,
  caps: Set<string>,
  api: SandboxZoto,
  opts?: { source?: MessageEventSource | null; bootNonce?: string; bootDone?: boolean },
): void {
  if (!d || d.source !== "zoto-viz-host") return;
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

export function handleSandboxBootMessage(
  ev: MessageEvent,
  opts: { bootDone: boolean; bootNonce: string },
): { bootDone: boolean; postTargetOrigin: string } {
  const d = ev.data as HostBoot | undefined;
  if (opts.bootDone) return { bootDone: true, postTargetOrigin: postTargetOrigin };
  if (!d || d.source !== "zoto-viz-host" || d.type !== "boot") {
    return { bootDone: opts.bootDone, postTargetOrigin: postTargetOrigin };
  }
  if (ev.source !== window.parent) return { bootDone: opts.bootDone, postTargetOrigin: postTargetOrigin };
  if (!d.bootNonce || d.bootNonce !== opts.bootNonce) {
    return { bootDone: opts.bootDone, postTargetOrigin: postTargetOrigin };
  }
  if (!d.parentOrigin) return { bootDone: opts.bootDone, postTargetOrigin: postTargetOrigin };
  applyInit(d);
  return { bootDone: true, postTargetOrigin: d.parentOrigin };
}

window.addEventListener("message", (ev) => {
  handleSandboxHostMessage(ev.data as HostMsg | HostBoot | undefined, allowed, zoto, {
    source: ev.source,
    bootDone,
    bootNonce: bootNonceFromLocation(),
  });
});

window.addEventListener("message", async (ev) => {
  const nonce = bootNonceFromLocation();
  const out = handleSandboxBootMessage(ev, { bootDone, bootNonce: nonce });
  bootDone = out.bootDone;
  postTargetOrigin = out.postTargetOrigin;
  if (!bootDone) return;
  const d = ev.data as HostBoot;
  if (d.type !== "boot") return;
  const token = packAssetTokenFromLocation();
  try {
    await import(/* @vite-ignore */ moduleSrcForSandbox(d.moduleSrc, token));
    send("ready");
  } catch (e) {
    const raw = String(e);
    send("log", redactSandboxAssetPath(raw, token));
  }
});

send("frame-ready");
