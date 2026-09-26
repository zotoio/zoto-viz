/**
 * Optional per-build work tallies for dogfood gates. Stripped from production
 * bundles when `__VIZ_BUILD_COUNTERS__` is false (see vite.config.ts).
 */

declare const __VIZ_BUILD_COUNTERS__: boolean | undefined;

/** Max flow-scaled work per `buildVizFrame` (single-pass talker + one flow walk). */
export const VIZ_BUILD_FLOW_WORK_MULT = 2;

/** Allowed growth when flow count scales 4× (seeded fat LAN). */
export const VIZ_BUILD_FLOW_SCALE_MAX = 4.4;

export interface VizBuildWorkCounters {
  flowVisits: number;
  flowProtoVisits: number;
  rateCalls: number;
  talkerObjectsCreated: number;
  packetObjectsCreated: number;
  frameObjectsCreated: number;
}

const zero: VizBuildWorkCounters = {
  flowVisits: 0,
  flowProtoVisits: 0,
  rateCalls: 0,
  talkerObjectsCreated: 0,
  packetObjectsCreated: 0,
  frameObjectsCreated: 0,
};

const counters: VizBuildWorkCounters = { ...zero };

export function resetVizBuildCounters(): void {
  counters.flowVisits = 0;
  counters.flowProtoVisits = 0;
  counters.rateCalls = 0;
  counters.talkerObjectsCreated = 0;
  counters.packetObjectsCreated = 0;
  counters.frameObjectsCreated = 0;
}

export function takeVizBuildWorkSnapshot(): VizBuildWorkCounters {
  return {
    flowVisits: counters.flowVisits,
    flowProtoVisits: counters.flowProtoVisits,
    rateCalls: counters.rateCalls,
    talkerObjectsCreated: counters.talkerObjectsCreated,
    packetObjectsCreated: counters.packetObjectsCreated,
    frameObjectsCreated: counters.frameObjectsCreated,
  };
}

export function bumpFlowVisit(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.flowVisits++;
}

export function bumpFlowProtoVisit(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.flowProtoVisits++;
}

export function bumpRateCall(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.rateCalls++;
}

export function bumpTalkerObject(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.talkerObjectsCreated++;
}

export function bumpPacketObject(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.packetObjectsCreated++;
}

export function bumpFrameObject(): void {
  if (!__VIZ_BUILD_COUNTERS__) return;
  counters.frameObjectsCreated++;
}

export function flowWorkWithinCap(flows: number, work: VizBuildWorkCounters): boolean {
  const cap = flows * VIZ_BUILD_FLOW_WORK_MULT;
  return work.flowVisits <= cap && work.rateCalls <= cap;
}

export function flowWorkScaleRatio(
  baseFlows: number,
  base: VizBuildWorkCounters,
  scaledFlows: number,
  scaled: VizBuildWorkCounters,
): { flowVisits: number; rateCalls: number } {
  const flowDenom = Math.max(1, base.flowVisits);
  const rateDenom = Math.max(1, base.rateCalls);
  return {
    flowVisits: scaled.flowVisits / flowDenom,
    rateCalls: scaled.rateCalls / rateDenom,
  };
}

/** When flow count scales up, per-build work must not grow faster than {@link VIZ_BUILD_FLOW_SCALE_MAX}. */
export function assertFlowWorkScaleBounded(
  baseFlows: number,
  base: VizBuildWorkCounters,
  scaledFlows: number,
  scaled: VizBuildWorkCounters,
): boolean {
  if (scaledFlows < baseFlows) return false;
  const flowRatio = scaledFlows / baseFlows;
  const { flowVisits, rateCalls } = flowWorkScaleRatio(baseFlows, base, scaledFlows, scaled);
  return flowVisits <= flowRatio * VIZ_BUILD_FLOW_SCALE_MAX && rateCalls <= flowRatio * VIZ_BUILD_FLOW_SCALE_MAX;
}

/** Regression class: rescan every flow 3× per device. */
export function simulateNaiveTripleTalkerScanWork(devices: number, flows: number): VizBuildWorkCounters {
  const rateCalls = devices * flows * 3;
  return {
    flowVisits: rateCalls,
    flowProtoVisits: 0,
    rateCalls,
    talkerObjectsCreated: 0,
    packetObjectsCreated: 0,
    frameObjectsCreated: 0,
  };
}
