import { stillSrc } from "../core/load-image";
import { FEED_HEADLINE_LIMIT, FEED_SLIDE_LIMIT, parseSourceBind, sourceHeadlines, type SourceBind, type SourceHeadline, type SourceLive } from "../core/sources";

export interface CarouselSlide {
  id: string;
  title: string;
  label: string;
  caption?: string;
  image?: string;
}

/** Bound source items — pictured rows stay on the stage. */
export function headlinesFromSources(
  sources: Record<string, SourceLive> | undefined,
  bind?: SourceBind | Record<string, string>,
): SourceHeadline[] {
  const parsed = bind && "titleField" in bind && typeof (bind as SourceBind).titleField === "string"
    ? bind as SourceBind
    : parseSourceBind(bind as Record<string, string> | undefined);
  const next: SourceBind = { ...parsed, filter: parsed.filter && parsed.filter !== "all" ? parsed.filter : "has-image" };
  return sourceHeadlines(sources, FEED_HEADLINE_LIMIT, next);
}

/** Pictured headlines only. Empty when the bound source has no stills. */
export function carouselSlides(headlines: SourceHeadline[], cap = FEED_SLIDE_LIMIT): CarouselSlide[] {
  const limit = Math.max(1, Math.min(FEED_HEADLINE_LIMIT, cap | 0));
  return headlines.filter((h) => !!h.image).slice(0, limit).map((h) => ({
    id: h.id,
    title: h.text,
    label: h.label,
    caption: h.summary,
    image: h.image,
  }));
}

export function proxiedStill(url: string): string {
  return stillSrc(url);
}

/** Title plus optional blurb for the still on screen. */
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

/** All captions on one crawl. Empty when there are no pictured stills. */
export function carouselTickerText(slides: CarouselSlide[]): string {
  return slides.map(carouselCaption).filter(Boolean).join("   ·   ");
}

/** Seconds for one left-and-down crawl loop — slow enough to read. */
export function carouselTickerSeconds(text: string): number {
  return Math.max(56, Math.min(96, text.length * 0.08));
}
