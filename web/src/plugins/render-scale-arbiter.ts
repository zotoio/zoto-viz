import type { RenderScaleGovernor, RenderScaleGovernorProposal } from "./render-scale-governor";

export interface RenderScaleArbiterEntry {
  governor: RenderScaleGovernor;
  proposal: RenderScaleGovernorProposal;
}

/**
 * Page-level gate above per-view {@link RenderScaleGovernor}s.
 *
 * Tiles on one GPU often measure neighbour wait time in their frame samples; without
 * an arbiter every pane would step down together. At most one step-down and one
 * step-up are granted per tick. Step-down only considers panes at the current peak
 * measured cost so queue-inflated neighbours do not drop while a heavier view is
 * still over budget. With a single governed view this matches the plain governor.
 * Intended for reuse when the host moves to one shared WebGL context.
 */
export function arbitrateRenderScaleSteps(
  entries: readonly RenderScaleArbiterEntry[],
  now: number,
): void {
  if (!entries.length) return;
  if (entries.length === 1) {
    const e = entries[0]!;
    if (e.proposal.stepDownReady) e.governor.commitStepDown(now);
    else if (e.proposal.stepUpReady) e.governor.commitStepUp(now);
    return;
  }

  const peakCost = entries.reduce((m, e) => Math.max(m, e.proposal.costMs), 0);
  const downs = entries.filter((e) => e.proposal.stepDownReady && e.proposal.costMs >= peakCost);
  if (downs.length) {
    let winner = downs[0]!;
    for (let i = 1; i < downs.length; i++) {
      const c = downs[i]!;
      if (c.proposal.overshootMs > winner.proposal.overshootMs) winner = c;
    }
    winner.governor.commitStepDown(now);
    return;
  }

  const ups = entries.filter((e) => e.proposal.stepUpReady);
  if (!ups.length) return;
  ups.sort((a, b) => a.proposal.costMs - b.proposal.costMs);
  ups[0]!.governor.commitStepUp(now);
}
