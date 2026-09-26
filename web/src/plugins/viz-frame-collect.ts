import type { Device, Flow, StateMsg } from "../core/types";
import type { VizDataFrame, VizLinkSample, VizTalkerSample } from "./viz-host";
import { topKByScore, VIZ_CONTRACT_VERSION } from "./viz-host";
import { EMPTY_VIZ_LINKS } from "../../../plugins/sdk/viz-contract";

export const VIZ_DEFAULT_MAX_LINKS = 64;

/** Resolved from monitor `host.vizFrame` in {@link StateMsg} (sys-config.yml). */
export interface VizFrameCollectOpts {
  linksEnabled: boolean;
  maxLinks: number;
}

export function resolveVizFrameCollectOpts(state: StateMsg): VizFrameCollectOpts {
  const host = state.host?.vizFrame;
  return {
    linksEnabled: host?.links !== false,
    maxLinks: clampLinksMax(host?.linksMax),
  };
}

function clampLinksMax(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return VIZ_DEFAULT_MAX_LINKS;
  return Math.min(256, Math.max(1, Math.trunc(n)));
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * Per-host failure ratio for the capture window: blamed TCP failures divided by
 * that host's connection attempts (SYN as initiator or target), clamped 0..1.
 */
export function connFailRatio(failEvents: number, attempts: number): number {
  if (failEvents <= 0 || attempts <= 0) return 0;
  return clamp01(failEvents / attempts);
}

function directionalPacketRate(flow: Flow, ab: boolean): number {
  const direct = ab ? flow.rate_pkt_ab : flow.rate_pkt_ba;
  if (typeof direct === "number" && direct > 0) return direct;
  const byteRate = ab ? flow.rate_ab : flow.rate_ba;
  if (typeof byteRate !== "number" || byteRate <= 0) return 0;
  const avgBytes = flow.bytes / Math.max(1, flow.packets);
  return byteRate / Math.max(1, avgBytes);
}

const talkerIdsScratch = new Set<string>();
const talkerIdsCached: string[] = [];
let talkerIdsSetRebuilds = 0;

const failGaugeScratch = new Map<string, number>();

function syncTalkerIds(talkers: readonly VizTalkerSample[]): ReadonlySet<string> {
  let same = talkers.length === talkerIdsCached.length;
  if (same) {
    for (let i = 0; i < talkers.length; i++) {
      if (talkerIdsCached[i] !== talkers[i]!.id) {
        same = false;
        break;
      }
    }
  }
  if (!same) {
    talkerIdsCached.length = talkers.length;
    for (let i = 0; i < talkers.length; i++) talkerIdsCached[i] = talkers[i]!.id;
    talkerIdsScratch.clear();
    for (let i = 0; i < talkerIdsCached.length; i++) talkerIdsScratch.add(talkerIdsCached[i]!);
    talkerIdsSetRebuilds++;
  }
  return talkerIdsScratch;
}

function talkersWithConnFailed(
  frameTalkers: VizTalkerSample[],
  devices: readonly Device[],
): VizTalkerSample[] {
  failGaugeScratch.clear();
  let any = false;
  for (const d of devices) {
    if (typeof d.conn_fail === "number" && d.conn_fail > 0) {
      any = true;
      failGaugeScratch.set(d.ip, clamp01(d.conn_fail));
    }
  }
  if (!any) return frameTalkers;
  for (let i = 0; i < frameTalkers.length; i++) {
    const t = frameTalkers[i]!;
    const live = failGaugeScratch.get(t.id);
    if (live !== undefined) t.failed = live;
    else delete t.failed;
  }
  return frameTalkers;
}

type LinkCandidate = { src: string; dst: string; rate: number };

const linkPool: LinkCandidate[] = [];
const linkBySrcDst = new Map<string, Map<string, number>>();
let linkPoolHighWater = 0;

const linkActiveScratch: number[] = [];
const linksResultScratch: VizLinkSample[] = [];

function linkSlotForPair(src: string, dst: string): LinkCandidate {
  let byDst = linkBySrcDst.get(src);
  if (!byDst) {
    byDst = new Map();
    linkBySrcDst.set(src, byDst);
  }
  let idx = byDst.get(dst);
  if (idx === undefined) {
    idx = linkPoolHighWater;
    linkPoolHighWater++;
    let slot = linkPool[idx];
    if (!slot) {
      slot = { src, dst, rate: 0 };
      linkPool[idx] = slot;
    } else {
      slot.src = src;
      slot.dst = dst;
      slot.rate = 0;
    }
    byDst.set(dst, idx);
  }
  return linkPool[idx]!;
}

function zeroLinkRatesForFrame(): void {
  for (const byDst of linkBySrcDst.values()) {
    for (const idx of byDst.values()) linkPool[idx]!.rate = 0;
  }
}

/**
 * Aggregate directional host-pair rates for the monitor smoothing window (~5 s).
 * `src`/`dst` match talker ids; `rate` is sent packets/s (same basis as `talkers[].rate`).
 */
export function collectVizLinks(
  flows: Flow[],
  talkerIds: ReadonlySet<string>,
  maxLinks: number,
): { links: VizLinkSample[]; linksDropped: number } {
  zeroLinkRatesForFrame();
  for (let fi = 0; fi < flows.length; fi++) {
    const fl = flows[fi]!;
    const aIn = talkerIds.has(fl.a);
    const bIn = talkerIds.has(fl.b);
    if (!aIn || !bIn || fl.a === fl.b) continue;
    const ab = directionalPacketRate(fl, true);
    if (ab > 0) linkSlotForPair(fl.a, fl.b).rate += ab;
    const ba = directionalPacketRate(fl, false);
    if (ba > 0) linkSlotForPair(fl.b, fl.a).rate += ba;
  }

  linkActiveScratch.length = 0;
  for (const byDst of linkBySrcDst.values()) {
    for (const idx of byDst.values()) {
      if (linkPool[idx]!.rate > 0) linkActiveScratch.push(idx);
    }
  }

  const total = linkActiveScratch.length;
  const topIdx = topKByScore(linkActiveScratch, maxLinks, (idx) => linkPool[idx]!.rate);
  linksResultScratch.length = topIdx.length;
  for (let i = 0; i < topIdx.length; i++) {
    const slot = linkPool[topIdx[i]!]!;
    const out = linksResultScratch[i] ?? { src: "", dst: "", rate: 0 };
    out.src = slot.src;
    out.dst = slot.dst;
    out.rate = slot.rate;
    linksResultScratch[i] = out;
  }
  const linksOut = topIdx.length === 0 ? EMPTY_VIZ_LINKS : linksResultScratch;
  return { links: linksOut as VizLinkSample[], linksDropped: Math.max(0, total - topIdx.length) };
}

/** Stamp contract v2 and optional link / failed enrichment when collection is enabled. */
export function applyVizFrameContractV2(
  frame: VizDataFrame,
  state: StateMsg,
  opts: VizFrameCollectOpts,
): VizDataFrame {
  frame.contract = VIZ_CONTRACT_VERSION;
  if (!opts.linksEnabled) {
    delete frame.links;
    delete frame.linksDropped;
    for (const t of frame.talkers) delete t.failed;
    return frame;
  }
  const talkerIds = syncTalkerIds(frame.talkers);
  const { links, linksDropped } = collectVizLinks(state.flows, talkerIds, opts.maxLinks);
  talkersWithConnFailed(frame.talkers, state.devices);
  frame.links = links;
  if (linksDropped > 0) frame.linksDropped = linksDropped;
  else delete frame.linksDropped;
  return frame;
}

/** Assert every link endpoint is a current talker id (shared by tests). */
export function assertLinksMatchTalkers(frame: VizDataFrame): void {
  const ids = new Set(frame.talkers.map((t) => t.id));
  for (const link of frame.links ?? []) {
    if (!ids.has(link.src) || !ids.has(link.dst)) {
      throw new Error(`link ${link.src}->${link.dst} references ids outside talkers[]`);
    }
  }
}

/** Test-only introspection for allocation / pool rows (not used in production). */
export const vizFrameCollectTestHooks = {
  linkPoolSlot0(): LinkCandidate | undefined {
    return linkPool[0];
  },
  talkerIdSet(): ReadonlySet<string> {
    return talkerIdsScratch;
  },
  talkerIdSetRebuilds(): number {
    return talkerIdsSetRebuilds;
  },
  resetTalkerIdSetRebuilds(): void {
    talkerIdsSetRebuilds = 0;
  },
  linkPoolHighWater(): number {
    return linkPoolHighWater;
  },
  clearLinkIndexForTest(): void {
    linkBySrcDst.clear();
    linkPool.length = 0;
    linkPoolHighWater = 0;
  },
  clearTalkerIdsCacheForTest(): void {
    talkerIdsCached.length = 0;
    talkerIdsScratch.clear();
    talkerIdsSetRebuilds = 0;
  },
};
