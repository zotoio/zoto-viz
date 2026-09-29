import type { PerfOverlay } from "../core/perf";

/**
 * The sky opacity / brightness sliders the backdrop draws with, before the thermal factor
 * and the visibility scale (scene.ts applyLook).
 *
 * The perf lean (core/perf.ts perfOverlay) eases skyBright to 0.4 and skyOpacity to 0.45 once
 * the 30 s window reads under 10 fps. That saves no GPU work (the sky shader costs the same
 * at any brightness or opacity), and on a stage-only view the sky is the whole picture: under
 * SwiftShader, Ant Colony was drawn at 0.4 / 1.05 brightness and 45% over the clear, black by
 * area 35-60 s after the pick. Stage-only views keep the look's sliders; the graph views still
 * lean their sky behind the graph.
 */
export function skyLookFor(
  anim: { skyOpacity: number; skyBright: number },
  tune: Pick<PerfOverlay, "skyOpacity" | "skyBright"> | null,
  stageOnly: boolean,
): { opacity: number; bright: number } {
  if (stageOnly || !tune) return { opacity: anim.skyOpacity, bright: anim.skyBright };
  return { opacity: tune.skyOpacity, bright: tune.skyBright };
}
