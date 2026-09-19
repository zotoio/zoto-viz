import { stripMarkup, type SourceHeadline, type SourceLive } from "../core/sources";

export interface CarouselSlide {
  id: string;
  title: string;
  label: string;
  caption?: string;
  image?: string;
}

export function isNasaHeadline(h: Pick<SourceHeadline, "id" | "label">): boolean {
  return /nasa/i.test(`${h.label} ${h.id}`);
}

/** NASA IOTD items only — other feeds stay off the carousel stage. */
export function headlinesFromSources(
  sources: Record<string, SourceLive> | undefined,
): SourceHeadline[] {
  const lives = Object.values(sources ?? {}).filter((l) => l && l.ok !== false && !l.paused && /nasa/i.test(`${l.label} ${l.id}`));
  const out: SourceHeadline[] = [];
  for (const live of lives) {
    const label = live.label || live.id;
    for (const [i, item] of (live.items ?? []).entries()) {
      const title = (item.title || "").trim();
      if (!title) continue;
      const row: SourceHeadline = { id: `${live.id}:${i}`, label, text: title.slice(0, 240), kind: live.kind };
      const body = item.summary ? stripMarkup(item.summary).slice(0, 400) : "";
      if (body && body !== row.text) row.summary = body;
      if (item.image?.startsWith("https://")) row.image = item.image.slice(0, 500);
      out.push(row);
    }
  }
  return out;
}

/** Pictured NASA headlines only. Empty when IOTD is down. */
export function carouselSlides(headlines: SourceHeadline[], cap = 12): CarouselSlide[] {
  const limit = Math.max(1, Math.min(16, cap | 0));
  return headlines.filter((h) => isNasaHeadline(h) && !!h.image).slice(0, limit).map((h) => ({
    id: h.id,
    title: h.text,
    label: h.label,
    caption: h.summary,
    image: h.image,
  }));
}

export function proxiedStill(url: string): string {
  return `/api/sources/image?url=${encodeURIComponent(url)}`;
}

/** Title plus optional IOTD blurb for the still on screen. */
export function carouselCaptionParts(slide: Pick<CarouselSlide, "title" | "caption">): { title: string; body: string } {
  const title = slide.title.trim();
  const body = (slide.caption ?? "").trim();
  return { title, body: body && body !== title ? body : "" };
}

/** One still's caption: title, plus summary when it adds something. */
export function carouselCaption(slide: Pick<CarouselSlide, "title" | "caption">): string {
  const { title, body } = carouselCaptionParts(slide);
  return body ? `${title} — ${body}` : title;
}

/** All NASA captions on one crawl. Empty when there are no pictured stills. */
export function carouselTickerText(slides: CarouselSlide[]): string {
  return slides.map(carouselCaption).filter(Boolean).join("   ·   ");
}

/** Seconds for one left-and-down crawl loop — slow enough to read. */
export function carouselTickerSeconds(text: string): number {
  return Math.max(56, Math.min(96, text.length * 0.08));
}
