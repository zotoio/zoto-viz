import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  assertFlowWorkScaleBounded,
  flowWorkWithinCap,
  simulateNaiveTripleTalkerScanWork,
  takeVizBuildWorkSnapshot,
} from "./viz-build-counters";
import { encodedVizFrameBytes, takeVizDecimationDropStats } from "./viz-decimation-stats";
import { assertVizBuildWorkGates, assertVizFrameOutputCaps } from "./viz-gate-assertions";
import {
  FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING,
  VIZ_MAX_PACKET_SAMPLES,
  VIZ_MAX_TALKER_SAMPLES,
  buildVizFrame,
} from "./viz-host";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const zeroWork = {
  flowVisits: 0,
  flowProtoVisits: 0,
  rateCalls: 0,
  talkerObjectsCreated: 0,
  packetObjectsCreated: 0,
  frameObjectsCreated: 0,
};

describe("viz build count gates", () => {
  it("scale gate formula divides VIZ_BUILD_FLOW_SCALE_MAX by 4", () => {
    const base = { ...zeroWork, flowVisits: 100, rateCalls: 100 };
    const scaledHot = { ...zeroWork, flowVisits: 500, rateCalls: 100 };
    const scaledOk = { ...zeroWork, flowVisits: 440, rateCalls: 100 };
    expect(assertFlowWorkScaleBounded(100, base, 400, scaledHot)).toBe(false);
    expect(assertFlowWorkScaleBounded(100, base, 400, scaledOk)).toBe(true);
  });

  it("flow work scales ≤4.4× when seeded flows scale 4×", () => {
    const baseFlows = 300;
    const stateN = fatLanFixture({ flowCount: baseFlows, seed: 0x5a5a });
    const state4N = fatLanFixture({ flowCount: baseFlows * 4, seed: 0x5a5a });
    buildVizFrame(stateN, 0, 0);
    const workN = takeVizBuildWorkSnapshot();
    buildVizFrame(state4N, 0, 0);
    const work4N = takeVizBuildWorkSnapshot();
    expect(assertFlowWorkScaleBounded(baseFlows, workN, baseFlows * 4, work4N)).toBe(true);
    expect(flowWorkWithinCap(stateN.flows.length, workN)).toBe(true);
    expect(flowWorkWithinCap(state4N.flows.length, work4N)).toBe(true);
  });

  it("naive triple talker scan fails k=2 flow cap", () => {
    const stateN = fatLanFixture({ flowCount: 300, seed: 0x5a5a });
    const state4N = fatLanFixture({ flowCount: 1200, seed: 0x5a5a });
    const naiveN = simulateNaiveTripleTalkerScanWork(stateN.devices.length, stateN.flows.length);
    const naive4N = simulateNaiveTripleTalkerScanWork(state4N.devices.length, state4N.flows.length);
    expect(flowWorkWithinCap(stateN.flows.length, naiveN)).toBe(false);
    expect(flowWorkWithinCap(state4N.flows.length, naive4N)).toBe(false);
  });

  it("headline decimation counts eligibility before output cap", () => {
    const state = fatLanFixture();
    state.sources = {
      feed: {
        id: "feed",
        kind: "rss",
        label: "Feed",
        ok: true,
        feed: true,
        items: Array.from({ length: 72 }, (_, i) => ({ title: `Item ${i}` })),
      },
    };
    buildVizFrame(state, 0, 0);
    const drops = takeVizDecimationDropStats();
    expect(drops.headlinesEligible).toBeGreaterThan(64);
    expect(drops.headlinesKept).toBeLessThanOrEqual(64);
    expect(drops.headlinesDropped).toBe(drops.headlinesEligible - drops.headlinesKept);
  });

  it("fat LAN seeded frame meets output caps and build work gates together", () => {
    const state = fatLanFixture();
    const frame = buildVizFrame(state, 0, 0);
    const work = takeVizBuildWorkSnapshot();
    const drops = takeVizDecimationDropStats();
    assertVizBuildWorkGates(state, work);
    assertVizFrameOutputCaps(frame, { checkDecimation: true });
    expect(encodedVizFrameBytes(frame)).toBeLessThanOrEqual(FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING);
    expect(drops.talkersDropped).toBe(drops.talkersEligible - drops.talkersKept);
    expect(drops.packetsDropped).toBe(drops.packetsEligible - drops.packetsKept);
  });

  it("output caps match decimation drop stats on seeded fat LAN", () => {
    const state = fatLanFixture();
    const frame = buildVizFrame(state, 0, 0);
    const drops = takeVizDecimationDropStats();
    expect(frame.talkers.length).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
    expect(frame.packets.length).toBeLessThanOrEqual(VIZ_MAX_PACKET_SAMPLES);
    expect(drops.talkersDropped).toBe(drops.talkersEligible - drops.talkersKept);
    expect(drops.packetsDropped).toBe(drops.packetsEligible - drops.packetsKept);
    assertVizFrameOutputCaps(frame, { checkDecimation: true });
    expect(encodedVizFrameBytes(frame)).toBeLessThanOrEqual(FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING);
  });

  it.todo("devicePacketRateMap Map reuse stable over 300 builds (#27 contract v2)");

  it.todo("viz links ≤ maxLinks with linksDropped matching cuts (#27 contract v2)");

  it(
    "production bundle excludes counter instrumentation",
    () => {
      expect(() =>
        execFileSync("bash", [path.join(webRoot, "..", "scripts", "check-viz-gate-bundle.sh")], {
          cwd: webRoot,
          stdio: "pipe",
          timeout: 120_000,
        }),
      ).not.toThrow();
    },
    120_000,
  );
});
