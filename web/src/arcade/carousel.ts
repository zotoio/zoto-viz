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

/** Full-viewport NASA IOTD slideshow: Ken Burns stills, large caption, crossfade. */
export class CarouselView extends Stage3D {
  readonly controls: HTMLElement[] = [];
  private readonly stillEl: HTMLElement;
  private readonly imgA: HTMLImageElement;
  private readonly imgB: HTMLImageElement;
  private readonly capEl: HTMLElement;
  private readonly capTitle: HTMLElement;
  private readonly capBody: HTMLElement;
  private slides: CarouselSlide[] = [];
  private focus = 0;
  private cycle0 = 0;
  private cycleN = 0;
  private slideKey = "";
  private shownId = "";
  private front: HTMLImageElement;
  private reduceMotion = false;
  private bind: Record<string, string> = { source: "nasa", filter: "has-image" };

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
    this.capEl.append(this.capTitle, this.capBody);
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
      this.slideKey = "";
      this.onSnapshot();
    }
  }

  protected onSnapshot(): void {
    const next = carouselSlides(headlinesFromSources(this.msg?.sources, this.bind), MAX_SLIDES);
    const key = next.map((s) => `${s.id}\u0001${s.image ?? ""}`).join("|");
    if (key === this.slideKey) return;
    this.slideKey = key;
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
    if (!src || back.getAttribute("src")?.split("&_try=")[0] === src) return;
    back.alt = slide.title;
    void loadHtmlImage(back, src).catch(() => {});
  }

  private showSlide(slide: CarouselSlide | undefined, instant: boolean): void {
    if (!slide?.image) {
      this.imgA.removeAttribute("src");
      this.imgB.removeAttribute("src");
      this.imgA.style.opacity = "0";
      this.imgB.style.opacity = "0";
      this.shownId = "";
      this.paintCaption(undefined);
      return;
    }
    const src = stillSrc(slide.image);
    this.paintCaption(slide);
    if (!src) return;
    const frontSrc = this.front.getAttribute("src")?.split("&_try=")[0] ?? "";
    if (slide.id === this.shownId && frontSrc === src) return;
    const next = frontSrc === src ? this.front : this.back();
    const reveal = (): void => {
      const now = next.getAttribute("src")?.split("&_try=")[0] ?? "";
      if (now !== src) return;
      if (next !== this.front) {
        this.front.style.opacity = "0";
        this.front = next;
      }
      this.front.alt = slide.title;
      this.front.style.opacity = instant ? "1" : this.front.style.opacity || "0";
      this.shownId = slide.id;
    };
    next.alt = slide.title;
    void loadHtmlImage(next, src).then(reveal).catch(() => {});
  }

  private paintCaption(slide: CarouselSlide | undefined): void {
    const { title, body } = carouselCaptionParts(slide ?? { title: "waiting for stills…" });
    this.capTitle.textContent = title;
    this.capBody.textContent = body;
    this.capBody.hidden = !body;
  }
}
