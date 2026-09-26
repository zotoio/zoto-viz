import type { StateMsg } from "../core/types";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import {
  assertDecimationMatchesFrame,
  encodedVizFrameBytes,
  takeVizDecimationDropStats,
} from "./viz-decimation-stats";
import {
  VIZ_MAX_HEADLINE_SAMPLES,
  VIZ_MAX_PACKET_SAMPLES,
  VIZ_MAX_RF_SAMPLES,
  VIZ_MAX_TALKER_SAMPLES,
} from "./viz-host";
import { flowWorkWithinCap, type VizBuildWorkCounters } from "./viz-build-counters";

export interface VizFrameCapAssertOptions {
  checkDecimation?: boolean;
  encodedByteCeiling?: number;
}

export function assertVizFrameOutputCaps(
  frame: VizDataFrame,
  opts: VizFrameCapAssertOptions = {},
): void {
  if (frame.packets.length > VIZ_MAX_PACKET_SAMPLES) {
    throw new Error(`packets cap exceeded: ${frame.packets.length} > ${VIZ_MAX_PACKET_SAMPLES}`);
  }
  if (frame.rf.length > VIZ_MAX_RF_SAMPLES) {
    throw new Error(`rf cap exceeded: ${frame.rf.length} > ${VIZ_MAX_RF_SAMPLES}`);
  }
  if (frame.talkers.length > VIZ_MAX_TALKER_SAMPLES) {
    throw new Error(`talkers cap exceeded: ${frame.talkers.length} > ${VIZ_MAX_TALKER_SAMPLES}`);
  }
  if (frame.headlines.length > VIZ_MAX_HEADLINE_SAMPLES) {
    throw new Error(`headlines cap exceeded: ${frame.headlines.length} > ${VIZ_MAX_HEADLINE_SAMPLES}`);
  }
  if (opts.checkDecimation !== false) {
    assertDecimationMatchesFrame(frame, takeVizDecimationDropStats());
  }
  if (opts.encodedByteCeiling != null && encodedVizFrameBytes(frame) > opts.encodedByteCeiling) {
    throw new Error(`encoded frame exceeds ceiling ${opts.encodedByteCeiling}`);
  }
}

export function assertVizBuildWorkGates(state: StateMsg, work: VizBuildWorkCounters): void {
  if (!flowWorkWithinCap(state.flows.length, work)) {
    throw new Error(
      `flow work cap exceeded: visits=${work.flowVisits} rateCalls=${work.rateCalls} flows=${state.flows.length}`,
    );
  }
  if (work.talkerObjectsCreated > VIZ_MAX_TALKER_SAMPLES) {
    throw new Error(`talker allocations exceed top-K: ${work.talkerObjectsCreated}`);
  }
  if (work.packetObjectsCreated > VIZ_MAX_PACKET_SAMPLES) {
    throw new Error(`packet allocations exceed cap: ${work.packetObjectsCreated}`);
  }
  if (work.frameObjectsCreated !== 1) {
    throw new Error(`expected one fresh frame envelope per build, got ${work.frameObjectsCreated}`);
  }
}
