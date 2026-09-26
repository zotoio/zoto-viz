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
let talkerIdsCacheKey = "";
const failGaugeScratch = new Map<string, number>();
const talkersFailedScratch: VizTalkerSample[] = [];
for (let i = 0; i < 32; i++) talkersFailedScratch.push({ id: "", rate: 0, role: "" });

function syncTalkerIds(talkers: readonly VizTalkerSample[]): ReadonlySet<string> {
  let key = `${talkers.length}\0`;
  for (let i = 0; i < talkers.length; i++) key += `${talkers[i]!.id}\0`;
  if (key !== talkerIdsCacheKey) {
    talkerIdsScratch.clear();
    for (const t of talkers) talkerIdsScratch.add(t.id);
    talkerIdsCacheKey = key;
  }
  return talkerIdsScratch;
}

function talkersWithConnFailed(
  frameTalkers: readonly VizTalkerSample[],
  devices: readonly Device[],
): readonly VizTalkerSample[] {
  failGaugeScratch.clear();
  let any = false;
  for (const d of devices) {
    if (typeof d.conn_fail === "number" && d.conn_fail > 0) {
      any = true;
      failGaugeScratch.set(d.ip, clamp01(d.conn_fail));
    }
  }
  if (!any) return frameTalkers;
  const n = frameTalkers.length;
  talkersFailedScratch.length = n;
  for (let i = 0; i < n; i++) {
    const t = frameTalkers[i]!;
    let slot = talkersFailedScratch[i];
    if (!slot) {
      slot = { id: "", rate: 0, role: "" };
      talkersFailedScratch[i] = slot;
    }
    slot.id = t.id;
    slot.rate = t.rate;
    slot.role = t.role;
    const live = failGaugeScratch.get(t.id);
    if (live !== undefined) slot.failed = live;
    else delete slot.failed;
  }
  return talkersFailedScratch;
}

type LinkCandidate = { src: string; dst: string; rate: number };

const linkAggScratch = new Map<string, LinkCandidate>();
const linkCandidatePool: LinkCandidate[] = [];
for (let i = 0; i < 128; i++) linkCandidatePool.push({ src: "", dst: "", rate: 0 });
let linkCandidatePoolUsed = 0;

function linkPairKey(src: string, dst: string): string {
  return `${src}\0${dst}`;
}

function borrowLinkCandidate(src: string, dst: string, rate: number): LinkCandidate {
  const slot = linkCandidatePool[linkCandidatePoolUsed];
  if (slot) {
    slot.src = src;
    slot.dst = dst;
    slot.rate = rate;
  } else {
    linkCandidatePool.push({ src, dst, rate });
  }
  linkCandidatePoolUsed++;
  return linkCandidatePool[linkCandidatePoolUsed - 1]!;
}

function resetLinkCandidatePool(): void {
  linkCandidatePoolUsed = 0;
}

function scanLinkCandidates(flows: Flow[], talkerIds: ReadonlySet<string>): void {
  resetLinkCandidatePool();
  for (const fl of flows) {
    const aIn = talkerIds.has(fl.a);
    const bIn = talkerIds.has(fl.b);
    if (!aIn || !bIn) continue;
    const ab = directionalPacketRate(fl, true);
    if (ab > 0 && fl.a !== fl.b) borrowLinkCandidate(fl.a, fl.b, ab);
    const ba = directionalPacketRate(fl, false);
    if (ba > 0 && fl.a !== fl.b) borrowLinkCandidate(fl.b, fl.a, ba);
  }
}

const linksResultScratch: VizLinkSample[] = [];

/**
 * Aggregate directional host-pair rates for the monitor smoothing window (~5 s).
 * `src`/`dst` match talker ids; `rate` is sent packets/s (same basis as `talkers[].rate`).
 */
export function collectVizLinks(
  flows: Flow[],
  talkerIds: ReadonlySet<string>,
  maxLinks: number,
): { links: VizLinkSample[]; linksDropped: number } {
  linkAggScratch.clear();
  scanLinkCandidates(flows, talkerIds);
  for (let i = 0; i < linkCandidatePoolUsed; i++) {
    const cand = linkCandidatePool[i]!;
    const key = linkPairKey(cand.src, cand.dst);
    const prev = linkAggScratch.get(key);
    if (prev) prev.rate += cand.rate;
    else linkAggScratch.set(key, cand);
  }
  const total = linkAggScratch.size;
  const top = topKByScore(linkAggScratch.values(), maxLinks, (l) => l.rate);
  linksResultScratch.length = top.length;
  for (let i = 0; i < top.length; i++) {
    const l = top[i]!;
    const slot = linksResultScratch[i] ?? { src: "", dst: "", rate: 0 };
    slot.src = l.src;
    slot.dst = l.dst;
    slot.rate = l.rate;
    linksResultScratch[i] = slot;
  }
  const linksOut = top.length === 0 ? EMPTY_VIZ_LINKS : linksResultScratch;
  return { links: linksOut as VizLinkSample[], linksDropped: Math.max(0, total - top.length) };
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
  frame.talkers = talkersWithConnFailed(frame.talkers, state.devices) as VizTalkerSample[];
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
