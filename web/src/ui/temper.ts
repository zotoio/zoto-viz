/** Agent temper (Ollama temperature + system-prompt prefix) and weather (AI Dynamic odds). */

export const TEMPER_KEY = "zoto-viz.temper";
export const WEATHER_KEY = "zoto-viz.weather";
export const TEMPER_MIN = 0;
export const TEMPER_MAX = 100;
export const DEFAULT_TEMPER = 22;

export const TEMPER_BANDS = ["hush", "even", "keen", "feral"] as const;
export type TemperBand = (typeof TEMPER_BANDS)[number];

export const WEATHERS = ["hush", "drift", "pulse", "storm"] as const;
export type Weather = (typeof WEATHERS)[number];
export const DEFAULT_WEATHER: Weather = "drift";

export const PREFIX: Record<TemperBand, string> = {
  hush: "Temper hush. Stay terse and literal. One observation. Do not propose settings, skies, or decorations unless asked. Never invent packet contents.",
    even: "Temper even. Be a calm operator. Short facts. When AI Control is on, make one clearly different change (another theme, sky, motion band, or physics field — gravity, swirl, magnets, strings — not a 5% nudge). Never invent packet contents.",
    keen: "Temper keen. Be curious and slightly theatrical. When the LAN is interesting, jump to a contrasting theme, sky, or physics field (gravity / magnets / swirl). Control on: apply bold, tasteful changes. Never invent packet contents.",
    feral: "Temper feral. Be unhinged in a useful way. Invent skies, shuffle views, rewrite motion and physics, pin decorations. Surprise. Control on: apply changes freely. Still never invent packet contents.",
};

export const WEATHER_ODDS: Record<Weather, { p: number; tickMs: number; label: string }> = {
  hush: { p: 0.22, tickMs: 90_000, label: "quiet" },
  drift: { p: 0.55, tickMs: 25_000, label: "steady" },
  pulse: { p: 0.78, tickMs: 12_000, label: "often" },
  storm: { p: 0.94, tickMs: 6_000, label: "restless" },
};

export function clampTemper(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_TEMPER;
  return Math.min(TEMPER_MAX, Math.max(TEMPER_MIN, Math.round(n)));
}

export function temperBand(n: number): TemperBand {
  const v = clampTemper(n);
  if (v < 25) return "hush";
  if (v < 50) return "even";
  if (v < 75) return "keen";
  return "feral";
}

export function ollamaTemperature(n: number): number {
  return Math.round((0.10 + clampTemper(n) * 0.0135) * 100) / 100;
}

export function parseWeather(raw: unknown): Weather {
  const w = String(raw || "").trim().toLowerCase();
  return (WEATHERS as readonly string[]).includes(w) ? w as Weather : DEFAULT_WEATHER;
}

export function loadTemper(): number {
  try {
    const n = Number(localStorage.getItem(TEMPER_KEY));
    return Number.isFinite(n) ? clampTemper(n) : DEFAULT_TEMPER;
  } catch {
    return DEFAULT_TEMPER;
  }
}

export function loadWeather(): Weather {
  try {
    return parseWeather(localStorage.getItem(WEATHER_KEY));
  } catch {
    return DEFAULT_WEATHER;
  }
}

let weatherNow: Weather = DEFAULT_WEATHER;
try { weatherNow = loadWeather(); } catch { /* tests without localStorage */ }

export function currentWeather(): Weather {
  return weatherNow;
}

export function setCurrentWeather(w: Weather): void {
  weatherNow = w;
  try { localStorage.setItem(WEATHER_KEY, w); } catch { /* ignore */ }
}

/** Typical hour of hits (16 ticks) for the odds forecast strip. */
export function forecastHits(band: Weather, n = 16): boolean[] {
  const p = WEATHER_ODDS[band].p;
  let s = (band.charCodeAt(0) * 0x9e3779b1 + n * 0x85ebca6b) >>> 0;
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    out.push(s / 0x100000000 < p);
  }
  return out;
}

/** wait = still inside the tick; miss = rolled and skipped; hit = rebuild. */
export function skyRebuildDue(fetchedAt: number, now: number, tickMs: number, p: number, rnd: number): "wait" | "miss" | "hit" {
  const tick = Math.max(4_000, tickMs);
  if (fetchedAt && now - fetchedAt < tick) return "wait";
  if (!fetchedAt) return "hit";
  return rnd < p ? "hit" : "miss";
}

export class TemperRail {
  readonly el: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly val: HTMLSpanElement;
  private readonly hint: HTMLParagraphElement;
  onChange: (n: number) => void;

  constructor(cfg: { value?: number; onChange?: (n: number) => void } = {}) {
    this.onChange = cfg.onChange ?? (() => {});
    this.el = document.createElement("div");
    this.el.className = "sec temper";
    const title = document.createElement("div");
    title.className = "sec-title";
    title.textContent = "temper";
    this.val = document.createElement("span");
    this.val.className = "temper-val";
    const head = document.createElement("div");
    head.className = "temper-head";
    head.append(title, this.val);

    this.input = document.createElement("input");
    this.input.type = "range";
    this.input.min = String(TEMPER_MIN);
    this.input.max = String(TEMPER_MAX);
    this.input.step = "1";
    this.input.setAttribute("aria-label", "temper");
    this.input.value = String(clampTemper(cfg.value ?? loadTemper()));

    const bands = document.createElement("div");
    bands.className = "temper-bands";
    bands.setAttribute("role", "list");
    for (const id of TEMPER_BANDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "temper-band";
      b.dataset.band = id;
      b.textContent = id;
      b.setAttribute("aria-label", `temper ${id}`);
      b.addEventListener("click", () => {
        const snap = id === "hush" ? 8 : id === "even" ? 36 : id === "keen" ? 62 : 88;
        this.value = snap;
        this.onChange(snap);
      });
      bands.append(b);
    }

    this.hint = document.createElement("p");
    this.hint.className = "sec-hint temper-prefix";
    this.el.append(head, this.input, bands, this.hint);
    this.paint();
    this.input.addEventListener("input", () => {
      this.paint();
      this.onChange(this.value);
    });
  }

  get value(): number { return clampTemper(Number(this.input.value)); }
  set value(n: number) {
    this.input.value = String(clampTemper(n));
    this.paint();
  }

  private paint(): void {
    const n = this.value;
    const band = temperBand(n);
    this.el.dataset.band = band;
    this.val.textContent = `${band} · ${ollamaTemperature(n).toFixed(2)}`;
    this.hint.textContent = PREFIX[band];
    this.el.style.setProperty("--temper", `${n}`);
    for (const b of this.el.querySelectorAll<HTMLElement>(".temper-band")) {
      b.setAttribute("aria-pressed", b.dataset.band === band ? "true" : "false");
    }
  }
}

export class OddsStrip {
  readonly el: HTMLDivElement;
  private current: Weather;
  onChange: (w: Weather) => void;

  constructor(cfg: { value?: Weather; onChange?: (w: Weather) => void } = {}) {
    this.onChange = cfg.onChange ?? (() => {});
    this.current = parseWeather(cfg.value ?? loadWeather());
    this.el = document.createElement("div");
    this.el.className = "sec odds";
    const title = document.createElement("div");
    title.className = "sec-title";
    title.textContent = "weather";
    const sub = document.createElement("div");
    sub.className = "sec-hint";
    sub.textContent = "Chance Gemma rebuilds the AI Dynamic sky each tick. Wider band = higher odds.";
    const rail = document.createElement("div");
    rail.className = "odds-rail";
    rail.setAttribute("role", "radiogroup");
    rail.setAttribute("aria-label", "AI change weather");
    for (const id of WEATHERS) {
      const meta = WEATHER_ODDS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "odds-band";
      btn.dataset.weather = id;
      btn.setAttribute("role", "radio");
      btn.style.flexGrow = String(Math.max(1, Math.round(meta.p * 20)));
      const cap = document.createElement("span");
      cap.className = "odds-cap";
      cap.textContent = id;
      const pct = document.createElement("span");
      pct.className = "odds-pct";
      pct.textContent = `${Math.round(meta.p * 100)}%`;
      const pips = document.createElement("span");
      pips.className = "odds-pips";
      pips.setAttribute("aria-hidden", "true");
      const filled = Math.max(1, Math.round(meta.p * 10));
      for (let i = 0; i < 10; i++) {
        const pip = document.createElement("i");
        if (i < filled) pip.className = "on";
        pips.append(pip);
      }
      btn.append(cap, pct, pips);
      btn.title = `${id}: ${meta.label} — ${Math.round(meta.p * 100)}% each ${Math.round(meta.tickMs / 1000)}s`;
      btn.addEventListener("click", () => this.set(id, true));
      rail.append(btn);
    }
    const forecast = document.createElement("div");
    forecast.className = "odds-forecast";
    forecast.setAttribute("aria-hidden", "true");
    this.el.append(title, sub, rail, forecast);
    this.paint();
  }

  get value(): Weather { return this.current; }
  set value(w: Weather) { this.set(w, false); }

  private set(w: Weather, fire: boolean): void {
    const next = parseWeather(w);
    if (next === this.current && !fire) {
      this.paint();
      return;
    }
    this.current = next;
    this.paint();
    if (fire) this.onChange(next);
  }

  private paint(): void {
    this.el.dataset.weather = this.current;
    for (const b of this.el.querySelectorAll<HTMLElement>(".odds-band")) {
      b.setAttribute("aria-checked", b.dataset.weather === this.current ? "true" : "false");
    }
    const row = this.el.querySelector(".odds-forecast");
    if (!row) return;
    row.replaceChildren();
    const hits = forecastHits(this.current);
    for (const on of hits) {
      const i = document.createElement("i");
      if (on) i.className = "hit";
      row.append(i);
    }
  }
}
