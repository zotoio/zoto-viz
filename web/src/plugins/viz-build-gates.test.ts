import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { fatLanFixture } from "./fixtures/fat-lan-state";
import {
  FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING,
  VIZ_MAX_PACKET_SAMPLES,
  VIZ_MAX_TALKER_SAMPLES,
  assertFlowWorkScaleBounded,
  buildVizFrame,
  encodedVizFrameBytes,
  flowWorkWithinCap,
  simulateNaiveTripleTalkerScanWork,
  takeVizBuildWorkSnapshot,
  takeVizDecimationDropStats,
  assertVizFrameOutputCaps,
} from "./viz-host";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("viz build count gates", () => {
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

  it("naive triple talker scan fails k=2 flow cap and 4× scaling", () => {
    const stateN = fatLanFixture({ flowCount: 300, seed: 0x5a5a });
    const state4N = fatLanFixture({ flowCount: 1200, seed: 0x5a5a });
    const naiveN = simulateNaiveTripleTalkerScanWork(stateN.devices.length, stateN.flows.length);
    const naive4N = simulateNaiveTripleTalkerScanWork(state4N.devices.length, state4N.flows.length);
    expect(flowWorkWithinCap(stateN.flows.length, naiveN)).toBe(false);
    expect(flowWorkWithinCap(state4N.flows.length, naive4N)).toBe(false);
    expect(assertFlowWorkScaleBounded(300, naiveN, 1200, naive4N)).toBe(true);
  });

  it("output caps match decimation drop stats on seeded fat LAN", () => {
    const state = fatLanFixture();
    const frame = buildVizFrame(state, 0, 0);
    const drops = takeVizDecimationDropStats();
    expect(frame.talkers.length).toBeLessThanOrEqual(VIZ_MAX_TALKER_SAMPLES);
    expect(frame.packets.length).toBeLessThanOrEqual(VIZ_MAX_PACKET_SAMPLES);
    expect(drops.talkersDropped).toBe(drops.talkersEligible - drops.talkersKept);
    expect(drops.packetsDropped).toBe(drops.packetsEligible - drops.packetsKept);
    assertVizFrameOutputCaps(frame, {
      checkDecimation: true,
      encodedByteCeiling: FAT_LAN_SEEDED_VIZ_FRAME_BYTE_CEILING,
    });
  });

  it.todo("devicePacketRateMap Map reuse stable over 300 builds (#27 contract v2)");

  it.todo("viz links ≤ maxLinks with linksDropped matching cuts (#27 contract v2)");

  it("production bundle excludes counter instrumentation", () => {
    execFileSync("pnpm", ["build"], { cwd: webRoot, stdio: "pipe" });
    const dist = path.join(webRoot, "dist", "assets");
    const js = readdirSync(dist).filter((f) => f.endsWith(".js"));
    expect(js.length).toBeGreaterThan(0);
    const blob = js.map((f) => readFileSync(path.join(dist, f), "utf8")).join("\n");
    expect(blob).not.toMatch(/bumpFlowVisit/);
    expect(blob).not.toMatch(/viz-build-counters/);
    expect(blob).not.toContain("bumpRateCall");
  });
});
