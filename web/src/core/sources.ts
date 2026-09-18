export type SourceKind = "rss" | "http" | "file";

export interface SourceRow {
  id: string;
  type: SourceKind;
  label: string;
  url?: string;
  path?: string;
  interval: number;
  enabled: boolean;
  feed: boolean;
}

export interface SourceItem {
  title?: string;
  link?: string;
  published?: string;
  summary?: string;
}

export interface SourceLive {
  id: string;
  kind: string;
  label: string;
  ok: boolean;
  ts?: number;
  feed?: boolean;
  items?: SourceItem[];
  text?: string;
  json?: unknown;
  error?: string;
  pending?: boolean;
  paused?: boolean;
}

export interface SourceHeadline {
  id: string;
  label: string;
  text: string;
  kind?: string;
  /** RSS description / Atom summary, HTML stripped. */
  summary?: string;
}

export function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function jsonStrings(value: unknown, cap: number): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (out.length >= cap || depth > 6) return;
    if (typeof v === "string") {
      const t = v.trim();
      if (t.length >= 2) out.push(t.slice(0, 160));
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v.slice(0, 12)) walk(item, depth + 1);
      return;
    }
    if (v && typeof v === "object") {
      const rec = v as Record<string, unknown>;
      for (const key of ["title", "name", "label", "headline", "text"]) {
        if (typeof rec[key] === "string") walk(rec[key], depth + 1);
      }
      for (const child of Object.values(rec)) {
        walk(child, depth + 1);
        if (out.length >= cap) return;
      }
    }
  };
  walk(value, 0);
  return out;
}

export function sourceHeadlines(
  sources: Record<string, SourceLive> | undefined,
  limit = 12,
): SourceHeadline[] {
  if (!sources) return [];
  const out: SourceHeadline[] = [];
  const push = (id: string, label: string, text: string, kind?: string, summary?: string): boolean => {
    const t = text.trim();
    if (!t) return out.length >= limit;
    const row: SourceHeadline = { id, label, text: t.slice(0, 160), kind };
    const body = summary ? stripMarkup(summary).slice(0, 360) : "";
    if (body && body !== row.text) row.summary = body;
    out.push(row);
    return out.length >= limit;
  };
  for (const live of Object.values(sources)) {
    if (!live || live.feed === false || live.paused || live.ok === false) continue;
    const label = live.label || live.id;
    const kind = (live.kind || "").toLowerCase() || undefined;
    if (kind === "http" && live.json !== undefined) {
      for (const [i, text] of jsonStrings(live.json, limit - out.length).entries()) {
        if (push(`${live.id}:json:${i}`, label, text, kind)) return out;
      }
      continue;
    }
    for (const [i, item] of (live.items ?? []).entries()) {
      const title = item.title || stripMarkup(item.summary || "");
      if (push(`${live.id}:${i}`, label, title, kind, item.summary)) return out;
    }
    if (!live.items?.length && live.text) {
      const lines = String(live.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const [i, line] of lines.entries()) {
        if (push(`${live.id}:${i}`, label, line, kind || "file")) return out;
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}
