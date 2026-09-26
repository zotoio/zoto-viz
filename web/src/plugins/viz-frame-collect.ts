import type { Device, Flow, StateMsg } from "../core/types";
import type { VizDataFrame, VizLinkSample, VizTalkerSample } from "./viz-host";
import { topKByScore, VIZ_CONTRACT_VERSION } from "./viz-host";
import { EMPTY_VIZ_LINKS } from "../../../plugins/sdk/viz-contract";

export const VIZ_DEFAULT_MAX_LINKS = 64;

/** Consecutive zero-rate frames before a pair is dropped from the link index (inclusive at this count). */
export const VIZ_LINK_IDLE_DROP_FRAMES = 3600;

/** Resolved from monitor `host.vizFrame` in {@link StateMsg} (sys-config.yml). */
export interface VizFrameCollectOpts {
  linksEnabled: boolean;
  maxLinks: number;
}

const collectOptsScratch: VizFrameCollectOpts = { linksEnabled: true, maxLinks: VIZ_DEFAULT_MAX_LINKS };

export function resolveVizFrameCollectOpts(state: StateMsg): VizFrameCollectOpts {
  return resolveVizFrameCollectOptsInto(state, collectOptsScratch);
}

export function resolveVizFrameCollectOptsInto(
  state: StateMsg,
  out: VizFrameCollectOpts,
): VizFrameCollectOpts {
  const host = state.host?.vizFrame;
  out.linksEnabled = host?.links !== false;
  out.maxLinks = clampLinksMax(host?.linksMax);
  return out;
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

function compareLinkPair(a: LinkCandidate, b: LinkCandidate): number {
  if (a.src !== b.src) return a.src < b.src ? -1 : 1;
  if (a.dst !== b.dst) return a.dst < b.dst ? -1 : 1;
  return 0;
}

function pruneLinksOutsideTalkers(talkerIds: ReadonlySet<string>): void {
  for (const [src, byDst] of linkBySrcDst) {
    for (const [dst, idx] of [...byDst.entries()]) {
      if (!talkerIds.has(src) || !talkerIds.has(dst)) dropLinkIndex(src, dst, idx);
    }
  }
}

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
    pruneLinksOutsideTalkers(talkerIdsScratch);
  }
  return talkerIdsScratch;
}

export function readTalkerIdSetRebuildCount(): number {
  return talkerIdsSetRebuilds;
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

type LinkSlotMeta = { idleZeroFrames: number; generation: number };

const linkPool: LinkCandidate[] = [];
const linkSlotMeta: LinkSlotMeta[] = [];
const linkBySrcDst = new Map<string, Map<string, number>>();
const linkFreeList: number[] = [];
let linkPoolHighWater = 0;
let linkGenerationSeq = 0;

const linkActiveScratch: number[] = [];
const linksResultScratch: VizLinkSample[] = [];
const collectResultScratch: { links: VizLinkSample[]; linksDropped: number } = {
  links: EMPTY_VIZ_LINKS as VizLinkSample[],
  linksDropped: 0,
};

let lastZeroPassVisitCount = 0;
let lastNewPairSetCount = 0;

export function readVizLinkZeroPassVisitCount(): number {
  return lastZeroPassVisitCount;
}

export function readVizLinkIndexEntryCount(): number {
  let n = 0;
  for (const byDst of linkBySrcDst.values()) n += byDst.size;
  return n;
}

export function readVizLinkPoolLength(): number {
  return linkPool.length;
}

export function readVizLinkLastNewPairSetCount(): number {
  return lastNewPairSetCount;
}

function resetSlotMeta(idx: number): void {
  let meta = linkSlotMeta[idx];
  if (!meta) {
    meta = { idleZeroFrames: 0, generation: 0 };
    linkSlotMeta[idx] = meta;
  }
  meta.idleZeroFrames = 0;
  meta.generation = ++linkGenerationSeq;
}

function dropLinkIndex(src: string, dst: string, idx: number): void {
  const byDst = linkBySrcDst.get(src);
  if (byDst) {
    byDst.delete(dst);
    if (byDst.size === 0) linkBySrcDst.delete(src);
  }
  linkFreeList.push(idx);
}

function linkSlotForPair(src: string, dst: string): LinkCandidate {
  let byDst = linkBySrcDst.get(src);
  if (!byDst) {
    byDst = new Map();
    linkBySrcDst.set(src, byDst);
  }
  let idx = byDst.get(dst);
  if (idx === undefined) {
    lastNewPairSetCount++;
    if (linkFreeList.length > 0) {
      idx = linkFreeList.pop()!;
      const slot = linkPool[idx]!;
      slot.src = src;
      slot.dst = dst;
      slot.rate = 0;
      resetSlotMeta(idx);
    } else {
      idx = linkPoolHighWater++;
      let slot = linkPool[idx];
      if (!slot) {
        slot = { src, dst, rate: 0 };
        linkPool[idx] = slot;
      } else {
        slot.src = src;
        slot.dst = dst;
        slot.rate = 0;
      }
      resetSlotMeta(idx);
    }
    byDst.set(dst, idx);
  }
  return linkPool[idx]!;
}

function zeroLinkRatesForFrame(): void {
  lastZeroPassVisitCount = 0;
  const toDrop: { src: string; dst: string; idx: number }[] = [];
  for (const [src, byDst] of linkBySrcDst) {
    for (const [dst, idx] of byDst) {
      lastZeroPassVisitCount++;
      const slot = linkPool[idx]!;
      slot.rate = 0;
      const meta = linkSlotMeta[idx]!;
      meta.idleZeroFrames++;
      if (meta.idleZeroFrames >= VIZ_LINK_IDLE_DROP_FRAMES) toDrop.push({ src, dst, idx });
    }
  }
  for (let i = 0; i < toDrop.length; i++) {
    const d = toDrop[i]!;
    dropLinkIndex(d.src, d.dst, d.idx);
  }
}

function noteActiveLinkSlots(): void {
  for (const byDst of linkBySrcDst.values()) {
    for (const idx of byDst.values()) {
      const slot = linkPool[idx]!;
      if (slot.rate > 0) linkSlotMeta[idx]!.idleZeroFrames = 0;
    }
  }
}

const linkTopScratch: number[] = [];

function topLinkIndices(active: number[], maxLinks: number): number[] {
  linkTopScratch.length = 0;
  const tieBreak = (ia: number, ib: number) => compareLinkPair(linkPool[ia]!, linkPool[ib]!);
  const picked = topKByScore(
    active,
    maxLinks,
    (idx) => linkPool[idx]!.rate,
    () => false,
    tieBreak,
  );
  linkTopScratch.push(...picked);
  return linkTopScratch;
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
  lastNewPairSetCount = 0;
  pruneLinksOutsideTalkers(talkerIds);
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
  noteActiveLinkSlots();

  linkActiveScratch.length = 0;
  for (const byDst of linkBySrcDst.values()) {
    for (const idx of byDst.values()) {
      if (linkPool[idx]!.rate > 0) linkActiveScratch.push(idx);
    }
  }

  const total = linkActiveScratch.length;
  const topIdx = topLinkIndices(linkActiveScratch, maxLinks);
  linksResultScratch.length = topIdx.length;
  for (let i = 0; i < topIdx.length; i++) {
    const slot = linkPool[topIdx[i]!]!;
    let out = linksResultScratch[i];
    if (!out) {
      out = { src: "", dst: "", rate: 0 };
      linksResultScratch[i] = out;
    }
    out.src = slot.src;
    out.dst = slot.dst;
    out.rate = slot.rate;
  }
  const linksOut = topIdx.length === 0 ? EMPTY_VIZ_LINKS : linksResultScratch;
  collectResultScratch.links = linksOut as VizLinkSample[];
  collectResultScratch.linksDropped = Math.max(0, total - topIdx.length);
  return collectResultScratch;
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

export function readLinkSlotGeneration(src: string, dst: string): number | undefined {
  const byDst = linkBySrcDst.get(src);
  const idx = byDst?.get(dst);
  if (idx === undefined) return undefined;
  return linkSlotMeta[idx]?.generation;
}

export function readLinkSlotIdleZeroFrames(src: string, dst: string): number | undefined {
  const byDst = linkBySrcDst.get(src);
  const idx = byDst?.get(dst);
  if (idx === undefined) return undefined;
  return linkSlotMeta[idx]?.idleZeroFrames;
}
