export type SourceKind = "rss" | "http" | "file" | "journal" | "kmsg";

export interface SourceRow {
  id: string;
  type: SourceKind;
  label: string;
  url?: string;
  path?: string;
  unit?: string;
  interval: number;
  enabled: boolean;
  feed: boolean;
  fields?: Record<string, string | number>;
}

export type SourceBind = {
  source?: string;
  titleField?: string;
  captionField?: string;
  imageField?: string;
  linkField?: string;
  filter?: string;
};

export function parseSourceBind(cfg?: Record<string, string> | null): SourceBind {
  return {
    source: (cfg?.source ?? "").trim(),
    titleField: (cfg?.titleField ?? "title").trim() || "title",
    captionField: (cfg?.captionField ?? "summary").trim() || "summary",
    imageField: (cfg?.imageField ?? "image").trim() || "image",
    linkField: (cfg?.linkField ?? "link").trim() || "link",
    filter: (cfg?.filter ?? "all").trim() || "all",
  };
}

export interface SourceItem {
  title?: string;
  link?: string;
  published?: string;
  summary?: string;
  image?: string;
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
  /** HTTPS still from enclosure / media:content (NASA IOTD). */
  image?: string;
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

function itemField(item: SourceItem, key: string): string {
  if (!key) return "";
  const rec = item as unknown as Record<string, unknown>;
  const val = rec[key];
  return typeof val === "string" ? val : "";
}

export function sourceHeadlines(
  sources: Record<string, SourceLive> | undefined,
  limit = 12,
  bind?: SourceBind,
): SourceHeadline[] {
  if (!sources) return [];
  const want = (bind?.source ?? "").trim();
  const titleKey = bind?.titleField || "title";
  const captionKey = bind?.captionField || "summary";
  const imageKey = bind?.imageField || "image";
  const pictured = (bind?.filter ?? "all") === "has-image" || bind?.filter === "image" || bind?.filter === "pictured";
  const out: SourceHeadline[] = [];
  const push = (id: string, label: string, text: string, kind?: string, summary?: string, image?: string): boolean => {
    const t = text.trim();
    if (!t) return out.length >= limit;
    const href = (image || "").trim();
    if (pictured && !href.startsWith("https://")) return out.length >= limit;
    const row: SourceHeadline = { id, label, text: t.slice(0, 240), kind };
    const body = summary ? stripMarkup(summary).slice(0, 400) : "";
    if (body && body !== row.text) row.summary = body;
    if (href.startsWith("https://")) row.image = href.slice(0, 500);
    out.push(row);
    return out.length >= limit;
  };
  for (const live of Object.values(sources)) {
    if (!live || live.feed === false || live.paused || live.ok === false) continue;
    if (want && live.id !== want) continue;
    const label = live.label || live.id;
    const kind = (live.kind || "").toLowerCase() || undefined;
    if (kind === "http" && live.json !== undefined && !(live.items && live.items.length)) {
      for (const [i, text] of jsonStrings(live.json, limit - out.length).entries()) {
        if (push(`${live.id}:json:${i}`, label, text, kind)) return out;
      }
      continue;
    }
    for (const [i, item] of (live.items ?? []).entries()) {
      const title = itemField(item, titleKey) || item.title || stripMarkup(item.summary || "");
      const summary = itemField(item, captionKey) || item.summary;
      const image = itemField(item, imageKey) || item.image;
      if (push(`${live.id}:${i}`, label, title, kind, summary, image)) return out;
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
