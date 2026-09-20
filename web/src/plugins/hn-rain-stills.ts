import { preferHnTitles } from "../../../plugins/src/hn-rain/frontend/crawl";

export const HN_RAIN_STILL_HOLD_MS = 7000;
export const HN_RAIN_STILL_POLL_MS = 2000;
export const HN_RAIN_STILL_TRIES = 45;

export type HnRainStillHeadline = {
  id?: string;
  label?: string;
  text?: string;
  image?: string;
};

export function preferHnStillTitles(headlines: HnRainStillHeadline[]): HnRainStillHeadline[] {
  const texts = new Set(preferHnTitles(headlines));
  const out: HnRainStillHeadline[] = [];
  for (const h of headlines) {
    const text = (h.text ?? "").trim();
    if (!text || !texts.has(text)) continue;
    out.push(h);
    texts.delete(text);
  }
  return out;
}

/** Composer 2.5 only — pictured source enclosures stay on the carousel plugin. */
export function hnRainStillSrc(title: string): string {
  return `/api/plugins/hn-rain/still?title=${encodeURIComponent(title.slice(0, 240))}`;
}

export function hnRainStillTitles(headlines: HnRainStillHeadline[]): string[] {
  return preferHnStillTitles(headlines).map((h) => (h.text ?? "").trim()).filter(Boolean);
}

/** Queue every title so Composer draws each article, not only the one on screen. */
export function warmHnRainStills(
  titles: string[],
  fetchImpl: typeof fetch = fetch,
): void {
  for (const title of titles) {
    if (!title) continue;
    void fetchImpl(hnRainStillSrc(title), { cache: "no-store" }).catch(() => {});
  }
}

export async function waitHnRainStill(
  title: string,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<string | null> {
  const src = hnRainStillSrc(title);
  for (let i = 0; i < HN_RAIN_STILL_TRIES; i++) {
    const r = await fetchImpl(src, { cache: "no-store" });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.includes("svg")) return src;
    if (r.status === 503 || r.status === 400) return null;
    if (r.status === 202) {
      await sleep(HN_RAIN_STILL_POLL_MS);
      continue;
    }
    return null;
  }
  return null;
}

/** Top-left title stills for SRC HN Rain. Half viewport tall, 1 cm from the left. */
export class HnRainStills {
  readonly el: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly wait: HTMLElement;
  private titles: HnRainStillHeadline[] = [];
  private idx = 0;
  private timer = 0;
  private active = false;
  private pics = false;
  private shown = "";
  private loading = "";
  private gen = 0;
  private warmed = "";

  constructor(host: HTMLElement) {
    this.el = document.createElement("figure");
    this.el.id = "hn-rain-still";
    this.el.hidden = true;
    this.el.innerHTML = `<img alt=""><figcaption class="hn-rain-still-wait"></figcaption>`;
    this.img = this.el.querySelector("img")!;
    this.wait = this.el.querySelector("figcaption")!;
    host.append(this.el);
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.stop();
    else this.paint();
  }

  sync(headlines: HnRainStillHeadline[], pics: boolean): void {
    this.pics = pics;
    this.titles = preferHnStillTitles(headlines);
    if (!this.active || !pics || !this.titles.length) {
      this.stop();
      return;
    }
    const key = this.titles.map((h) => h.text).join("\n");
    if (key !== this.warmed) {
      this.warmed = key;
      warmHnRainStills(hnRainStillTitles(this.titles));
    }
    if (this.idx >= this.titles.length) this.idx = 0;
    this.paint();
    if (!this.timer) this.timer = window.setInterval(() => this.advance(), HN_RAIN_STILL_HOLD_MS);
  }

  dispose(): void {
    this.stop();
    this.el.remove();
  }

  private advance(): void {
    if (this.titles.length < 2) return;
    this.idx = (this.idx + 1) % this.titles.length;
    this.paint();
  }

  private paint(): void {
    const show = this.active && this.pics && this.titles.length > 0;
    this.el.hidden = !show;
    if (!show) return;
    const row = this.titles[this.idx]!;
    const title = (row.text ?? "").trim();
    const srcWanted = hnRainStillSrc(title);
    if (srcWanted === this.shown && !this.img.hidden) return;
    if (srcWanted === this.loading) return;
    this.loading = srcWanted;
    const ticket = ++this.gen;
    this.wait.textContent = title;
    this.img.hidden = true;
    this.wait.hidden = false;
    void waitHnRainStill(title).then((src) => {
      if (ticket !== this.gen || !src) return;
      this.shown = srcWanted;
      this.img.alt = title;
      const reveal = (): void => {
        if (ticket !== this.gen) return;
        this.img.hidden = false;
        this.wait.hidden = true;
      };
      this.img.onload = reveal;
      this.img.onerror = () => {
        if (ticket !== this.gen) return;
        this.loading = "";
        this.shown = "";
        this.img.hidden = true;
        this.wait.hidden = false;
      };
      this.img.src = src;
      if (this.img.complete && this.img.naturalWidth) reveal();
    });
  }

  private stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.shown = "";
    this.loading = "";
    this.warmed = "";
    this.gen += 1;
    this.el.hidden = true;
    this.img.removeAttribute("src");
  }
}
