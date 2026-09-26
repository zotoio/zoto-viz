import type { Device, Flow, StateMsg } from "../core/types";
import type { VizDataFrame, VizLinkSample, VizTalkerSample } from "./viz-host";
import { topKByScore, VIZ_CONTRACT_VERSION } from "./viz-host";

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
const talkersOutScratch: VizTalkerSample[] = [];

function syncTalkerIds(talkers: readonly VizTalkerSample[]): ReadonlySet<string> {
  const key = talkers.length <= 8
    ? talkers.map((t) => t.id).join("\0")
    : `${talkers.length}\0${[...talkers.map((t) => t.id)].sort().join("\0")}`;
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
): VizTalkerSample[] {
  failGaugeScratch.clear();
  for (const d of devices) {
    if (typeof d.conn_fail === "number" && d.conn_fail > 0) failGaugeScratch.set(d.ip, clamp01(d.conn_fail));
  }
  talkersOutScratch.length = 0;
  for (const t of frameTalkers) {
    const live = failGaugeScratch.get(t.id);
    if (live !== undefined) talkersOutScratch.push({ ...t, failed: live });
    else talkersOutScratch.push(t);
  }
  return talkersOutScratch;
}

/**
 * Aggregate directional host-pair rates for the monitor smoothing window (~5 s).
 * `src`/`dst` match talker ids; `rate` is packets/s (same basis as flow directional rates).
 */
export function collectVizLinks(
  flows: Flow[],
  talkerIds: ReadonlySet<string>,
  maxLinks: number,
): { links: VizLinkSample[]; linksDropped: number } {
  const pairs: VizLinkSample[] = [];
  for (const fl of flows) {
    const ab = directionalPacketRate(fl, true);
    if (ab > 0 && talkerIds.has(fl.a) && talkerIds.has(fl.b)) {
      pairs.push({ src: fl.a, dst: fl.b, rate: ab });
    }
    const ba = directionalPacketRate(fl, false);
    if (ba > 0 && talkerIds.has(fl.b) && talkerIds.has(fl.a)) {
      pairs.push({ src: fl.b, dst: fl.a, rate: ba });
    }
  }
  const total = pairs.length;
  const links = topKByScore(pairs, maxLinks, (l) => l.rate);
  return { links, linksDropped: Math.max(0, total - links.length) };
}

/** Apply optional v2 fields when link collection is enabled; otherwise leave a v1-shaped frame. */
export function applyVizFrameContractV2(
  frame: VizDataFrame,
  state: StateMsg,
  opts: VizFrameCollectOpts,
): VizDataFrame {
  if (!opts.linksEnabled) return frame;
  const talkerIds = syncTalkerIds(frame.talkers);
  const { links, linksDropped } = collectVizLinks(state.flows, talkerIds, opts.maxLinks);
  const talkers = talkersWithConnFailed(frame.talkers, state.devices);
  const out: VizDataFrame = {
    ...frame,
    contract: VIZ_CONTRACT_VERSION,
    talkers,
  };
  if (links.length > 0) out.links = links;
  if (linksDropped > 0) out.linksDropped = linksDropped;
  return out;
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
