import { loadHtmlImage } from "../core/load-image";
import { waitHnRainStill, warmHnRainStills } from "./hn-rain-stills";

/** Six faces. Extra titles rotate in one at a time. */
export const FEED_CUBE_FACES = 6;
/** First titles on the ticker. Composer stills are queued one at a time. */
export const FEED_CUBE_TITLE_CAP = 12;
export const FEED_CUBE_STEP_MS = 8000;
/** Radians per second. Slow enough that a crossing takes a few minutes. */
export const FEED_CUBE_DRIFT_X = 0.012;
export const FEED_CUBE_DRIFT_Y = 0.007;

export function cubeDrift(
  t: number,
  box: { w: number; h: number; top: number; cube: number },
): { x: number; y: number } {
  const pad = 12;
  const spanX = Math.max(0, box.w - box.cube - pad * 2);
  const spanY = Math.max(0, box.h - box.top - box.cube - pad * 2);
  return {
    x: pad + spanX * (0.5 + 0.5 * Math.sin(t * FEED_CUBE_DRIFT_X)),
    y: box.top + pad + spanY * (0.5 + 0.5 * Math.sin(t * FEED_CUBE_DRIFT_Y + 1.4)),
  };
}

export function uniqueFeedTitles(titles: string[], cap = FEED_CUBE_TITLE_CAP): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of titles) {
    const text = raw.trim().slice(0, 240);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

export function seedCubeFaces(titles: string[], faces = FEED_CUBE_FACES): string[] {
  const unique = uniqueFeedTitles(titles, Math.max(faces, FEED_CUBE_TITLE_CAP));
  if (!unique.length) return [];
  return Array.from({ length: faces }, (_, i) => unique[i % unique.length]!);
}

/** Drop the oldest face and bring in the next title that is not already showing. */
export function advanceCubeFaces(current: string[], titles: string[]): string[] {
  const unique = uniqueFeedTitles(titles);
  if (!unique.length) return [];
  if (unique.length <= FEED_CUBE_FACES) return seedCubeFaces(unique);
  const faces = current.length === FEED_CUBE_FACES ? current.slice() : seedCubeFaces(unique);
  const shown = new Set(faces);
  const next = unique.find((t) => !shown.has(t)) ?? unique[0]!;
  faces.shift();
  faces.push(next);
  return faces;
}

const FACE_NAMES = ["front", "back", "right", "left", "top", "bottom"] as const;

/** Title stills for feed rains (HN, Lobsters, Guardian, Mastodon), on a spinning cube. */
export class FeedTitleCube {
  readonly el: HTMLElement;
  private readonly host: HTMLElement;
  private readonly faces: HTMLElement[] = [];
  private active = false;
  private titles: string[] = [];
  private shown: string[] = [];
  private key = "";
  private timer = 0;
  private driftRaf = 0;
  private readonly gen: number[] = [];
  private readonly ready = new Map<string, string>();

  constructor(host: HTMLElement) {
    this.host = host;
    this.el = document.createElement("div");
    this.el.id = "feed-title-cube";
    this.el.hidden = true;
    this.el.setAttribute("aria-hidden", "true");
    const cube = document.createElement("div");
    cube.className = "cube";
    for (let i = 0; i < FEED_CUBE_FACES; i++) {
      const face = document.createElement("figure");
      face.className = `face ${FACE_NAMES[i]}`;
      face.innerHTML = `<img alt="" hidden><span></span>`;
      cube.append(face);
      this.faces.push(face);
      this.gen.push(0);
    }
    this.el.append(cube);
    this.attach();
  }

  /** Mosaic teardown empties `#wall`. Put the cube back. */
  private attach(): void {
    if (this.el.parentElement !== this.host) this.host.append(this.el);
  }

  setActive(on: boolean): void {
    if (this.active === on) {
      if (on) this.attach();
      return;
    }
    this.active = on;
    if (!on) this.stop();
    else {
      this.attach();
      this.paint();
    }
  }

  sync(titles: string[]): void {
    if (!this.active) return;
    this.attach();
    const next = uniqueFeedTitles(titles);
    if (!next.length) {
      this.key = "";
      this.titles = [];
      this.shown = [];
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
      this.el.hidden = true;
      return;
    }
    const key = next.join("\n");
    if (key !== this.key) {
      this.key = key;
      this.titles = next;
      this.shown = seedCubeFaces(next);
      warmHnRainStills(next);
    }
    this.paint();
    const spinning = this.titles.length > FEED_CUBE_FACES;
    if (spinning && !this.timer) {
      this.timer = window.setInterval(() => this.step(), FEED_CUBE_STEP_MS);
    }
    if (!spinning && this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
  }

  dispose(): void {
    this.stop();
    this.el.remove();
  }

  private step(): void {
    if (this.titles.length <= FEED_CUBE_FACES) return;
    this.shown = advanceCubeFaces(this.shown, this.titles);
    this.paint();
  }

  private paint(): void {
    this.attach();
    const show = this.active && this.shown.length === FEED_CUBE_FACES;
    this.el.hidden = !show;
    if (!show) {
      this.stopDrift();
      return;
    }
    this.startDrift();
    this.shown.forEach((title, i) => {
      const face = this.faces[i]!;
      if (face.dataset.title === title && (face.dataset.ready === "1" || face.dataset.loading === "1")) return;
      face.dataset.title = title;
      face.dataset.ready = "0";
      const img = face.querySelector("img")!;
      const cap = face.querySelector("span")!;
      cap.textContent = title;
      const ticket = (this.gen[i] = (this.gen[i] ?? 0) + 1);
      const cached = this.ready.get(title);
      if (cached) {
        face.dataset.loading = "0";
        this.showImage(i, img, cap, title, cached, ticket);
        return;
      }
      face.dataset.loading = "1";
      img.hidden = true;
      cap.hidden = false;
      void waitHnRainStill(title).then((src) => {
        if (ticket !== this.gen[i]) return;
        face.dataset.loading = "0";
        if (!src) return;
        this.ready.set(title, src);
        this.showImage(i, img, cap, title, src, ticket);
      }).catch(() => {
        if (ticket !== this.gen[i]) return;
        face.dataset.loading = "0";
      });
    });
  }

  private showImage(
    index: number,
    img: HTMLImageElement,
    cap: HTMLElement,
    title: string,
    src: string,
    ticket: number,
  ): void {
    const face = this.faces[index];
    if (!face) return;
    img.alt = title;
    void loadHtmlImage(img, src).then(() => {
      if (ticket !== this.gen[index]) return;
      face.dataset.ready = "1";
      img.hidden = false;
      cap.hidden = true;
    }).catch(() => {
      if (ticket !== this.gen[index]) return;
      face.dataset.ready = "0";
      img.hidden = true;
      cap.hidden = false;
    });
  }

  private startDrift(): void {
    if (this.driftRaf || typeof requestAnimationFrame !== "function") return;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (!this.active || this.el.hidden) {
        this.driftRaf = 0;
        return;
      }
      const cube = this.el.offsetWidth || 160;
      const topRaw = getComputedStyle(document.documentElement).getPropertyValue("--bar-h");
      const top = Number.parseFloat(topRaw) || 0;
      const at = cubeDrift((now - t0) / 1000, {
        w: this.host.clientWidth || innerWidth,
        h: this.host.clientHeight || innerHeight,
        top,
        cube,
      });
      this.el.style.transform = `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0)`;
      this.driftRaf = requestAnimationFrame(tick);
    };
    this.driftRaf = requestAnimationFrame(tick);
  }

  private stopDrift(): void {
    if (this.driftRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.driftRaf);
    this.driftRaf = 0;
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.stopDrift();
    this.key = "";
    this.titles = [];
    this.shown = [];
    this.ready.clear();
    for (let i = 0; i < this.faces.length; i++) {
      this.gen[i] = (this.gen[i] ?? 0) + 1;
      const face = this.faces[i]!;
      delete face.dataset.title;
      delete face.dataset.ready;
      delete face.dataset.loading;
      const img = face.querySelector("img");
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
    }
    this.el.hidden = true;
  }
}
