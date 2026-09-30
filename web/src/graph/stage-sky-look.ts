import type { PerfOverlay } from "../core/perf";

/**
 * The sky opacity / brightness sliders the backdrop draws with, before the thermal factor
 * and the visibility scale (scene.ts applyLook).
 *
 * Stage-only views always keep the look's sliders (bbf8b77d). Since #177 the perf lean
 * (core/perf.ts perfOverlay) no longer dims the sky on any view: the overlay's skyBright and
 * skyOpacity are the look's own, because the sky shader costs the same at any brightness or
 * opacity. Before #177 it eased them to 0.4 / 0.45 once the 30 s window read under 10 fps, and
 * under SwiftShader that drew Ant Colony black by area 35-60 s after the pick.
 */
export function skyLookFor(
  anim: { skyOpacity: number; skyBright: number },
  tune: Pick<PerfOverlay, "skyOpacity" | "skyBright"> | null,
  stageOnly: boolean,
): { opacity: number; bright: number } {
  if (stageOnly || !tune) return { opacity: anim.skyOpacity, bright: anim.skyBright };
  return { opacity: tune.skyOpacity, bright: tune.skyBright };
}
