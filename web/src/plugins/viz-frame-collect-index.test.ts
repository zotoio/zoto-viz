import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Flow } from "../core/types";
import {
  applyVizFrameContractV2,
  collectVizLinks,
  readLinkSlotIdleZeroFrames,
  readLinkSlotGeneration,
  readTalkerIdSetRebuildCount,
  readVizLinkIndexEntryCount,
  readVizLinkLastNewPairSetCount,
  readVizLinkPoolLength,
  readVizLinkZeroPassVisitCount,
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
    mod.collectVizLinks(f200, talkers200, 8);
    expect(mod.readVizLinkZeroPassVisitCount()).toBe(200);
    expect(mod.readVizLinkIndexEntryCount()).toBe(200);
  });

  it("drops an idle pair at frame 3600 but keeps it indexed at frame 3599", async () => {
    const mod = await freshCollect();
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
    for (let f = 0; f < VIZ_LINK_IDLE_DROP_FRAMES; f++) {
      mod.collectVizLinks([], talkers, 8);
      if (f < VIZ_LINK_IDLE_DROP_FRAMES - 1) {
        expect(mod.readVizLinkIndexEntryCount()).toBe(1);
      }
    }
    expect(mod.readVizLinkIndexEntryCount()).toBe(0);
  });

  it("holds exactly 8 indexed pairs after cycling 1000 endpoints in batches of 8", async () => {
    const mod = await freshCollect();
    for (let batch = 0; batch < 125; batch++) {
      const base = batch * 8;
      const talkers = new Set<string>();
      const flows: Flow[] = [];
      for (let i = 0; i < 8; i++) {
        const a = `10.1.${base + i}.1`;
        const b = `10.1.${base + i}.2`;
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
          rate_pkt_ab: 10 + i,
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
    }
    expect(mod.readVizLinkIndexEntryCount()).toBe(8);
    expect(mod.readVizLinkPoolLength()).toBeLessThanOrEqual(8 + 8);
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
    for (let i = 2; i <= 250; i++) talkers.add(`10.0.0.${i}`);
    const flows = flowsUniquePairs(400, 50);
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

  it("performs exactly 1 talker-id rebuild over 599 steady frames and 2 after one list change", async () => {
    const mod = await freshCollect();
    const opts = mod.resolveVizFrameCollectOpts(buildCollectEquivalenceState(0));
    for (let f = 0; f < 599; f++) {
      const state = buildCollectEquivalenceState(f);
      const frame = {
        contract: 2 as const,
        t: f,
        dt: 0.016,
        audio: 0,
        packets: [],
        rf: [],
        talkers: frameTalkersForCollectEquivalence(),
        headlines: [],
      };
      mod.applyVizFrameContractV2(frame, state, opts);
    }
    expect(mod.readTalkerIdSetRebuildCount()).toBe(1);
    const state = buildCollectEquivalenceState(599);
    const frame = {
      contract: 2 as const,
      t: 599,
      dt: 0.016,
      audio: 0,
      packets: [],
      rf: [],
      talkers: frameTalkersForCollectEquivalence().map((t, i) => (i === 0 ? { ...t, id: "10.0.0.99" } : t)),
      headlines: [],
    };
    mod.applyVizFrameContractV2(frame, state, opts);
    expect(mod.readTalkerIdSetRebuildCount()).toBe(2);
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
    const pairHigh = highRank.links.find((l) => l.src === "10.0.0.1" && l.dst === "10.0.0.2")!;
    expect(vizLinkRecordIdentity(pair.src, pair.dst)).toBe(vizLinkRecordIdentity(pairHigh.src, pairHigh.dst));
    expect(vizLinkRecordIdentity(pair.src, pair.dst)).toBe(vizLinkRecordIdentity("10.0.0.1", "10.0.0.2"));
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
    expect(mod.readVizLinkIndexEntryCount()).toBe(400);
    mod.collectVizLinks(f200, talkers, 8);
    expect(mod.readVizLinkLastNewPairSetCount()).toBe(0);
  });
});

describe("viz link index R4 reset on reuse", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.resetModules();
  });

  it("gives a freed slot a new generation and zero idle count when reused", async () => {
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
    const genA = mod.readLinkSlotGeneration("10.0.0.1", "10.0.0.2");
    for (let i = 0; i < VIZ_LINK_IDLE_DROP_FRAMES; i++) mod.collectVizLinks([], talkers, 8);
    mod.collectVizLinks(
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
    const genB = mod.readLinkSlotGeneration("10.0.0.1", "10.0.0.3");
    expect(genB).toBeGreaterThan(genA!);
    expect(mod.readLinkSlotIdleZeroFrames("10.0.0.1", "10.0.0.3")).toBe(0);
  });
});
