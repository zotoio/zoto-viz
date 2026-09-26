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
  let any = false;
  for (const d of devices) {
    if (typeof d.conn_fail === "number" && d.conn_fail > 0) {
      any = true;
      failGaugeScratch.set(d.ip, clamp01(d.conn_fail));
    }
  }
  if (!any) return [...frameTalkers];
  const out: VizTalkerSample[] = [];
  for (const t of frameTalkers) {
    const live = failGaugeScratch.get(t.id);
    if (live !== undefined) out.push({ ...t, failed: live });
    else out.push({ ...t });
  }
  return out;
}

type LinkCandidate = { src: string; dst: string; rate: number };

function* linkCandidates(flows: Flow[], talkerIds: ReadonlySet<string>): Generator<LinkCandidate> {
  for (const fl of flows) {
    const aIn = talkerIds.has(fl.a);
    const bIn = talkerIds.has(fl.b);
    if (!aIn || !bIn) continue;
    const ab = directionalPacketRate(fl, true);
    if (ab > 0) yield { src: fl.a, dst: fl.b, rate: ab };
    const ba = directionalPacketRate(fl, false);
    if (ba > 0) yield { src: fl.b, dst: fl.a, rate: ba };
  }
}

/**
 * Aggregate directional host-pair rates for the monitor smoothing window (~5 s).
 * `src`/`dst` match talker ids; `rate` is packets/s (same basis as `talkers[].rate`).
 */
export function collectVizLinks(
  flows: Flow[],
  talkerIds: ReadonlySet<string>,
  maxLinks: number,
): { links: VizLinkSample[]; linksDropped: number } {
  let total = 0;
  const top = topKByScore(
    (function* () {
      for (const cand of linkCandidates(flows, talkerIds)) {
        total += 1;
        yield cand;
      }
    })(),
    maxLinks,
    (l) => l.rate,
  );
  const links = top.map((l) => ({ src: l.src, dst: l.dst, rate: l.rate }));
  return { links, linksDropped: Math.max(0, total - links.length) };
}

/** Stamp contract v2 and optional link / failed enrichment when collection is enabled. */
export function applyVizFrameContractV2(
  frame: VizDataFrame,
  state: StateMsg,
  opts: VizFrameCollectOpts,
): VizDataFrame {
  const out: VizDataFrame = { ...frame, contract: VIZ_CONTRACT_VERSION };
  if (!opts.linksEnabled) return out;
  const talkerIds = syncTalkerIds(out.talkers);
  const { links, linksDropped } = collectVizLinks(state.flows, talkerIds, opts.maxLinks);
  out.talkers = talkersWithConnFailed(out.talkers, state.devices);
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
