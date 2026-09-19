import type { NetScene } from "../graph/scene";
import { CAROUSEL_PERIOD, carouselBeat } from "./stage-math";
import { Stage3D } from "./stage3d";
import {
  carouselSlides,
  carouselTickerSeconds,
  carouselTickerText,
  headlinesFromSources,
  proxiedStill,
  type CarouselSlide,
} from "./carousel-slides";

const MAX_SLIDES = 12;

/** Full-viewport NASA IOTD slideshow: contain-fit stills, rotating, captions on a ticker. */
export class CarouselView extends Stage3D {
  readonly controls: HTMLElement[] = [];
  private readonly stillEl: HTMLElement;
  private readonly imgA: HTMLImageElement;
  private readonly imgB: HTMLImageElement;
  private readonly tickerEl: HTMLElement;
  private readonly tickerTrack: HTMLElement;
  private slides: CarouselSlide[] = [];
  private focus = 0;
  private cycle0 = 0;
  private cycleN = 0;
  private slideKey = "";
  private shownId = "";
  private front: HTMLImageElement;

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
    this.stillEl.append(this.imgA, this.imgB);
    this.front = this.imgA;

    this.tickerEl = document.createElement("div");
    this.tickerEl.className = "carousel-ticker";
    this.tickerEl.setAttribute("aria-label", "NASA captions");
    this.tickerTrack = document.createElement("div");
    this.tickerTrack.className = "carousel-ticker-track";
    this.tickerEl.append(this.tickerTrack);

    this.container.append(this.stillEl, this.tickerEl);
    this.paintTicker("NASA image of the day · waiting for stills…");
  }

  protected useTraffic(): boolean { return false; }
  protected query() { return null; }
  protected ingest(): void {}

  protected onSnapshot(): void {
    const next = carouselSlides(headlinesFromSources(this.msg?.sources), MAX_SLIDES);
    const key = next.map((s) => `${s.id}\u0001${s.image ?? ""}`).join("|");
    if (key === this.slideKey) return;
    this.slideKey = key;
    this.slides = next;
    this.focus = 0;
    this.cycle0 = 0;
    this.cycleN = 0;
    this.shownId = "";
    this.warm(next);
    this.paintTicker(carouselTickerText(next) || "NASA image of the day · waiting for stills…");
    this.showSlide(next[0], true);
  }

  protected step(now: number, dt: number): void {
    void dt;
    const n = Math.max(1, this.slides.length);
    if (!this.cycle0) this.cycle0 = now;
    const elapsed = now - this.cycle0;
    const cycles = Math.floor(elapsed / CAROUSEL_PERIOD);
    const beat = carouselBeat(elapsed, CAROUSEL_PERIOD);
    if (beat.phase === "out" && this.slides.length > 1) {
      this.arm(this.slides[(this.focus + 1) % n]!);
    }
    if (cycles !== this.cycleN) {
      this.focus = this.slides.length ? (this.focus + (((cycles - this.cycleN) % n) + n) % n) % n : 0;
      this.cycleN = cycles;
      this.showSlide(this.slides[this.focus], false);
    }
    this.front.style.opacity = beat.zoom.toFixed(3);
    this.camOrbit.target.set(0, 1.05, 0);
    this.camOrbit.radius = 4;
    this.camOrbit.theta = 0;
    this.camOrbit.phi = Math.PI / 2;
  }

  private warm(slides: CarouselSlide[]): void {
    for (const slide of slides) {
      if (!slide.image) continue;
      const img = new Image();
      img.src = proxiedStill(slide.image);
    }
  }

  private back(): HTMLImageElement {
    return this.front === this.imgA ? this.imgB : this.imgA;
  }

  private arm(slide: CarouselSlide): void {
    if (!slide.image) return;
    const src = proxiedStill(slide.image);
    const back = this.back();
    if (back.getAttribute("src") === src) return;
    back.alt = slide.title;
    back.src = src;
  }

  private showSlide(slide: CarouselSlide | undefined, instant: boolean): void {
    if (!slide?.image) {
      this.imgA.removeAttribute("src");
      this.imgB.removeAttribute("src");
      this.imgA.style.opacity = "0";
      this.imgB.style.opacity = "0";
      this.shownId = "";
      return;
    }
    const src = proxiedStill(slide.image);
    if (slide.id === this.shownId && this.front.getAttribute("src") === src) {
      if (instant) this.front.style.opacity = "1";
      return;
    }
    const next = this.front.getAttribute("src") === src ? this.front : this.back();
    const reveal = (): void => {
      if (next.getAttribute("src") !== src) return;
      if (next !== this.front) {
        this.front.style.opacity = "0";
        this.front = next;
      }
      this.front.alt = slide.title;
      this.front.style.opacity = instant ? "1" : this.front.style.opacity || "0";
      this.shownId = slide.id;
    };
    next.alt = slide.title;
    next.onload = reveal;
    next.onerror = () => {
      if (next.getAttribute("src") !== src) return;
      next.removeAttribute("src");
    };
    if (next.getAttribute("src") !== src) next.src = src;
    if (next.complete && next.naturalWidth) reveal();
  }

  private paintTicker(text: string): void {
    const line = text.trim() || "NASA image of the day · waiting for stills…";
    this.tickerEl.style.setProperty("--carousel-ticker-s", `${carouselTickerSeconds(line)}s`);
    const bit = `<span>${esc(line)}</span>`;
    const col = `<div class="carousel-ticker-col">${bit}${bit}</div>`;
    this.tickerTrack.innerHTML = `${col}${col}`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}
