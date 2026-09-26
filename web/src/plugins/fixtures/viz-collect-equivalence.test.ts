import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCollectEquivalenceFixture,
  buildCollectEquivalenceState,
  captureCollectEquivalenceFrame,
  COLLECT_EQUIVALENCE_FLOW_COUNT,
  COLLECT_EQUIVALENCE_FRAMES,
  frameTalkersForCollectEquivalence,
} from "./viz-collect-equivalence-fixture";
import { collectVizLinks, applyVizFrameContractV2, resolveVizFrameCollectOpts, vizFrameCollectTestHooks } from "../viz-frame-collect";
import type { Flow } from "../../core/types";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "viz-collect-equivalence-600.json");
const frozen = JSON.parse(readFileSync(fixturePath, "utf8")) as ReturnType<typeof buildCollectEquivalenceFixture>;

describe("viz collector rewrite equivalence", () => {
  it("matches the frozen 600-frame fixture exactly", () => {
    for (let f = 0; f < COLLECT_EQUIVALENCE_FRAMES; f++) {
      const built = captureCollectEquivalenceFrame(buildCollectEquivalenceState(f));
      expect(built).toEqual(frozen[f]);
    }
  });
});

describe("viz collector rewrite allocation", () => {
  beforeEach(() => {
    vizFrameCollectTestHooks.clearLinkIndexForTest();
    vizFrameCollectTestHooks.clearTalkerIdsCacheForTest();
  });

  it("reuses link pool slot 0 and talker-id Set over 600 steady frames (collector has no join/sort)", () => {
    const collectSrc = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../viz-frame-collect.ts"),
      "utf8",
    );
    expect(collectSrc).not.toMatch(/\.join\s*\(/);
    expect(collectSrc).not.toMatch(/\.sort\s*\(/);

    const ids0 = vizFrameCollectTestHooks.talkerIdSet();
    let link0: ReturnType<typeof vizFrameCollectTestHooks.linkPoolSlot0>;

    for (let f = 1; f <= COLLECT_EQUIVALENCE_FRAMES; f++) {
      captureCollectEquivalenceFrame(buildCollectEquivalenceState(f));
      if (f === 1) {
        link0 = vizFrameCollectTestHooks.linkPoolSlot0();
        expect(vizFrameCollectTestHooks.talkerIdSet()).toBe(ids0);
      }
    }
    expect(vizFrameCollectTestHooks.linkPoolSlot0()).toBe(link0);
    expect(vizFrameCollectTestHooks.talkerIdSet()).toBe(ids0);
    expect(vizFrameCollectTestHooks.talkerIdSetRebuilds()).toBe(1);
  });

  it("rebuilds the talker-id Set exactly once when the talker list changes mid-run", () => {
    for (let f = 0; f < 300; f++) captureCollectEquivalenceFrame(buildCollectEquivalenceState(f));
    const state = buildCollectEquivalenceState(300);
    const frame = {
      contract: 1 as const,
      t: 0,
      dt: 0,
      audio: 0,
      packets: [],
      rf: [],
      talkers: frameTalkersForCollectEquivalence().map((t, i) => (i === 0 ? { ...t, id: "10.0.0.99" } : t)),
      headlines: [],
    };
    applyVizFrameContractV2(frame, state, resolveVizFrameCollectOpts(state));
    expect(vizFrameCollectTestHooks.talkerIdSetRebuilds()).toBe(2);
  });
});

describe("viz collector link pool growth", () => {
  beforeEach(() => {
    vizFrameCollectTestHooks.clearLinkIndexForTest();
    vizFrameCollectTestHooks.clearTalkerIdsCacheForTest();
  });

  function flowsForCount(n: number): Flow[] {
    const flows: Flow[] = [];
    for (let i = 0; i < n; i++) {
      flows.push({
        a: "10.0.0.1",
        b: `10.0.0.${(i % 249) + 2}`,
        bytes: 1,
        packets: 1,
        ports: [],
        protos: ["tcp"],
        ifaces: [],
        first_seen: 0,
        last_seen: 1,
        rate: 1,
        rate_pkt_ab: i + 1,
        rate_pkt_ba: 0,
      });
    }
    return flows;
  }

  it("grows the link pool once for 200→400→200 flows without stale 400-flow slots in 200 output", () => {
    const talkers = new Set(["10.0.0.1"]);
    for (let i = 2; i <= 250; i++) talkers.add(`10.0.0.${i}`);
    const f200a = flowsForCount(200);
    collectVizLinks(f200a, talkers, 8);
    const hw1 = vizFrameCollectTestHooks.linkPoolHighWater();
    collectVizLinks(flowsForCount(400), talkers, 8);
    const hw2 = vizFrameCollectTestHooks.linkPoolHighWater();
    expect(hw2).toBeGreaterThan(hw1);
    const out = collectVizLinks(f200a, talkers, 8);
    expect(hw2).toBe(vizFrameCollectTestHooks.linkPoolHighWater());
    for (const link of out.links) {
      expect(link.dst.startsWith("10.0.0.")).toBe(true);
    }
  });
});
