/** Local-model scenes for the stereogram, rebuilt on the AI Dynamic weather cadence. */
import { currentWeather, skyRebuildDue, WEATHER_ODDS } from "../ui/temper";
import {
  parseStereoRecipe, StereoScenePlayer, type StereoRecipe, type StereoSceneFrame,
} from "../../../plugins/src/stereo-gram/frontend/recipe";

export interface StereoAiWant {
  audio: boolean;
  /** This view prompt: the operator's brief. */
  prompt: string;
  morphMs: number;
}

const RECENT = 6;

const player = new StereoScenePlayer();
let fetchedAt = 0;
let inflight = false;
let brief = "";
let pending: StereoRecipe | null = null;
let recent: string[] = [];
let lastError = "";

export async function fetchStereoRecipe(want: StereoAiWant, previous: string[], model = "gemma4"): Promise<StereoRecipe> {
  const { apiFetch, bootSession, csrfToken } = await import("../core/http");
  if (!csrfToken()) await bootSession();
  const r = await apiFetch("/api/ai/stereo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, audio: want.audio, prompt: want.prompt, previous }),
  });
  const d = await r.json() as { recipe?: unknown; error?: string };
  if (!r.ok) throw new Error(d.error || `stereo ${r.status}`);
  const recipe = parseStereoRecipe(d.recipe);
  if (!recipe) throw new Error("no usable scene");
  return recipe;
}

function startFetch(want: StereoAiWant): void {
  inflight = true;
  const key = brief;
  fetchStereoRecipe(want, recent)
    .then((r) => {
      if (key !== brief) return;
      pending = r;
      recent = [r.name, ...recent.filter((n) => n !== r.name)].slice(0, RECENT);
      lastError = "";
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== lastError) console.warn("stereo-gram AI scene:", msg);
      lastError = msg;
    })
    .finally(() => {
      inflight = false;
      fetchedAt = key === brief ? Date.now() : 0;
    });
}

/** The scene to draw this frame, or null until the model has answered once. A new brief rebuilds at once. */
export function stereoAiFrame(want: StereoAiWant, nowMs: number, clock: number, wall = Date.now(), rnd = Math.random): StereoSceneFrame | null {
  const key = `${want.audio ? 1 : 0}|${want.prompt.trim()}`;
  if (key !== brief) {
    brief = key;
    fetchedAt = 0;
  }
  if (pending) {
    player.show(pending, nowMs, clock, want.morphMs);
    pending = null;
  }
  if (!inflight) {
    const odds = WEATHER_ODDS[currentWeather()];
    const due = skyRebuildDue(fetchedAt, wall, odds.tickMs, odds.p, rnd());
    if (due === "hit") startFetch(want);
    else if (due === "miss") fetchedAt = wall;
  }
  return player.frame(nowMs, clock);
}

export function stereoAiStatus(): { scene: string | null; error: string; recent: string[] } {
  return { scene: player.current?.name ?? null, error: lastError, recent: [...recent] };
}
