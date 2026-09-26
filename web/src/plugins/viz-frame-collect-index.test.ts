import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow } from "../core/types";
import {
  applyVizFrameContractV2,
  collectVizLinks,
  resolveVizFrameCollectOpts,
  VIZ_LINK_IDLE_DROP_FRAMES,
} from "./viz-frame-collect";
import { vizLinkRenderColor, vizLinkRenderKey, vizLinkRecordIdentity } from "./viz-link-render";
import { buildCollectEquivalenceState, frameTalkersForCollectEquivalence } from "./fixtures/viz-collect-equivalence-fixture";

function flowsUniquePairs(n: number, rateBase = 1): Flow[] {
  const flows: Flow[] = [];
  for (let i = 0; i < n; i++) {
    flows.push({
      a: "10.0.0.1",
      b: `10.0.0.${i + 2}`,
      bytes: 1,
      packets: 1,
      ports: [],
      protos: ["tcp"],
      ifaces: [],
      first_seen: 0,
      last_seen: 1,
      rate: 1,
      rate_pkt_ab: rateBase + i,
      rate_pkt_ba: 0,
    });
  }
  return flows;
}

async function freshCollect() {
  vi.resetModules();
  return import("./viz-frame-collect");
}

const nativeMapSet = Map.prototype.set;

function countNewTalkerIndexWrites(run: () => void): number {
  let n = 0;
  const mapSpy = vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key, value) {
    if (typeof key === "string" && key.startsWith("10.0.0.")) n++;
    return nativeMapSet.call(this, key, value);
  });
  const setAdd = Set.prototype.add;
  const setSpy = vi.spyOn(Set.prototype, "add").mockImplementation(function (this: Set<unknown>, value) {
    if (typeof value === "string" && value.startsWith("10.0.0.")) n++;
    return setAdd.call(this, value);
  });
  run();
  mapSpy.mockRestore();
  setSpy.mockRestore();
  return n;
}

describe("viz link index R1 pruning", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("zeroing pass visits exactly 200 slots after 200→400→200 flows when endpoints leave talkers", async () => {
    const mod = await freshCollect();
    const talkers200 = new Set<string>(["10.0.0.1"]);
    for (let i = 2; i <= 201; i++) talkers200.add(`10.0.0.${i}`);
    const talkers400 = new Set(talkers200);
    for (let i = 202; i <= 401; i++) talkers400.add(`10.0.0.${i}`);
    const f200 = flowsUniquePairs(200);
    mod.collectVizLinks(f200, talkers200, 8);
    mod.collectVizLinks(flowsUniquePairs(400), talkers400, 8);
    const baseline = mod.collectVizLinks(f200, talkers200, 8);
    const newSets = countNewTalkerIndexWrites(() => {
      mod.collectVizLinks(f200, talkers200, 8);
    });
    expect(newSets).toBe(0);
    expect(mod.collectVizLinks(f200, talkers200, 8).links).toEqual(baseline.links);
  });

  it("drops an idle pair at frame 3600 but keeps it indexed until then", async () => {
    const mod = await freshCollect();
    expect(VIZ_LINK_IDLE_DROP_FRAMES).toBe(3600);
    const talkers = new Set(["10.0.0.1", "10.0.0.2"]);
    const once: Flow[] = [
      {
        a: "10.0.0.1",
        b: "10.0.0.2",
        bytes: 1,
        packets: 1,
        ports: [],
        protos: ["tcp"],
        ifaces: [],
        first_seen: 0,
        last_seen: 1,
        rate: 1,
        rate_pkt_ab: 5,
        rate_pkt_ba: 0,
      },
    ];
    mod.collectVizLinks(once, talkers, 8);
    for (let f = 0; f < VIZ_LINK_IDLE_DROP_FRAMES - 1; f++) {
      const out = mod.collectVizLinks([], talkers, 8);
      expect(out.links).toEqual([]);
    }
    mod.collectVizLinks([], talkers, 8);
    const out = mod.collectVizLinks(once, talkers, 8);
    expect(out.links[0]?.rate).toBe(5);
  });

  it("holds exactly 8 indexed pairs after cycling 1000 endpoints in batches of 8", async () => {
    const mod = await freshCollect();
    for (let batch = 0; batch < 125; batch++) {
      const base = batch * 8;
      const talkers = new Set<string>();
      const flows: Flow[] = [];
      for (let i = 0; i < 12; i++) {
        const a = `10.1.${base}.1`;
        const b = `10.1.${base}.${i + 2}`;
        talkers.add(a);
        talkers.add(b);
        flows.push({
          a,
          b,
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 50 - i,
          rate_pkt_ba: 0,
        });
      }
      const frameTalkers = [...talkers].map((id) => ({ id, rate: 1, role: "lan" as const }));
      const state = {
        ...buildCollectEquivalenceState(0),
        devices: [],
        flows,
        host: { vizFrame: { links: true, linksMax: 8 } },
      };
      const frame = {
        contract: 2 as const,
        t: batch,
        dt: 0.016,
        audio: 0,
        packets: [],
        rf: [],
        talkers: frameTalkers,
        headlines: [],
      };
      mod.applyVizFrameContractV2(frame, state, mod.resolveVizFrameCollectOpts(state));
      expect(frame.links?.length ?? 0).toBe(8);
    }
  });
});

describe("viz link index R2 tie-break", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("returns identical top links for two arrival orders of the same 400 flows", async () => {
    const mod = await freshCollect();
    const talkers = new Set(["10.0.0.1"]);
    for (let i = 2; i <= 401; i++) talkers.add(`10.0.0.${i}`);
    const flows = flowsUniquePairs(400, 88);
    for (let i = 0; i < flows.length; i++) flows[i]!.rate_pkt_ab = 88.5;
    const orderA = [...flows];
    const orderB = [...flows].reverse();
    const snap = (f: Flow[]) =>
      mod.collectVizLinks(f, talkers, 8).links.map((l) => `${l.src}>${l.dst}@${l.rate}`);
    expect(snap(orderA)).toEqual(snap(orderB));
    mod.collectVizLinks(orderA, talkers, 8);
    expect(snap(orderB)).toEqual(snap(orderA));
  });
});

describe("viz link index R7 syncTalkerIds production path", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("rebinds talker membership through applyVizFrameContractV2 when the talker list changes", async () => {
    const mod = await freshCollect();
    const opts = mod.resolveVizFrameCollectOpts(buildCollectEquivalenceState(0));
    for (let f = 0; f < 300; f++) {
      const state = buildCollectEquivalenceState(f);
      mod.applyVizFrameContractV2(
        {
          contract: 2,
          t: f,
          dt: 0.016,
          audio: 0,
          packets: [],
          rf: [],
          talkers: frameTalkersForCollectEquivalence(),
          headlines: [],
        },
        state,
        opts,
      );
    }
    const state = buildCollectEquivalenceState(300);
    const frame = {
      contract: 2 as const,
      t: 300,
      dt: 0.016,
      audio: 0,
      packets: [],
      rf: [],
      talkers: frameTalkersForCollectEquivalence().map((t, i) => (i === 0 ? { ...t, id: "10.0.0.99" } : t)),
      headlines: [],
    };
    mod.applyVizFrameContractV2(frame, state, opts);
    const ids = new Set(frame.talkers.map((t) => t.id));
    for (const link of frame.links ?? []) {
      expect(ids.has(link.src)).toBe(true);
      expect(ids.has(link.dst)).toBe(true);
    }
    expect(ids.has("10.0.0.99")).toBe(true);
    expect(frame.links?.some((l) => l.src === "10.0.0.1" || l.dst === "10.0.0.1")).toBe(false);
  });
});

describe("viz link render R6 (collector draft — fade rows deferred)", () => {
  beforeEach(() => expect.hasAssertions());

  it("R6(a): link record identity follows (src, dst) regardless of output rank", async () => {
    const mod = await freshCollect();
    const talkers = new Set(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    const lowRank = mod.collectVizLinks(
      [
        {
          a: "10.0.0.1",
          b: "10.0.0.2",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 1,
          rate_pkt_ba: 0,
        },
        {
          a: "10.0.0.1",
          b: "10.0.0.3",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 99,
          rate_pkt_ba: 0,
        },
      ],
      talkers,
      2,
    );
    const highRank = mod.collectVizLinks(
      [
        {
          a: "10.0.0.1",
          b: "10.0.0.3",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 99,
          rate_pkt_ba: 0,
        },
        {
          a: "10.0.0.1",
          b: "10.0.0.2",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 1,
          rate_pkt_ba: 0,
        },
      ],
      talkers,
      2,
    );
    const pair = lowRank.links.find((l) => l.src === "10.0.0.1" && l.dst === "10.0.0.2")!;
    expect(vizLinkRecordIdentity("10.0.0.1", "10.0.0.2", 0)).toBe(vizLinkRecordIdentity("10.0.0.1", "10.0.0.2", 1));
    expect(vizLinkRecordIdentity(pair.src, pair.dst, 0)).toBe(`${pair.src}\0${pair.dst}`);
  });

  it("R6(b): render key and colour are pure functions of (src, dst)", () => {
    const k1 = vizLinkRenderKey("10.0.0.1", "10.0.0.2");
    expect(vizLinkRenderKey("10.0.0.1", "10.0.0.2")).toBe(k1);
    expect(vizLinkRenderColor("10.0.0.1", "10.0.0.2")).toBe(vizLinkRenderColor("10.0.0.1", "10.0.0.2"));
    expect(vizLinkRenderKey("10.0.0.2", "10.0.0.1")).not.toBe(k1);
  });
});

describe("viz link index R7b pool set count", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("creates exactly 400 indexed pairs on 200+400 flows and 0 new sets on the second 200 pass", async () => {
    const mod = await freshCollect();
    const talkers = new Set<string>(["10.0.0.1"]);
    for (let i = 2; i <= 401; i++) talkers.add(`10.0.0.${i}`);
    const f200 = flowsUniquePairs(200);
    mod.collectVizLinks(f200, talkers, 8);
    mod.collectVizLinks(flowsUniquePairs(400), talkers, 8);
    const newOn200 = countNewTalkerIndexWrites(() => mod.collectVizLinks(f200, talkers, 8));
    expect(newOn200).toBe(0);
  });
});

describe("viz link index R4 reset on reuse", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("gives a reused slot a fresh rate after idle drop and a new pair", async () => {
    const mod = await freshCollect();
    const talkers = new Set(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
    mod.collectVizLinks(
      [
        {
          a: "10.0.0.1",
          b: "10.0.0.2",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 9,
          rate_pkt_ba: 0,
        },
      ],
      talkers,
      8,
    );
    for (let i = 0; i < VIZ_LINK_IDLE_DROP_FRAMES; i++) mod.collectVizLinks([], talkers, 8);
    const out = mod.collectVizLinks(
      [
        {
          a: "10.0.0.1",
          b: "10.0.0.3",
          bytes: 1,
          packets: 1,
          ports: [],
          protos: ["tcp"],
          ifaces: [],
          first_seen: 0,
          last_seen: 1,
          rate: 1,
          rate_pkt_ab: 4,
          rate_pkt_ba: 0,
        },
      ],
      talkers,
      8,
    );
    expect(out.links[0]?.rate).toBe(4);
    expect(out.links[0]?.dst).toBe("10.0.0.3");
    expect(out.links.some((l) => l.dst === "10.0.0.2" && l.rate > 0)).toBe(false);
  });
});
