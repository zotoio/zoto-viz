/**
 * Optional glTF/GLB model slot for procedural viz packs (ZotoDesigner drop-in).
 * When no model is loaded the shader keeps procedural art (flags → useProcedural).
 */

export const PACK_MODEL_CONFIG_KEY = "modelGlb";

/** Bit flags packed into slot0 modelFlags float (integer part). */
export const PACK_MODEL_FLAG_PROCEDURAL = 1;
export const PACK_MODEL_FLAG_LOADED = 2;
export const PACK_MODEL_FLAG_PENDING = 4;
export const PACK_MODEL_FLAG_CONFIGURED = 8;

const GLB_MAGIC = 0x46546c67;

export type PackModelSlotState = {
  path: string;
  flags: number;
  /** Normalized scale hint for future mesh instancing (1 = unit). */
  scale: number;
};

export function parsePackModelPath(cfg: Record<string, string | undefined> | null | undefined): string {
  if (!cfg) return "";
  const raw = (cfg[PACK_MODEL_CONFIG_KEY] ?? cfg.modelSlot ?? "").trim();
  if (!raw || raw === "none" || raw === "off") return "";
  return raw.replace(/^\/+/, "");
}

export function initialPackModelSlotState(cfg: Record<string, string | undefined> | null | undefined): PackModelSlotState {
  const path = parsePackModelPath(cfg);
  let flags = PACK_MODEL_FLAG_PROCEDURAL;
  if (path) flags |= PACK_MODEL_FLAG_CONFIGURED | PACK_MODEL_FLAG_PENDING;
  return { path, flags, scale: 1 };
}

/** Encode model slot into one UBO float (flags + scale/128 in fractional part). */
export function encodePackModelSlotFloat(state: PackModelSlotState): number {
  const scaleFrac = Math.min(127, Math.max(0, Math.round(state.scale * 64))) / 128;
  return state.flags + scaleFrac;
}

export function decodePackModelSlotFloat(packed: number): { flags: number; scale: number } {
  const flags = Math.floor(packed + 1e-4);
  const scale = Math.min(2, Math.max(0.25, (packed - flags) * 128 / 64));
  return { flags, scale };
}

export function useProceduralArt(state: PackModelSlotState): boolean {
  return (state.flags & PACK_MODEL_FLAG_LOADED) === 0 || (state.flags & PACK_MODEL_FLAG_PROCEDURAL) !== 0;
}

/** Validate GLB container magic; does not parse full scene graph. */
export function classifyGlbBytes(bytes: ArrayBuffer | Uint8Array): { ok: boolean; byteLength: number } {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.byteLength < 12) return { ok: false, byteLength: view.byteLength };
  const magic =
    view[0]! | (view[1]! << 8) | (view[2]! << 16) | (view[3]! << 24);
  return { ok: magic === GLB_MAGIC, byteLength: view.byteLength };
}

export function applyPackModelBytes(state: PackModelSlotState, bytes: ArrayBuffer | null): PackModelSlotState {
  if (!state.path) {
    return { ...state, flags: PACK_MODEL_FLAG_PROCEDURAL };
  }
  if (!bytes || bytes.byteLength === 0) {
    return {
      ...state,
      flags: PACK_MODEL_FLAG_CONFIGURED | PACK_MODEL_FLAG_PROCEDURAL,
      scale: 1,
    };
  }
  const { ok } = classifyGlbBytes(bytes);
  if (!ok) {
    return {
      ...state,
      flags: PACK_MODEL_FLAG_CONFIGURED | PACK_MODEL_FLAG_PROCEDURAL,
      scale: 1,
    };
  }
  return {
    path: state.path,
    flags: PACK_MODEL_FLAG_LOADED | PACK_MODEL_FLAG_CONFIGURED,
    scale: 1,
  };
}

export type PackModelAssetRequest = { reqId: number; path: string };
export type PackModelAssetResponse = { reqId: number; ok: boolean; bytes?: ArrayBuffer };

let nextReqId = 1;

/** Host bridge: request pack asset bytes (parent fetches; sandbox CSP has connect-src none). */
export function requestPackModelAsset(
  path: string,
  onResult: (bytes: ArrayBuffer | null) => void,
): () => void {
  if (typeof window === "undefined" || !path.trim()) {
    onResult(null);
    return () => {};
  }
  const reqId = nextReqId++;
  const origin = document.referrer ? new URL(document.referrer).origin : window.location.origin;
  const handler = (ev: MessageEvent) => {
    const d = ev.data as { source?: string; type?: string; payload?: PackModelAssetResponse } | undefined;
    if (!d || d.source !== "zoto-viz-host" || d.type !== "packAsset") return;
    if (d.payload?.reqId !== reqId) return;
    window.removeEventListener("message", handler);
    onResult(d.payload.ok && d.payload.bytes ? d.payload.bytes : null);
  };
  window.addEventListener("message", handler);
  window.parent.postMessage(
    {
      source: "zoto-viz-plugin",
      type: "fetchPackAsset",
      payload: { reqId, path: path.replace(/^\/+/, "") } satisfies PackModelAssetRequest,
    },
    origin,
  );
  return () => window.removeEventListener("message", handler);
}

export class PackModelSlotController {
  private state: PackModelSlotState;
  private cancelLoad: (() => void) | null = null;
  private loadGeneration = 0;

  constructor(cfg?: Record<string, string | undefined> | null) {
    this.state = initialPackModelSlotState(cfg ?? {});
  }

  snapshot(): PackModelSlotState {
    return { ...this.state };
  }

  slotFloat(): number {
    return encodePackModelSlotFloat(this.state);
  }

  setConfig(cfg: Record<string, string | undefined> | null | undefined): void {
    this.cancelLoad?.();
    this.cancelLoad = null;
    const nextPath = parsePackModelPath(cfg);
    if (nextPath === this.state.path && (this.state.flags & PACK_MODEL_FLAG_LOADED)) return;
    this.state = initialPackModelSlotState(cfg);
    if (!nextPath) return;
    const gen = ++this.loadGeneration;
    this.cancelLoad = requestPackModelAsset(nextPath, (bytes) => {
      if (gen !== this.loadGeneration) return;
      this.state = applyPackModelBytes(this.state, bytes);
    });
  }

  /** Test hook — inject bytes without host fetch. */
  injectBytesForTest(bytes: ArrayBuffer | null): void {
    this.state = applyPackModelBytes(this.state, bytes);
  }

  dispose(): void {
    this.cancelLoad?.();
    this.cancelLoad = null;
  }
}
