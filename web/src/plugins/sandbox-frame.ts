/**
 * Same-origin plugin runtime frame (loaded in a sandboxed iframe).
 * External module only — no inline script, so the app CSP never needs 'unsafe-inline'.
 */

import {
  HOST_SOURCE,
  PLUGIN_SOURCE,
  type HostBootPayload,
  type HostSandboxPortMsg,
  type VizPresentTick,
  isHostBootChannel,
} from "./sandbox-channel";
import type { VizUniformValue } from "./viz-host";
import {
  emptyVizWriteBatch,
  splitVizWriteBatch,
  validateVizWriteBatch,
  type VizWriteBatchPayload,
} from "./viz-write-batch";

const PACK_ASSETS = "/pack-assets/";
const TOKEN_REDACT = "<sandbox-token>";

export type { VizPresentTick };

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
  if (src.startsWith("blob:") || src.startsWith("data:")) return src;
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

export type SandboxZoto = {
  onTick: ((nodes: { id: string; rate: number; role: string }[]) => void) | null;
  onConfig: ((config: Record<string, string>) => void) | null;
  onFrame: ((frame: unknown) => void) | null;
  onPresent: ((tick: VizPresentTick) => void) | null;
  setStyle(s: Record<string, unknown>): void;
  setNodeColor(id: string, hex: number): void;
  writeBuffer(_slot: number, _data: number[] | ArrayLike<number>): void;
  writeUniform(_name: string, _value: unknown): void;
  /** @deprecated #184: no host renderer draws pack particles; draw from the sky's UBO slots (writeBuffer + zotoVizSlots). */
  writeParticles(_data: number[] | ArrayLike<number>, _stride?: number): void;
  getConfig(): Record<string, string>;
};

declare global {
  interface Window {
    __zotoConfig?: Record<string, string>;
    __zotoViz?: unknown;
    __zotoContractVersion?: number;
  }
  var zoto: SandboxZoto;
}

export type SandboxFrameRuntime = {
  allowed: Set<string>;
  bootDone: boolean;
  pluginPort: MessagePort | null;
  postTargetOrigin: string;
  /** Sandbox document URL (iframe `src`); used for `#zoto-boot` when not on `location`. */
  locationHref: string;
};

export function createSandboxFrameRuntime(): SandboxFrameRuntime {
  return {
    allowed: new Set(),
    bootDone: false,
    pluginPort: null,
    postTargetOrigin: "",
    locationHref: typeof location !== "undefined" ? location.href : "",
  };
}

let sandboxPortPostCount = 0;
const sandboxPortPostsLog: unknown[] = [];

export function sandboxPortPostCountForTests(): number {
  return sandboxPortPostCount;
}

export function sandboxPortPostsLogForTests(): readonly unknown[] {
  return sandboxPortPostsLog;
}

export function resetSandboxPortPostCountForTests(): void {
  sandboxPortPostCount = 0;
  sandboxPortPostsLog.length = 0;
}

function postPluginPort(
  runtime: SandboxFrameRuntime,
  msg: { source: typeof PLUGIN_SOURCE; type: string; bootNonce?: string; payload?: unknown },
): void {
  if (!runtime.pluginPort) return;
  sandboxPortPostCount += 1;
  sandboxPortPostsLog.push(msg);
  runtime.pluginPort.postMessage(msg);
}

let sandboxWindowPostCount = 0;

export function sandboxWindowPostCountForTests(): number {
  return sandboxWindowPostCount;
}

export function resetSandboxWindowPostCountForTests(): void {
  sandboxWindowPostCount = 0;
}

function postPluginWindow(
  runtime: SandboxFrameRuntime,
  msg: { source: typeof PLUGIN_SOURCE; type: string; payload?: unknown },
  transfer?: Transferable[],
): void {
  sandboxWindowPostCount += 1;
  const origin = runtime.postTargetOrigin || "*";
  parent.postMessage(msg, origin, transfer);
}

function send(runtime: SandboxFrameRuntime, type: string, payload?: unknown): void {
  if (runtime.pluginPort) {
    postPluginPort(runtime, { source: PLUGIN_SOURCE, type, payload });
    return;
  }
  postPluginWindow(runtime, { source: PLUGIN_SOURCE, type, payload });
}

/** Opaque-origin sandbox iframes report `location.origin` as the string "null"; never use that as targetOrigin. */
export function postFrameReadyToParent(): void {
  parent.postMessage({ source: PLUGIN_SOURCE, type: "frame-ready" }, "*");
}

let runtime = createSandboxFrameRuntime();
let allowed = runtime.allowed;

/** @internal test hook — same zoto object assigned to the sandbox iframe global. */
export const sandboxZotoApi: SandboxZoto = {
  onTick: null,
  onConfig: null,
  onFrame: null,
  onPresent: null,
  setStyle(s) { if (allowed.has("graph.style")) send(runtime, "setStyle", s); },
  setNodeColor(id, hex) { if (allowed.has("graph.style")) send(runtime, "setNodeColor", { id, hex }); },
  writeBuffer(_slot, _data) { /* viz.write patched after boot */ },
  writeUniform(_name, _value) { /* viz.write patched after boot */ },
  writeParticles(_data, _stride) { /* viz.write patched after boot */ },
  getConfig() { return window.__zotoConfig || {}; },
};

const zoto = sandboxZotoApi;
globalThis.zoto = zoto;

export function setSandboxFrameLocationHref(href: string): void {
  runtime.locationHref = href;
}

/** @internal e2e tests — shared runtime used by the sandbox-frame bundle. */
export function sandboxFrameRuntimeForTests(): SandboxFrameRuntime {
  return runtime;
}

export function resetSandboxFrameRuntimeForTests(): void {
  runtime = createSandboxFrameRuntime();
  allowed = runtime.allowed;
  vizBatch = null;
  vizBatchDepth = 0;
  vizBatchAllocateFreshForTests = false;
  vizBatchBeginIdentity = null;
  resetSandboxPortPostCountForTests();
  resetSandboxWindowPostCountForTests();
  clearVizBatchInPlace(vizBatchShell);
  zoto.onTick = null;
  zoto.onConfig = null;
  zoto.onFrame = null;
  zoto.onPresent = null;
}

function vizAllowed(cap: string): boolean {
  return allowed.has(cap);
}

const vizBatchShell: VizWriteBatchPayload = { buffers: [], uniforms: [] };
let vizBatch: VizWriteBatchPayload | null = null;
let vizBatchDepth = 0;

function clearVizBatchInPlace(batch: VizWriteBatchPayload): void {
  batch.buffers.length = 0;
  batch.uniforms.length = 0;
  delete batch.particles;
}

/** @internal count tests — backing object reused across display frames. */
export function vizWriteBatchBackingForTests(): VizWriteBatchPayload {
  return vizBatchShell;
}

let vizBatchAllocateFreshForTests = false;
let vizBatchBeginIdentity: VizWriteBatchPayload | null = null;

/** @internal revert-proof — allocate a new batch object each display frame. */
export function setVizBatchAllocateFreshForTests(on: boolean): void {
  vizBatchAllocateFreshForTests = on;
}

/** @internal count tests — batch object at the start of each display frame. */
export function vizBatchBeginIdentityForTests(): VizWriteBatchPayload | null {
  return vizBatchBeginIdentity;
}

function emitVizWriteChunk(batch: VizWriteBatchPayload): void {
  const messages = batch.buffers.length + batch.uniforms.length + (batch.particles ? 1 : 0);
  if (messages === 0) return;
  if (messages === 1 && batch.buffers.length === 1 && !batch.uniforms.length && !batch.particles) {
    const b = batch.buffers[0]!;
    send(runtime, "writeBuffer", { slot: b.slot, data: b.data });
    return;
  }
  if (messages === 1 && batch.uniforms.length === 1 && !batch.buffers.length && !batch.particles) {
    const u = batch.uniforms[0]!;
    send(runtime, "writeUniform", { name: u.name, value: u.value });
    return;
  }
  if (messages === 1 && batch.particles && !batch.buffers.length && !batch.uniforms.length) {
    const p = batch.particles;
    send(runtime, "writeParticles", { data: p.data, stride: p.stride });
    return;
  }
  send(runtime, "writeBatch", batch);
}

function flushVizBatchContents(): void {
  if (!vizBatch) return;
  const chunks = splitVizWriteBatch(vizBatch);
  if (vizBatchDepth > 0) clearVizBatchInPlace(vizBatch);
  else vizBatch = null;
  for (const chunk of chunks) emitVizWriteChunk(chunk);
}

function flushVizBatch(): void {
  flushVizBatchContents();
}

function beginVizBatch(): void {
  vizBatchDepth++;
  if (vizBatchDepth === 1) {
    vizBatch = vizBatchAllocateFreshForTests ? emptyVizWriteBatch() : vizBatchShell;
    clearVizBatchInPlace(vizBatch);
    vizBatchBeginIdentity = vizBatch;
  }
}

function endVizBatch(): void {
  if (vizBatchDepth <= 0) return;
  vizBatchDepth--;
  if (vizBatchDepth === 0) {
    flushVizBatch();
  }
}

function patchVizWriters(): void {
  zoto.writeBuffer = (slot, data) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    if (vizBatchDepth > 0 && vizBatch) {
      const entry = { slot, data: arr };
      vizBatch.buffers.push(entry);
      if (validateVizWriteBatch(vizBatch) !== null) {
        vizBatch.buffers.pop();
        flushVizBatchContents();
        vizBatch.buffers.push(entry);
      }
      return;
    }
    send(runtime, "writeBuffer", { slot, data: arr });
  };
  zoto.writeUniform = (name, value) => {
    if (!vizAllowed("viz.write")) return;
    if (vizBatchDepth > 0 && vizBatch) {
      const entry = { name, value: value as VizUniformValue };
      vizBatch.uniforms.push(entry);
      if (validateVizWriteBatch(vizBatch) !== null) {
        vizBatch.uniforms.pop();
        flushVizBatchContents();
        vizBatch.uniforms.push(entry);
      }
      return;
    }
    send(runtime, "writeUniform", { name, value });
  };
  zoto.writeParticles = (data, stride) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    if (vizBatchDepth > 0 && vizBatch) {
      const entry = { data: arr, stride: stride || 4 };
      vizBatch.particles = entry;
      if (validateVizWriteBatch(vizBatch) !== null) {
        delete vizBatch.particles;
        flushVizBatchContents();
        vizBatch.particles = entry;
      }
      return;
    }
    send(runtime, "writeParticles", { data: arr, stride: stride || 4 });
  };
}

/** @internal tests — wire viz.write batching without a full port boot. */
export function applySandboxCapsForTests(caps: string[]): void {
  applyInit({ caps });
}

function applyInit(d: { caps?: string[]; config?: Record<string, string>; viz?: unknown; contractVersion?: number }): void {
  allowed = new Set(d.caps ?? []);
  runtime.allowed = allowed;
  window.__zotoConfig = d.config || {};
  window.__zotoViz = d.viz || null;
  const viz = d.viz as { contract?: number } | null | undefined;
  const version = typeof d.contractVersion === "number"
    ? d.contractVersion
    : typeof viz?.contract === "number"
      ? viz.contract
      : undefined;
  if (typeof version === "number") {
    window.__zotoContractVersion = version;
  }
  patchVizWriters();
}

/** Host → sandbox dispatch on the MessageChannel (unit-tested; hot path passes tick by reference). */
export function handleSandboxHostMessage(
  d: HostSandboxPortMsg | undefined,
  caps: Set<string>,
  api: SandboxZoto,
): void {
  if (!d || d.source !== HOST_SOURCE) return;
  if (d.type === "config") {
    window.__zotoConfig = d.config || {};
    api.onConfig?.(d.config || {});
    return;
  }
  if (d.type === "tick" && caps.has("graph.read") && api.onTick) api.onTick(d.nodes);
  if (d.type === "frame" && caps.has("viz.read") && api.onFrame) {
    beginVizBatch();
    try {
      api.onFrame(d.frame);
    } finally {
      endVizBatch();
    }
  }
  if (d.type === "present" && caps.has("viz.write")) {
    const fn = api.onPresent;
    if (!fn) return;
    beginVizBatch();
    try {
      fn(d.tick);
    } finally {
      endVizBatch();
    }
  }
}

async function handleBootOnPort(d: HostBootPayload, rt: SandboxFrameRuntime): Promise<void> {
  applyInit(d);
  rt.postTargetOrigin = d.parentOrigin;
  const token = packAssetTokenFromLocation();
  try {
    await import(/* @vite-ignore */ moduleSrcForSandbox(d.moduleSrc, token));
    postPluginPort(rt, { source: PLUGIN_SOURCE, type: "ready", bootNonce: d.bootNonce });
  } catch (e) {
    const raw = String(e);
    postPluginPort(rt, {
      source: PLUGIN_SOURCE,
      type: "log",
      payload: redactSandboxAssetPath(raw, token),
    });
  }
}

export function attachSandboxHostPort(port: MessagePort, rt: SandboxFrameRuntime, api: SandboxZoto = zoto): void {
  rt.pluginPort = port;
  rt.bootDone = false;
  port.start();
  port.onmessage = (ev) => {
    const d = ev.data as HostBootPayload | HostSandboxPortMsg | undefined;
    if (!d || d.source !== HOST_SOURCE) return;
    if (d.type === "boot") {
      if (rt.bootDone) return;
      if (!d.bootNonce || d.bootNonce !== bootNonceFromLocation(rt.locationHref)) return;
      rt.bootDone = true;
      void handleBootOnPort(d, rt);
      return;
    }
    handleSandboxHostMessage(d as HostSandboxPortMsg, rt.allowed, api);
  };
}

export function handleSandboxBootChannelMessage(
  ev: MessageEvent,
  rt: SandboxFrameRuntime,
  api: SandboxZoto = zoto,
): void {
  if (!isHostBootChannel(ev.data)) return;
  if (ev.source !== window.parent) return;
  const nonce = bootNonceFromLocation(rt.locationHref);
  if (!nonce || ev.data.bootNonce !== nonce) return;
  const port = ev.ports[0];
  if (!port) return;
  attachSandboxHostPort(port, rt, api);
}

/** Listen for `boot-channel` on a jsdom iframe `contentWindow` (e2e tests). */
export function installSandboxBootChannelListener(win: Window, parentWin: Window): void {
  win.addEventListener("message", (ev) => {
    if (ev.source !== parentWin) return;
    handleSandboxBootChannelMessage(ev, runtime, zoto);
  });
}

function isSandboxBootstrapDocument(): boolean {
  try {
    const path = new URL(location.href).pathname;
    return path.endsWith("/plugin-sandbox.html") || path.endsWith("plugin-sandbox.html")
      || location.hash.includes("zoto-boot=");
  } catch {
    return false;
  }
}

/** Entry when this module is the sole script in plugin-sandbox.html. */
export function activateSandboxFrameBundle(): void {
  window.addEventListener("message", (ev) => {
    handleSandboxBootChannelMessage(ev, runtime, zoto);
  });
  postFrameReadyToParent();
}

if (typeof window !== "undefined" && isSandboxBootstrapDocument()) {
  activateSandboxFrameBundle();
}
