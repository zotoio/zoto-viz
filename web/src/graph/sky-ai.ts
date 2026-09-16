import { currentWeather, skyRebuildDue, WEATHER_ODDS } from "../ui/temper";

export type SkyRecipe = {
  name: string;
  motif: number;
  a: [number, number, number];
  b: [number, number, number];
  warp: number;
  grain: number;
  bands: number;
};

export const DEFAULT_SKY_RECIPE: SkyRecipe = {
  name: "harbour",
  motif: 0,
  a: [0.15, 0.42, 0.85],
  b: [0.85, 0.55, 0.2],
  warp: 0.45,
  grain: 0.25,
  bands: 4,
};

export function cloneSkyRecipe(r: SkyRecipe): SkyRecipe {
  return {
    name: r.name,
    motif: r.motif,
    a: [r.a[0], r.a[1], r.a[2]],
    b: [r.b[0], r.b[1], r.b[2]],
    warp: r.warp,
    grain: r.grain,
    bands: r.bands,
  };
}

export function skyRecipeKey(r: SkyRecipe): string {
  return `${r.motif}|${r.a.map((n) => n.toFixed(3)).join(",")}|${r.b.map((n) => n.toFixed(3)).join(",")}|${r.warp.toFixed(3)}|${r.grain.toFixed(3)}|${r.bands.toFixed(2)}`;
}

/** Smoothstep mix. Motif switches at the halfway mark so the pattern does not flash through every type. */
export function lerpSkyRecipe(from: SkyRecipe, to: SkyRecipe, t: number): SkyRecipe {
  const k = Math.min(1, Math.max(0, t));
  const s = k * k * (3 - 2 * k);
  const mix = (a: number, b: number) => a + (b - a) * s;
  return {
    name: s < 0.5 ? from.name : to.name,
    motif: s < 0.5 ? from.motif : to.motif,
    a: [mix(from.a[0], to.a[0]), mix(from.a[1], to.a[1]), mix(from.a[2], to.a[2])],
    b: [mix(from.b[0], to.b[0]), mix(from.b[1], to.b[1]), mix(from.b[2], to.b[2])],
    warp: mix(from.warp, to.warp),
    grain: mix(from.grain, to.grain),
    bands: mix(from.bands, to.bands),
  };
}

function clamp01(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

function rgb(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  return [clamp01(Number(v[0]), fallback[0]), clamp01(Number(v[1]), fallback[1]), clamp01(Number(v[2]), fallback[2])];
}

/** Pull a recipe from Gemma's reply (bare JSON or a fenced object). */
export function parseSkyRecipe(raw: unknown): SkyRecipe | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = (fence?.[1] ?? raw).trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { obj = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const motif = Math.round(Number(o.motif));
  if (!Number.isFinite(motif)) return null;
  return {
    name: String(o.name || "dynamic").slice(0, 40),
    motif: Math.min(5, Math.max(0, motif)),
    a: rgb(o.a, DEFAULT_SKY_RECIPE.a),
    b: rgb(o.b, DEFAULT_SKY_RECIPE.b),
    warp: clamp01(Number(o.warp), DEFAULT_SKY_RECIPE.warp),
    grain: clamp01(Number(o.grain), DEFAULT_SKY_RECIPE.grain),
    bands: Math.min(12, Math.max(0.5, Number(o.bands) || DEFAULT_SKY_RECIPE.bands)),
  };
}

export async function fetchSkyRecipe(model = "gemma4"): Promise<SkyRecipe> {
  const { apiFetch, bootSession, csrfToken } = await import("../core/http");
  if (!csrfToken()) await bootSession();
  const r = await apiFetch("/api/ai/sky", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: viewPrompt,
      view: viewKey,
      previous: { name: recipe.name, motif: recipe.motif, a: recipe.a, b: recipe.b },
    }),
  });
  const d = await r.json() as { recipe?: unknown; error?: string };
  if (!r.ok) throw new Error(d.error || `sky ${r.status}`);
  return parseSkyRecipe(d.recipe) ?? DEFAULT_SKY_RECIPE;
}

let recipe: SkyRecipe = DEFAULT_SKY_RECIPE;
let fetchedAt = 0;
let inflight: Promise<SkyRecipe> | null = null;
let viewPrompt = "";
let viewKey = "";
let forceNext = false;
let promptTimer = 0;
let fetchGen = 0;

/** Quiet period after This view prompt edits before Gemma rebuilds (avoids a request per keystroke). */
export const PROMPT_REGEN_MS = 450;

export function currentSkyPrompt(): { view: string; prompt: string } {
  return { view: viewKey, prompt: viewPrompt };
}

export function skyForceQueued(): boolean {
  return forceNext;
}

function armForceRebuild(): void {
  fetchedAt = 0;
  forceNext = true;
}

/** Bind this profile's per-view brief. A change queues an immediate AI Dynamic rebuild. */
export function setSkyPrompt(view: string, prompt: string): void {
  const nextView = view.trim().slice(0, 48);
  const nextPrompt = prompt.trim().slice(0, 800);
  if (nextView === viewKey && nextPrompt === viewPrompt) return;
  viewKey = nextView;
  viewPrompt = nextPrompt;
  if (typeof window === "undefined") {
    armForceRebuild();
    return;
  }
  window.clearTimeout(promptTimer);
  promptTimer = window.setTimeout(armForceRebuild, PROMPT_REGEN_MS);
}

export function currentSkyRecipe(): SkyRecipe {
  return recipe;
}

/** Drop the interval so the next ensureSkyRecipe() talks to Gemma immediately. */
export function invalidateSkyRecipe(): void {
  armForceRebuild();
}

function startFetch(): void {
  const mine = ++fetchGen;
  const p = fetchSkyRecipe()
    .then((r) => {
      if (mine !== fetchGen) return recipe;
      recipe = r;
      fetchedAt = Date.now();
      return r;
    })
    .catch(() => {
      if (mine !== fetchGen) return recipe;
      fetchedAt = Date.now();
      return recipe;
    })
    .finally(() => { if (inflight === p) inflight = null; });
  inflight = p;
}

/** Ask Gemma for a new recipe. Weather bands set the tick and P(rebuild); a miss waits another tick.
 *  A This view prompt change (or clicking AI Dynamic) sets forceNext and skips the dice roll. */
export function ensureSkyRecipe(_intervalMs?: number, now = Date.now(), rnd = Math.random): void {
  if (forceNext) {
    forceNext = false;
    startFetch();
    return;
  }
  const odds = WEATHER_ODDS[currentWeather()];
  const due = skyRebuildDue(fetchedAt, now, odds.tickMs, odds.p, rnd());
  if (due === "wait") return;
  if (due === "miss") {
    fetchedAt = now;
    return;
  }
  if (inflight) return;
  startFetch();
}
