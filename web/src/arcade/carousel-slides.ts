import { stillSrc } from "../core/load-image";
import { FEED_HEADLINE_LIMIT, FEED_SLIDE_LIMIT, parseSourceBind, sourceHeadlines, type SourceBind, type SourceHeadline, type SourceLive } from "../core/sources";

export interface CarouselSlide {
  id: string;
  title: string;
  label: string;
  caption?: string;
  image?: string;
  author?: string;
  origin?: string;
  /** HTTPS page for this story on the source's site (botz.ai permalink); drives the open button. */
  page?: string;
}

/** Caption placements a slide can take. */
export const CAROUSEL_LAYOUTS = ["low-left", "high-right", "centre", "side-left", "low-right"] as const;
/** Ways an incoming still can arrive. */
export const CAROUSEL_TRANSITIONS = ["fade", "slide-left", "slide-up", "zoom-out", "iris", "blur"] as const;
export type CarouselLayout = (typeof CAROUSEL_LAYOUTS)[number];
export type CarouselTransition = (typeof CAROUSEL_TRANSITIONS)[number];

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Layout and arrival for one showing of a still. Varies with the slide and the cycle, so a
 * deck never settles into one fixed look (a pick that matches the last cycle's raw pick steps on).
 */
export function carouselVariant(id: string, cycle: number): { layout: CarouselLayout; transition: CarouselTransition } {
  const pick = <T,>(list: readonly T[], salt: string): T => {
    const at = hash32(`${id}\u0001${cycle}\u0001${salt}`) % list.length;
    const prev = hash32(`${id}\u0001${cycle - 1}\u0001${salt}`) % list.length;
    return list[at === prev ? (at + 1) % list.length : at]!;
  };
  return { layout: pick(CAROUSEL_LAYOUTS, "layout"), transition: pick(CAROUSEL_TRANSITIONS, "transition") };
}

/**
 * Inline style for an incoming still `t` (0…1) of the way through its arrival.
 * Opacity always ramps with `t`; the transition adds motion, a mask, or a blur.
 */
export function carouselArrival(kind: CarouselTransition, t: number): { opacity: number; transform: string; clipPath: string; filter: string } {
  const x = Math.min(1, Math.max(0, t));
  const e = x * x * (3 - 2 * x);
  const out = { opacity: e, transform: "", clipPath: "", filter: "" };
  switch (kind) {
    case "slide-left": out.transform = `translateX(${((1 - e) * 18).toFixed(2)}%)`; break;
    case "slide-up": out.transform = `translateY(${((1 - e) * 14).toFixed(2)}%)`; break;
    case "zoom-out": out.transform = `scale(${(1 + (1 - e) * 0.22).toFixed(4)})`; break;
    case "iris": out.opacity = Math.min(1, e * 3); out.clipPath = `circle(${(e * 75).toFixed(2)}% at 50% 50%)`; break;
    case "blur": out.filter = `blur(${((1 - e) * 18).toFixed(2)}px)`; break;
    default: break;
  }
  return out;
}

/**
 * Fit to height: the still always fills the panel's full height at its own aspect ratio.
 * A still wider than the panel is cropped at the sides ("cover"); a narrower one is padded at
 * the sides over a blurred copy of itself ("contain"). Both keep the full height.
 */
export function stillFit(imgW: number, imgH: number, boxW: number, boxH: number): "cover" | "contain" {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return "cover";
  return imgW / imgH >= boxW / boxH ? "cover" : "contain";
}

/** "Source · Author" overlay line; empty when the source maps neither. */
export function carouselByline(slide: Pick<CarouselSlide, "author" | "origin">): string {
  const origin = (slide.origin ?? "").trim();
  const author = (slide.author ?? "").trim();
  if (origin && author && origin.toLowerCase() !== author.toLowerCase()) return `${origin} · ${author}`;
  return origin || author;
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
    ...(h.author ? { author: h.author } : {}),
    ...(h.origin ? { origin: h.origin } : {}),
    ...(h.page ? { page: h.page } : {}),
  }));
}

/** Open-button text for a slide page: "Open on botz.ai". Null when there is no https page. */
export function carouselOpenLabel(page: string | undefined): string | null {
  if (!page || !page.startsWith("https://")) return null;
  try {
    return `Open on ${new URL(page).hostname.replace(/^www\./, "")}`;
  } catch {
    return null;
  }
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
