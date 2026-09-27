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

/** HN Rain / HN Term draw their own stills — pictured-only would hide HN and Lobsters. */
export function illustratedSourceBind(cfg?: Record<string, string> | null): SourceBind {
  const bind = parseSourceBind(cfg);
  if (bind.filter === "has-image" || bind.filter === "image" || bind.filter === "pictured") {
    bind.filter = "all";
  }
  return bind;
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
  url?: string;
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
      for (const item of v.slice(0, FEED_HEADLINE_LIMIT)) walk(item, depth + 1);
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

export const FEED_HEADLINE_LIMIT = 64;
export const FEED_SLIDE_LIMIT = 48;
const MAX_IMAGE_HREF = 2000;

/** Shipped news / stills — titles live on carousel, rain, and term views. */
export const FEED_NEWS_IDS = new Set([
  "hn", "nasa", "apod", "earth-iotd", "commons-potd", "met",
  "lobsters", "guardian", "mastodon",
]);

/** RSS / HTTP news and pictured feeds stay off the packet ticker unless a view binds them. */
export function isFeedNewsSource(live: Pick<SourceLive, "id" | "kind">): boolean {
  const kind = (live.kind || "").toLowerCase();
  if (kind === "journal" || kind === "kmsg" || kind === "file") return false;
  if (kind === "rss" || kind === "http") return true;
  return FEED_NEWS_IDS.has((live.id || "").toLowerCase());
}

/** Count feed-eligible headlines without materializing the full list (viz decimation stats). */
export function countEligibleSourceHeadlines(
  sources: Record<string, SourceLive> | undefined,
  bind?: SourceBind,
): number {
  if (!sources) return 0;
  const want = (bind?.source ?? "").trim();
  const titleKey = bind?.titleField || "title";
  const captionKey = bind?.captionField || "summary";
  const imageKey = bind?.imageField || "image";
  const pictured =
    (bind?.filter ?? "all") === "has-image" || bind?.filter === "image" || bind?.filter === "pictured";
  let count = 0;
  const scanCap = FEED_HEADLINE_LIMIT + 1;
  const bump = (text: string, image?: string): boolean => {
    if (count >= scanCap) return true;
    const t = text.trim();
    if (!t) return count >= scanCap;
    const href = (image || "").trim();
    if (pictured && !href.startsWith("https://")) return count >= scanCap;
    count += 1;
    return count >= scanCap;
  };
  for (const live of Object.values(sources)) {
    if (!live || live.paused || live.ok === false) continue;
    if (want) {
      if (live.id !== want) continue;
    } else if (!pictured) {
      if (live.feed === false || isFeedNewsSource(live)) continue;
    }
    const kind = (live.kind || "").toLowerCase() || undefined;
    if (kind === "http" && live.json !== undefined && !(live.items && live.items.length)) {
      for (const text of jsonStrings(live.json, scanCap - count)) {
        if (bump(text)) break;
      }
      continue;
    }
    for (const item of live.items ?? []) {
      const title = itemField(item, titleKey) || item.title || stripMarkup(item.summary || "");
      const summary = itemField(item, captionKey) || item.summary;
      const image = itemField(item, imageKey) || item.image;
      if (bump(title, image)) break;
    }
    if (count < scanCap && !live.items?.length && live.text) {
      for (const line of String(live.text).split(/\r?\n/)) {
        if (bump(line, undefined)) break;
      }
    }
  }
  return count;
}

export function sourceHeadlines(
  sources: Record<string, SourceLive> | undefined,
  limit = FEED_HEADLINE_LIMIT,
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
    if (href.startsWith("https://")) row.image = href.slice(0, MAX_IMAGE_HREF);
    out.push(row);
    return out.length >= limit;
  };
  for (const live of Object.values(sources)) {
    if (!live || live.paused || live.ok === false) continue;
    if (want) {
      if (live.id !== want) continue;
    } else if (!pictured) {
      if (live.feed === false || isFeedNewsSource(live)) continue;
    }
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
