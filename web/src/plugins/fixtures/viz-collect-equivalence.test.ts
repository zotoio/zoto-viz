import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCollectEquivalenceState,
  captureCollectEquivalenceFrame,
  COLLECT_EQUIVALENCE_FRAMES,
  frameTalkersForCollectEquivalence,
  type CollectEquivalenceFrame,
} from "./viz-collect-equivalence-fixture";
import type { Flow } from "../../core/types";
import type { VizDataFrame } from "../viz-host";

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "viz-collect-equivalence-600.jsonl");

function loadFrozenCollectEquivalenceFixture(): CollectEquivalenceFrame[] {
  const text = readFileSync(fixturePath, "utf8").trim();
  if (!text) return [];
  return text.split("\n").map((line, i) => {
    try {
      return JSON.parse(line) as CollectEquivalenceFrame;
    } catch (e) {
      throw new Error(`viz-collect-equivalence-600.jsonl line ${i + 1}: invalid JSON (${String(e)})`);
    }
  });
}

function firstCollectEquivalenceDiff(
  built: CollectEquivalenceFrame,
  expected: CollectEquivalenceFrame,
): string | null {
  if (built.linksDropped !== expected.linksDropped) {
    return `linksDropped (expected ${expected.linksDropped}, got ${built.linksDropped})`;
  }
  if (built.links.length !== expected.links.length) {
    return `links.length (expected ${expected.links.length}, got ${built.links.length})`;
  }
  for (let i = 0; i < built.links.length; i++) {
    const bl = built.links[i]!;
    const el = expected.links[i]!;
    if (bl.src !== el.src) return `links[${i}].src (expected ${el.src}, got ${bl.src})`;
    if (bl.dst !== el.dst) return `links[${i}].dst (expected ${el.dst}, got ${bl.dst})`;
    if (bl.rate !== el.rate) return `links[${i}].rate (expected ${el.rate}, got ${bl.rate})`;
  }
  if (built.talkers.length !== expected.talkers.length) {
    return `talkers.length (expected ${expected.talkers.length}, got ${built.talkers.length})`;
  }
  for (let i = 0; i < built.talkers.length; i++) {
    const bt = built.talkers[i]!;
    const et = expected.talkers[i]!;
    if (bt.id !== et.id) return `talkers[${i}].id (expected ${et.id}, got ${bt.id})`;
    const bf = bt.failed;
    const ef = et.failed;
    if (bf !== ef) return `talkers[${i}].failed (expected ${String(ef)}, got ${String(bf)})`;
  }
  return null;
}

const frozen = loadFrozenCollectEquivalenceFixture();

describe("viz collector rewrite equivalence", () => {
  it("matches the frozen 600-frame fixture exactly", () => {
    expect(frozen.length).toBe(COLLECT_EQUIVALENCE_FRAMES);
    for (let f = 0; f < COLLECT_EQUIVALENCE_FRAMES; f++) {
      const built = captureCollectEquivalenceFrame(buildCollectEquivalenceState(f));
      const diff = firstCollectEquivalenceDiff(built, frozen[f]!);
      if (diff) {
        expect.fail(`frame ${f}: ${diff}`);
      }
    }
  });
});

async function importCollectModule() {
  return import("../viz-frame-collect");
}

function collectEquivalenceVizFrame(state: ReturnType<typeof buildCollectEquivalenceState>): VizDataFrame {
  return {
    contract: 1,
    t: state.ts ?? 0,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers: frameTalkersForCollectEquivalence(),
    headlines: [],
  };
}

describe("viz collector rewrite allocation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reuses link pool slot 0 and talker-id Set over 600 steady frames (collector has no join/sort)", async () => {
    const collectMod = await importCollectModule();
    const collectSrc = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../viz-frame-collect.ts"),
      "utf8",
    );
    expect(collectSrc).not.toMatch(/\.join\s*\(/);
    expect(collectSrc).not.toMatch(/\.sort\s*\(/);

    const talkers = new Set(frameTalkersForCollectEquivalence().map((t) => t.id));
    const opts = collectMod.resolveVizFrameCollectOpts(buildCollectEquivalenceState(1));
    collectMod.collectVizLinks(buildCollectEquivalenceState(1).flows, talkers, opts.maxLinks);

    let linkIndexSets = 0;
    const mapSet = Map.prototype.set;
    vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      if (typeof key === "string" && key.startsWith("10.0.0.")) linkIndexSets++;
      return mapSet.call(this, key, value);
    });

    for (let f = 2; f <= COLLECT_EQUIVALENCE_FRAMES; f++) {
      collectMod.collectVizLinks(buildCollectEquivalenceState(f).flows, talkers, opts.maxLinks);
    }

    expect(linkIndexSets).toBe(0);
  });

  it("rebuilds talker membership when the talker list changes mid-run", async () => {
    const collectMod = await importCollectModule();
    const opts = collectMod.resolveVizFrameCollectOpts(buildCollectEquivalenceState(0));
    for (let f = 0; f < 300; f++) {
      const state = buildCollectEquivalenceState(f);
      collectMod.applyVizFrameContractV2(collectEquivalenceVizFrame(state), state, opts);
    }
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
    collectMod.applyVizFrameContractV2(frame, state, opts);
    const ids = new Set(frame.talkers.map((t) => t.id));
    expect(ids.has("10.0.0.99")).toBe(true);
    expect(ids.has("10.0.0.1")).toBe(false);
    collectMod.assertLinksMatchTalkers(frame);
    for (const link of frame.links ?? []) {
      expect(ids.has(link.src)).toBe(true);
      expect(ids.has(link.dst)).toBe(true);
    }
  });
});

describe("viz collector link pool growth", () => {
  beforeEach(() => {
    vi.resetModules();
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

  it("grows the link pool once for 200→400→200 flows without stale 400-flow slots in 200 output", async () => {
    const talkers = new Set(["10.0.0.1"]);
    for (let i = 2; i <= 250; i++) talkers.add(`10.0.0.${i}`);
    const f200a = flowsForCount(200);

    vi.resetModules();
    const baseline = await importCollectModule();
    const expected = baseline.collectVizLinks(f200a, talkers, 8);

    vi.resetModules();
    const { collectVizLinks } = await importCollectModule();
    collectVizLinks(f200a, talkers, 8);
    collectVizLinks(flowsForCount(400), talkers, 8);
    const out = collectVizLinks(f200a, talkers, 8);

    expect(out.links.map((l) => ({ src: l.src, dst: l.dst, rate: l.rate }))).toEqual(
      expected.links.map((l) => ({ src: l.src, dst: l.dst, rate: l.rate })),
    );
  });
});
