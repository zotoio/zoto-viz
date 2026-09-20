import { stillSrc } from "../core/load-image";

/** Photos and SVG the local agent pins onto the graph. */

export type DecoAt = "selected" | "internet" | "origin" | [number, number, number];

export interface AgentDeco {
  id: string;
  kind: "photo" | "svg";
  src: string;
  at: DecoAt;
  label?: string;
}

export interface AgentLook {
  shader?: string;
  shaderPhoto?: string;
  decos: AgentDeco[];
}

export const EMPTY_LOOK: AgentLook = { decos: [] };

const SVG_MAX = 80_000;
const DECO_CAP = 24;

export function sanitizeSvg(markup: string): string {
  let s = markup.trim();
  if (!s) return "";
  if (s.length > SVG_MAX) s = s.slice(0, SVG_MAX);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<(foreignObject|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript:/gi, "");
  if (!/^<svg[\s>]/i.test(s)) return "";
  if (!/\sxmlns=/.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

function parseAt(v: unknown): DecoAt {
  if (v === "selected" || v === "internet" || v === "origin") return v;
  if (Array.isArray(v) && v.length >= 3) {
    const x = Number(v[0]), y = Number(v[1]), z = Number(v[2]);
    if ([x, y, z].every(Number.isFinite)) return [x, y, z];
  }
  return "internet";
}

export function normalizeAgentLook(raw: unknown): AgentLook {
  const s = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const decos: AgentDeco[] = [];
  const src = Array.isArray(s.decos) ? s.decos : [];
  for (const row of src) {
    if (!row || typeof row !== "object") continue;
    const d = row as Record<string, unknown>;
    const kind = d.kind === "svg" ? "svg" : d.kind === "photo" ? "photo" : null;
    const href = typeof d.src === "string" ? d.src.trim() : "";
    const id = typeof d.id === "string" && d.id.trim() ? d.id.trim().slice(0, 40) : "";
    if (!kind || !href || !id) continue;
    if (kind === "photo" && !(href.startsWith("/api/ai/assets/") || href.startsWith("https://"))) continue;
    const deco: AgentDeco = { id, kind, src: href.slice(0, 2000), at: parseAt(d.at) };
    if (typeof d.label === "string" && d.label.trim()) deco.label = d.label.trim().slice(0, 80);
    decos.push(deco);
    if (decos.length >= DECO_CAP) break;
  }
  const look: AgentLook = { decos };
  if (typeof s.shader === "string" && s.shader.trim()) look.shader = s.shader.slice(0, 16_000);
  if (typeof s.shaderPhoto === "string" && s.shaderPhoto.trim()) look.shaderPhoto = s.shaderPhoto.trim().slice(0, 64);
  return look;
}

export function mergeAgentLook(base: AgentLook | undefined, patch: Partial<AgentLook> & { clear?: boolean }): AgentLook {
  if (patch.clear) return {
    shader: patch.shader,
    shaderPhoto: patch.shaderPhoto,
    decos: patch.decos ?? [],
  };
  const next: AgentLook = { decos: [...(base?.decos ?? [])] };
  if (base?.shader) next.shader = base.shader;
  if (base?.shaderPhoto) next.shaderPhoto = base.shaderPhoto;
  if (patch.shader !== undefined) {
    if (patch.shader) next.shader = patch.shader;
    else delete next.shader;
  }
  if (patch.shaderPhoto !== undefined) {
    if (patch.shaderPhoto) next.shaderPhoto = patch.shaderPhoto;
    else delete next.shaderPhoto;
  }
  if (patch.decos) {
    for (const d of patch.decos) {
      const i = next.decos.findIndex((x) => x.id === d.id);
      if (i >= 0) next.decos[i] = d;
      else next.decos.push(d);
    }
    if (next.decos.length > DECO_CAP) next.decos = next.decos.slice(-DECO_CAP);
  }
  return next;
}

export function decoHtml(d: AgentDeco): string {
  const cap = d.label ? `<small>${escapeHtml(d.label)}</small>` : "";
  if (d.kind === "svg") {
    const svg = d.src.startsWith("<svg") ? sanitizeSvg(d.src) : "";
    if (svg) return `${svg}${cap}`;
  }
  const src = escapeAttr(stillSrc(d.src) || d.src);
  return `<img src="${src}" alt="${escapeAttr(d.label || "agent")}" />${cap}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
