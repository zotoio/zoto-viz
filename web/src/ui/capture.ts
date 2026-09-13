import type { FeedConfig } from "./feed";

const JPEG_MAX = 900_000;
const JPEG_MIN = 32;

export interface ViewShow {
  lan: boolean;
  internet: boolean;
  multicast: boolean;
  offline: boolean;
  labels: boolean;
}

/** Packed HUD sent with each chat turn. Short keys, omit defaults. */
export interface PackedHud {
  m: string;
  th?: string;
  ch?: string;
  cam?: string;
  sel?: string;
  p?: string;
  d?: 1;
  mg?: 0;
  rd?: 1;
  st?: string;
  hide?: string;
  fd?: string;
  q?: string[];
}

export interface CaptureCtx {
  mode: string;
  theme: string;
  chrome: string;
  dream: boolean;
  selected: string | null;
  merge: boolean;
  redact: boolean;
  camera: "auto" | "off";
  show: ViewShow;
  feed: FeedConfig;
  feedLines: string[];
}

export type ViewCapture = PackedHud;

export interface AgentPatch {
  theme?: string;
  dream?: boolean;
  camera?: "auto" | "off";
  chrome?: "top" | "left" | "right";
  mode?: string;
  redact?: boolean;
  merge?: boolean;
  feed?: Partial<Pick<FeedConfig, "on" | "source" | "layout" | "scope">>;
  show?: Partial<ViewShow>;
}

export const VIEW_KEY = "zoto-viz.aiView";

const HIDE_SHORT: Record<keyof ViewShow, string> = {
  lan: "lan",
  internet: "inet",
  multicast: "mc",
  offline: "off",
  labels: "lbl",
};

/** On unless the operator has turned it off. */
export function includeView(): boolean {
  return localStorage.getItem(VIEW_KEY) !== "0";
}

export function elText(id: string, max = 80): string {
  return (document.getElementById(id)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function pair(a: string, b: string, prefix: string): string {
  if (!a && !b) return "";
  return `${prefix}${a || "0"}/${b || "0"}`;
}

/** Compact on-screen state for the local model. No image. */
export function captureHud(ctx: CaptureCtx): PackedHud {
  const hud: PackedHud = { m: ctx.mode };
  if (ctx.theme) hud.th = ctx.theme;
  if (ctx.chrome) hud.ch = ctx.chrome;
  if (ctx.camera) hud.cam = ctx.camera;
  if (ctx.selected) hud.sel = ctx.selected.slice(0, 40);
  const panel = elText("panel", 48);
  if (panel) hud.p = panel;
  if (ctx.dream) hud.d = 1;
  if (!ctx.merge) hud.mg = 0;
  if (ctx.redact) hud.rd = 1;
  const st = [
    elText("pps", 8) ? `${elText("pps", 8)}pps` : "",
    elText("bps", 12),
    pair(elText("lanDevs", 4), elText("lanOnline", 4), "lan"),
    pair(elText("netSvcs", 4), elText("netOnline", 4), "svc"),
    pair(elText("flows", 6), elText("active", 4), "fl"),
    elText("net", 32),
  ].filter(Boolean).join(" ");
  if (st) hud.st = st.slice(0, 80);
  const hide = (Object.keys(HIDE_SHORT) as (keyof ViewShow)[])
    .filter((k) => ctx.show[k] === false)
    .map((k) => HIDE_SHORT[k]);
  if (hide.length) hud.hide = hide.join(",");
  if (!ctx.feed.on) hud.fd = "off";
  else hud.fd = `${ctx.feed.layout}/${ctx.feed.source}/${ctx.feed.scope}`.slice(0, 40);
  if (ctx.feed.on) {
    const q = ctx.feedLines.slice(0, 3).map((l) => l.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean);
    if (q.length) hud.q = q;
  }
  return hud;
}

/** @deprecated use captureHud */
export const captureDom = captureHud;

/**
 * JPEG of a WebGL (or 2d) canvas as raw base64, downscaled so the chat body stays under 2 MB.
 * Call after a render so WebGL without preserveDrawingBuffer is not blank.
 */
export function canvasJpeg(canvas: HTMLCanvasElement, maxEdge = 960, quality = 0.45): string | null {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return null;
    let target: HTMLCanvasElement = canvas;
    const edge = Math.max(w, h);
    if (edge > maxEdge) {
      const scale = maxEdge / edge;
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(w * scale));
      off.height = Math.max(1, Math.round(h * scale));
      const g = off.getContext("2d");
      if (!g) return null;
      g.drawImage(canvas, 0, 0, off.width, off.height);
      target = off;
    }
    const url = target.toDataURL("image/jpeg", quality);
    const b64 = url.includes(",") ? url.slice(url.indexOf(",") + 1) : url;
    if (!b64 || b64.length < JPEG_MIN || b64.length >= JPEG_MAX) return null;
    return b64;
  } catch {
    return null;
  }
}

const SHOW_KEYS = ["lan", "internet", "multicast", "offline", "labels"] as const;

/** Whitelist a settings fence so the agent cannot write arbitrary profile fields. */
export function pickAgentSettings(patch: Record<string, unknown>, modeIds: string[]): AgentPatch {
  const out: AgentPatch = {};
  if (typeof patch.theme === "string" && patch.theme.trim()) out.theme = patch.theme.trim();
  if (typeof patch.dream === "boolean") out.dream = patch.dream;
  if (patch.camera === "auto" || patch.camera === "off") out.camera = patch.camera;
  if (patch.chrome === "top" || patch.chrome === "left" || patch.chrome === "right") out.chrome = patch.chrome;
  if (typeof patch.mode === "string" && modeIds.includes(patch.mode)) out.mode = patch.mode;
  if (typeof patch.redact === "boolean") out.redact = patch.redact;
  if (typeof patch.merge === "boolean") out.merge = patch.merge;
  if (patch.feed && typeof patch.feed === "object" && !Array.isArray(patch.feed)) {
    const f = patch.feed as Record<string, unknown>;
    const feed: AgentPatch["feed"] = {};
    if (typeof f.on === "boolean") feed.on = f.on;
    if (f.source === "traffic" || f.source === "transcript" || f.source === "both") feed.source = f.source;
    if (f.layout === "ticker" || f.layout === "bars" || f.layout === "both") feed.layout = f.layout;
    if (f.scope === "lan" || f.scope === "selected" || f.scope === "any") feed.scope = f.scope;
    if (Object.keys(feed).length) out.feed = feed;
  }
  if (patch.show && typeof patch.show === "object" && !Array.isArray(patch.show)) {
    const s = patch.show as Record<string, unknown>;
    const show: AgentPatch["show"] = {};
    for (const k of SHOW_KEYS) {
      if (typeof s[k] === "boolean") show[k] = s[k];
    }
    if (Object.keys(show).length) out.show = show;
  }
  return out;
}
