import type { PerfOverlay } from "../core/perf";

/**
 * The sky opacity / brightness sliders the backdrop draws with, before the thermal factor
 * and the visibility scale (scene.ts applyLook): the perf overlay's when there is one, else the
 * look's own. Every view takes the same path.
 *
 * Since #177 the perf lean (core/perf.ts perfOverlay) no longer dims the sky on any view: the
 * overlay's skyBright and skyOpacity are the look's own, because the sky shader costs the same at
 * any brightness or opacity. Before #177 it eased them to 0.4 / 0.45 once the 30 s window read
 * under 10 fps, and under SwiftShader that drew Ant Colony black by area 35-60 s after the pick.
 * #189 removed H1's stage-only exemption here (bbf8b77d), dead since #177: both branches returned
 * the same sliders.
 *
 * `_stageOnly` is ignored. It stays in the signature only so scene.ts applyLook's call compiles
 * without touching scene.ts; drop it together with that argument in the next scene.ts change.
 */
export function skyLookFor(
  anim: { skyOpacity: number; skyBright: number },
  tune: Pick<PerfOverlay, "skyOpacity" | "skyBright"> | null,
  _stageOnly?: boolean,
): { opacity: number; bright: number } {
  if (!tune) return { opacity: anim.skyOpacity, bright: anim.skyBright };
  return { opacity: tune.skyOpacity, bright: tune.skyBright };
}
