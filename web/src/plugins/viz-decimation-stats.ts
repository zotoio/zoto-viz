import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";

export interface VizDecimationDropStats {
  packetsEligible: number;
  packetsKept: number;
  packetsDropped: number;
  talkersEligible: number;
  talkersKept: number;
  talkersDropped: number;
  rfEligible: number;
  rfKept: number;
  rfDropped: number;
  headlinesEligible: number;
  headlinesKept: number;
  headlinesDropped: number;
}

const empty: VizDecimationDropStats = {
  packetsEligible: 0,
  packetsKept: 0,
  packetsDropped: 0,
  talkersEligible: 0,
  talkersKept: 0,
  talkersDropped: 0,
  rfEligible: 0,
  rfKept: 0,
  rfDropped: 0,
  headlinesEligible: 0,
  headlinesKept: 0,
  headlinesDropped: 0,
};

let last = { ...empty };

export function resetVizDecimationDropStats(): void {
  last.packetsEligible = 0;
  last.packetsKept = 0;
  last.packetsDropped = 0;
  last.talkersEligible = 0;
  last.talkersKept = 0;
  last.talkersDropped = 0;
  last.rfEligible = 0;
  last.rfKept = 0;
  last.rfDropped = 0;
  last.headlinesEligible = 0;
  last.headlinesKept = 0;
  last.headlinesDropped = 0;
}

export function takeVizDecimationDropStats(): VizDecimationDropStats {
  return { ...last };
}

export function recordPacketDecimation(eligible: number, kept: number): void {
  last.packetsEligible = eligible;
  last.packetsKept = kept;
  last.packetsDropped = Math.max(0, eligible - kept);
}

export function recordTalkerDecimation(eligible: number, kept: number): void {
  last.talkersEligible = eligible;
  last.talkersKept = kept;
  last.talkersDropped = Math.max(0, eligible - kept);
}

export function recordRfDecimation(eligible: number, kept: number): void {
  last.rfEligible = eligible;
  last.rfKept = kept;
  last.rfDropped = Math.max(0, eligible - kept);
}

export function recordHeadlineDecimation(eligible: number, kept: number): void {
  last.headlinesEligible = eligible;
  last.headlinesKept = kept;
  last.headlinesDropped = Math.max(0, eligible - kept);
}

export function assertDecimationMatchesFrame(frame: VizDataFrame, drops: VizDecimationDropStats): void {
  if (frame.packets.length !== drops.packetsKept) {
    throw new Error(`packets kept mismatch: frame ${frame.packets.length} stats ${drops.packetsKept}`);
  }
  if (frame.talkers.length !== drops.talkersKept) {
    throw new Error(`talkers kept mismatch: frame ${frame.talkers.length} stats ${drops.talkersKept}`);
  }
  if (frame.rf.length !== drops.rfKept) {
    throw new Error(`rf kept mismatch: frame ${frame.rf.length} stats ${drops.rfKept}`);
  }
  if (frame.headlines.length !== drops.headlinesKept) {
    throw new Error(`headlines kept mismatch: frame ${frame.headlines.length} stats ${drops.headlinesKept}`);
  }
  if (drops.packetsDropped !== drops.packetsEligible - drops.packetsKept) {
    throw new Error("packets dropped count inconsistent");
  }
  if (drops.talkersDropped !== drops.talkersEligible - drops.talkersKept) {
    throw new Error("talkers dropped count inconsistent");
  }
  if (drops.rfDropped !== drops.rfEligible - drops.rfKept) {
    throw new Error("rf dropped count inconsistent");
  }
  if (drops.headlinesDropped !== drops.headlinesEligible - drops.headlinesKept) {
    throw new Error("headlines dropped count inconsistent");
  }
}

export function encodedVizFrameBytes(frame: VizDataFrame): number {
  return new TextEncoder().encode(JSON.stringify(frame)).length;
}
