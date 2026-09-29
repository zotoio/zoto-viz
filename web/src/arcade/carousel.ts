import type { NetScene } from "../graph/scene";
import { carouselPlayhead, kenBurnsAim, kenBurnsAt, kenBurnsTransform } from "./stage-math";
import { Stage3D } from "./stage3d";
import { loadHtmlImage, stillSrc, warmStill } from "../core/load-image";
import { FEED_SLIDE_LIMIT } from "../core/sources";
import {
  carouselCaptionParts,
  carouselSlides,
  headlinesFromSources,
  type CarouselSlide,
} from "./carousel-slides";
import { prefersReducedMotion } from "../core/motion";

const MAX_SLIDES = FEED_SLIDE_LIMIT;

type LoadResult = "ok" | "failed" | "stale";
const STALE = new Error("stale carousel load");

/** Full-viewport NASA IOTD slideshow: Ken Burns stills, large caption, crossfade. */
export class CarouselView extends Stage3D {
  readonly controls: HTMLElement[] = [];
  private readonly stillEl: HTMLElement;
  private readonly imgA: HTMLImageElement;
  private readonly imgB: HTMLImageElement;
  private readonly capEl: HTMLElement;
  private readonly capTitle: HTMLElement;
  private readonly capBody: HTMLElement;
  /** Shown while the bound source serves its own bundled demo stills (`demo: true`). */
  readonly sampleEl: HTMLElement;
  private slides: CarouselSlide[] = [];
  private focus = 0;
  private cycle0 = 0;
  private cycleN = 0;
  private slideKey = "";
  private shownId = "";
  private front: HTMLImageElement;
  private reduceMotion = false;
  private bind: Record<string, string> = { source: "nasa", filter: "has-image" };
  /** Bumped on a source switch or new slide list: older loads and retries are stale. */
  private loadGen = 0;
  /** Latest load started on each <img>; an older load on the same element is stale. */
  private readonly elLoad = new WeakMap<HTMLImageElement, number>();
  private loadSeq = 0;
  /** Pending retry sleeps (timer -> reject), cleared on cancel. */
  private readonly retryTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
  /** Stills that failed every try for the current slide list: shown as a blank tile. */
  private readonly failed = new Set<string>();

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.camOrbit.radius = 4;
    this.camOrbit.phi = Math.PI / 2;
    this.camOrbit.theta = 0;
    this.camOrbit.target.set(0, 1.05, 0);
    this.world.fog = null;

    this.stillEl = document.createElement("figure");
    this.stillEl.className = "carousel-still";
    this.imgA = document.createElement("img");
    this.imgB = document.createElement("img");
    this.imgA.alt = "";
    this.imgB.alt = "";
    this.imgA.decoding = "async";
    this.imgB.decoding = "async";
    this.capEl = document.createElement("figcaption");
    this.capEl.className = "carousel-caption";
    this.capEl.setAttribute("aria-label", "still caption");
    this.capTitle = document.createElement("strong");
    this.capTitle.className = "carousel-caption-title";
    this.capBody = document.createElement("span");
    this.capBody.className = "carousel-caption-body";
    this.sampleEl = document.createElement("div");
    this.sampleEl.className = "carousel-sample";
    this.sampleEl.setAttribute("role", "status");
    this.sampleEl.style.cssText = "margin-bottom:.5rem;font:600 clamp(.95rem,1.6vw,1.25rem)/1.3 ui-sans-serif,system-ui,sans-serif";
    this.sampleEl.hidden = true;
    this.capEl.append(this.sampleEl, this.capTitle, this.capBody);
    this.stillEl.append(this.imgA, this.imgB, this.capEl);
    this.front = this.imgA;

    this.container.append(this.stillEl);
    this.reduceMotion = prefersReducedMotion();
    this.paintCaption(undefined);
  }

  protected useTraffic(): boolean { return false; }
  protected query() { return null; }
  protected ingest(): void {}

  setBind(bind: Record<string, string>): void {
    const key = `${bind.source ?? ""}\u0001${bind.titleField ?? ""}\u0001${bind.imageField ?? ""}\u0001${bind.filter ?? ""}`;
    const prev = `${this.bind.source ?? ""}\u0001${this.bind.titleField ?? ""}\u0001${this.bind.imageField ?? ""}\u0001${this.bind.filter ?? ""}`;
    this.bind = { ...bind };
    if (key !== prev) {
      // The old source's in-flight loads and retries must never reach the shared <img>s,
      // and its picture must not linger under the new source's caption.
      this.cancelLoads(true);
      // Never a real key: a source with no stills must clear the last source's slides.
      this.slideKey = "\u0000";
      this.onSnapshot();
    }
  }

  protected onSnapshot(): void {
    const sid = this.bind.source ?? "";
    const live = this.msg?.sources?.[sid] as { demo?: unknown; sampleSource?: unknown; label?: string } | undefined;
    this.sampleEl.hidden = live?.demo !== true;
    const name = String(live?.sampleSource || live?.label || sid);
    this.sampleEl.textContent = this.sampleEl.hidden ? "" : `Showing sample pictures. ${name} isn't responding.`;
    const next = carouselSlides(headlinesFromSources(this.msg?.sources, this.bind), MAX_SLIDES);
    const key = next.map((s) => `${s.id}\u0001${s.image ?? ""}`).join("|");
    if (key === this.slideKey) return;
    this.slideKey = key;
    this.cancelLoads(false);
    this.slides = next;
    this.focus = 0;
    this.cycle0 = 0;
    this.cycleN = 0;
    this.shownId = "";
    this.warm(next);
    this.showSlide(next[0], true);
  }

  protected step(now: number, dt: number): void {
    void dt;
    const n = this.slides.length;
    if (!this.cycle0) this.cycle0 = now;
    const play = carouselPlayhead(now - this.cycle0);
    if (play.fade > 0 && n > 1) this.arm(this.slides[(this.focus + 1) % n]!);
    if (n > 1 && play.cycle !== this.cycleN) {
      this.focus = (this.focus + (((play.cycle - this.cycleN) % n) + n) % n) % n;
      this.cycleN = play.cycle;
      this.showSlide(this.slides[this.focus], true);
    }
    const outgoing = this.slides[this.focus];
    const incoming = this.slides[n > 1 ? (this.focus + 1) % n : this.focus];
    const fade = n > 1 ? play.fade : 0;
    this.paintStill(this.front, outgoing, n > 1 ? play.progress : Math.min(1, play.progress), 1 - fade);
    if (n > 1 && fade > 0) this.paintStill(this.back(), incoming, 0, fade);
    else if (this.back() !== this.front) this.back().style.opacity = "0";
    const capSlide = fade >= 0.5 ? incoming : outgoing;
    this.paintCaption(capSlide);
    this.capEl.style.opacity = (fade < 0.5 ? 1 - fade * 2 : (fade - 0.5) * 2).toFixed(3);
    this.camOrbit.target.set(0, 1.05, 0);
    this.camOrbit.radius = 4;
    this.camOrbit.theta = 0;
    this.camOrbit.phi = Math.PI / 2;
  }

  private warm(slides: CarouselSlide[]): void {
    for (const slide of slides) {
      if (slide.image) warmStill(slide.image);
    }
  }

  private back(): HTMLImageElement {
    return this.front === this.imgA ? this.imgB : this.imgA;
  }

  private paintStill(el: HTMLImageElement, slide: CarouselSlide | undefined, progress: number, opacity: number): void {
    el.style.opacity = opacity.toFixed(3);
    if (this.reduceMotion || !slide) {
      el.style.transform = "none";
      return;
    }
    el.style.transform = kenBurnsTransform(kenBurnsAt(progress, kenBurnsAim(slide.id)));
  }

  private arm(slide: CarouselSlide): void {
    if (!slide.image) return;
    const src = stillSrc(slide.image);
    const back = this.back();
    if (!src || this.failed.has(src) || baseSrc(back) === src) return;
    void this.load(back, src).then((res) => {
      if (res === "ok") back.alt = slide.title;
      if (res !== "failed") return;
      this.failed.add(src);
      // Fade into nothing rather than whatever the element held before.
      this.blank(back);
    });
  }

  private showSlide(slide: CarouselSlide | undefined, instant: boolean): void {
    if (!slide?.image) {
      this.blank(this.imgA);
      this.blank(this.imgB);
      this.shownId = "";
      this.paintCaption(undefined);
      return;
    }
    const src = stillSrc(slide.image);
    this.paintCaption(slide);
    if (!src || this.failed.has(src)) {
      // No picture for this caption: a blank tile, never the previous slide's still.
      this.blank(this.imgA);
      this.blank(this.imgB);
      this.shownId = "";
      return;
    }
    const frontSrc = baseSrc(this.front);
    if (slide.id === this.shownId && frontSrc === src) return;
    const next = frontSrc === src ? this.front : this.back();
    void this.load(next, src).then((res) => {
      if (res === "stale") return;
      if (res === "failed") {
        this.failed.add(src);
        this.blank(next);
        if (this.slides[this.focus]?.id === slide.id) {
          this.blank(this.front);
          this.shownId = "";
        }
        return;
      }
      if (baseSrc(next) !== src) return;
      if (next !== this.front) {
        this.front.style.opacity = "0";
        this.front = next;
      }
      this.front.alt = slide.title;
      this.front.style.opacity = instant ? "1" : this.front.style.opacity || "0";
      this.shownId = slide.id;
    });
  }

  /**
   * Load `src` onto `el`. Resolves "stale" (and never touches `el` again) once a newer load
   * on the same element or a source switch / new slide list supersedes it.
   */
  private load(el: HTMLImageElement, src: string): Promise<LoadResult> {
    this.abortPending(el);
    const token = ++this.loadSeq;
    this.elLoad.set(el, token);
    const gen = this.loadGen;
    const live = (): boolean => gen === this.loadGen && this.elLoad.get(el) === token;
    // Drop the element's old picture first so a slow or failed load shows nothing, not it.
    if (baseSrc(el) !== src) this.blank(el);
    const sleep = (ms: number): Promise<void> => new Promise<void>((resolve, reject) => {
      if (!live()) {
        reject(STALE);
        return;
      }
      const t = setTimeout(() => {
        this.retryTimers.delete(t);
        if (live()) resolve();
        else reject(STALE);
      }, ms);
      this.retryTimers.set(t, () => reject(STALE));
    });
    return loadHtmlImage(el, src, { sleep }).then(
      (): LoadResult => (live() ? "ok" : "stale"),
      (): LoadResult => (live() ? "failed" : "stale"),
    );
  }

  /**
   * Settle the element's in-flight attempt now (its own error path clears its timeout and
   * handlers), so it can neither resolve late nor null a newer load's handlers.
   */
  private abortPending(el: HTMLImageElement): void {
    const pending = el.onerror;
    if (typeof pending === "function") pending.call(el, new Event("error"));
  }

  /** Cancel every in-flight load and retry. `clear` also empties both <img>s. */
  private cancelLoads(clear: boolean): void {
    this.loadGen++;
    for (const [t, cancel] of this.retryTimers) {
      clearTimeout(t);
      cancel();
    }
    this.retryTimers.clear();
    this.failed.clear();
    for (const el of [this.imgA, this.imgB]) {
      this.abortPending(el);
      if (clear) this.blank(el);
    }
    if (clear) this.shownId = "";
  }

  private blank(el: HTMLImageElement): void {
    el.removeAttribute("src");
    el.alt = "";
    el.style.opacity = "0";
  }

  private paintCaption(slide: CarouselSlide | undefined): void {
    const { title, body } = carouselCaptionParts(slide ?? { title: "waiting for stills…" });
    this.capTitle.textContent = title;
    this.capBody.textContent = body;
    this.capBody.hidden = !body;
  }
}

function baseSrc(el: HTMLImageElement): string {
  return el.getAttribute("src")?.split("&_try=")[0] ?? "";
}
