import type { VizDataFrame, VizHeadline, VizPacketSample, VizRfBeacon, VizTalkerSample } from "./viz-host";
import {
  EMPTY_SYS_TELEMETRY,
  VIZ_MAX_HEADLINE_SAMPLES,
  VIZ_MAX_PACKET_SAMPLES,
  VIZ_MAX_RF_SAMPLES,
  VIZ_MAX_TALKER_SAMPLES,
} from "./viz-host";

/** Per-pack slice caps when copying from the shared v2→v1 conversion (visualisation workBudget). */
export interface VizV1WorkBudget {
  maxTalkers: number;
  maxPackets: number;
  maxRf: number;
  maxHeadlines: number;
}

export function defaultV1WorkBudget(overrides?: Partial<VizV1WorkBudget>): VizV1WorkBudget {
  return {
    maxTalkers: VIZ_MAX_TALKER_SAMPLES,
    maxPackets: VIZ_MAX_PACKET_SAMPLES,
    maxRf: VIZ_MAX_RF_SAMPLES,
    maxHeadlines: VIZ_MAX_HEADLINE_SAMPLES,
    ...overrides,
  };
}

type V1PackSlot = {
  budget: VizV1WorkBudget;
  frame: VizDataFrame;
  /** Stable talker object identity per index; never exposed except via talkersBuf rebuild. */
  talkerPool: VizTalkerSample[];
  talkersBuf: VizTalkerSample[];
  packetsBuf: VizPacketSample[];
  rfBuf: VizRfBeacon[];
  headlinesBuf: VizHeadline[];
  sysBuf: NonNullable<VizDataFrame["sys"]>;
};

function preallocateTalkers(n: number): VizTalkerSample[] {
  const out: VizTalkerSample[] = [];
  for (let i = 0; i < n; i++) out.push({ id: "", rate: 0, role: "" });
  return out;
}

function preallocatePackets(n: number): VizPacketSample[] {
  const out: VizPacketSample[] = [];
  for (let i = 0; i < n; i++) out.push({ proto: "", size: 0, field: 0 });
  return out;
}

function preallocateRf(n: number): VizRfBeacon[] {
  const out: VizRfBeacon[] = [];
  for (let i = 0; i < n; i++) out.push({ ssid: "", rssi: 0, channel: 0 });
  return out;
}

function preallocateHeadlines(n: number): VizHeadline[] {
  const out: VizHeadline[] = [];
  for (let i = 0; i < n; i++) out.push({ id: "", label: "", text: "" });
  return out;
}

function allocV1PackFrame(budget: VizV1WorkBudget): V1PackSlot {
  const talkerPool = preallocateTalkers(budget.maxTalkers);
  const talkersBuf = talkerPool.slice();
  const packetsBuf = preallocatePackets(budget.maxPackets);
  const rfBuf = preallocateRf(budget.maxRf);
  const headlinesBuf = preallocateHeadlines(budget.maxHeadlines);
  const sysBuf = { ...EMPTY_SYS_TELEMETRY };
  const frame: VizDataFrame = {
    contract: 1,
    t: 0,
    dt: 0,
    audio: 0,
    packets: packetsBuf,
    rf: rfBuf,
    talkers: talkersBuf,
    headlines: headlinesBuf,
    sys: sysBuf,
  };
  return { budget, frame, talkerPool, talkersBuf, packetsBuf, rfBuf, headlinesBuf, sysBuf };
}

/** Convert one v2 host frame into a reusable v1-shaped work frame (no allocation). */
export function convertVizFrameV2ToV1(
  src: VizDataFrame,
  dest: VizDataFrame,
  talkersWork: VizTalkerSample[],
  maxTalkers: number,
): void {
  dest.contract = 1;
  dest.t = src.t;
  dest.dt = src.dt;
  dest.audio = src.audio;
  if (src.demo !== undefined) dest.demo = src.demo;
  else delete dest.demo;
  if (src.demoSlices) {
    if (!dest.demoSlices) dest.demoSlices = {};
    const ds = dest.demoSlices;
    ds.packets = src.demoSlices.packets;
    ds.rf = src.demoSlices.rf;
    ds.talkers = src.demoSlices.talkers;
    ds.headlines = src.demoSlices.headlines;
  } else delete dest.demoSlices;
  delete dest.links;
  delete dest.linksDropped;
  delete dest.spectrum;

  if (src.sys) {
    if (!dest.sys) dest.sys = { ...EMPTY_SYS_TELEMETRY };
    Object.assign(dest.sys, src.sys);
  } else if (dest.sys) {
    Object.assign(dest.sys, EMPTY_SYS_TELEMETRY);
  }

  const pn = Math.min(src.packets.length, dest.packets.length);
  dest.packets.length = pn;
  for (let i = 0; i < pn; i++) {
    const d = dest.packets[i]!;
    const s = src.packets[i]!;
    d.proto = s.proto;
    d.size = s.size;
    d.field = s.field;
  }

  const rn = Math.min(src.rf.length, dest.rf.length);
  dest.rf.length = rn;
  for (let i = 0; i < rn; i++) {
    const d = dest.rf[i]!;
    const s = src.rf[i]!;
    d.ssid = s.ssid;
    d.rssi = s.rssi;
    d.channel = s.channel;
  }

  const hn = Math.min(src.headlines.length, dest.headlines.length);
  dest.headlines.length = hn;
  for (let i = 0; i < hn; i++) {
    const d = dest.headlines[i]!;
    const s = src.headlines[i]!;
    d.id = s.id;
    d.label = s.label;
    d.text = s.text;
    if (s.kind !== undefined) d.kind = s.kind;
    else delete d.kind;
    if (s.summary !== undefined) d.summary = s.summary;
    else delete d.summary;
    if (s.image !== undefined) d.image = s.image;
    else delete d.image;
  }

  const tn = Math.min(src.talkers.length, maxTalkers, talkersWork.length);
  dest.talkers = talkersWork;
  talkersWork.length = tn;
  for (let i = 0; i < tn; i++) {
    const d = talkersWork[i]!;
    const s = src.talkers[i]!;
    d.id = s.id;
    d.rate = s.rate;
    d.role = s.role;
    delete d.failed;
  }
}

function rebindTalkersFromPool(slot: V1PackSlot): void {
  const { budget, frame, talkerPool, talkersBuf } = slot;
  talkersBuf.length = 0;
  for (let i = 0; i < budget.maxTalkers; i++) talkersBuf.push(talkerPool[i]!);
  frame.talkers = talkersBuf;
}

function copyWorkIntoPack(work: VizDataFrame, slot: V1PackSlot): void {
  const { budget, frame, talkersBuf, packetsBuf, rfBuf, headlinesBuf, sysBuf } = slot;
  rebindTalkersFromPool(slot);
  frame.contract = 1;
  frame.t = work.t;
  frame.dt = work.dt;
  frame.audio = work.audio;
  if (work.demo !== undefined) frame.demo = work.demo;
  else delete frame.demo;
  if (work.demoSlices) {
    if (!frame.demoSlices) frame.demoSlices = {};
    const ds = frame.demoSlices;
    ds.packets = work.demoSlices.packets;
    ds.rf = work.demoSlices.rf;
    ds.talkers = work.demoSlices.talkers;
    ds.headlines = work.demoSlices.headlines;
  } else delete frame.demoSlices;
  delete frame.links;
  delete frame.linksDropped;
  delete frame.spectrum;

  if (work.sys) Object.assign(sysBuf, work.sys);
  else Object.assign(sysBuf, EMPTY_SYS_TELEMETRY);
  frame.sys = sysBuf;

  const pn = Math.min(work.packets.length, budget.maxPackets);
  frame.packets = packetsBuf;
  packetsBuf.length = pn;
  for (let i = 0; i < pn; i++) {
    const d = packetsBuf[i]!;
    const s = work.packets[i]!;
    d.proto = s.proto;
    d.size = s.size;
    d.field = s.field;
  }

  const rn = Math.min(work.rf.length, budget.maxRf);
  frame.rf = rfBuf;
  rfBuf.length = rn;
  for (let i = 0; i < rn; i++) {
    const d = rfBuf[i]!;
    const s = work.rf[i]!;
    d.ssid = s.ssid;
    d.rssi = s.rssi;
    d.channel = s.channel;
  }

  const hn = Math.min(work.headlines.length, budget.maxHeadlines);
  frame.headlines = headlinesBuf;
  headlinesBuf.length = hn;
  for (let i = 0; i < hn; i++) {
    const d = headlinesBuf[i]!;
    const s = work.headlines[i]!;
    d.id = s.id;
    d.label = s.label;
    d.text = s.text;
    if (s.kind !== undefined) d.kind = s.kind;
    else delete d.kind;
    if (s.summary !== undefined) d.summary = s.summary;
    else delete d.summary;
    if (s.image !== undefined) d.image = s.image;
    else delete d.image;
  }

  const tn = Math.min(work.talkers.length, budget.maxTalkers);
  talkersBuf.length = tn;
  for (let i = 0; i < tn; i++) {
    const d = talkersBuf[i]!;
    const s = work.talkers[i]!;
    d.id = s.id;
    d.rate = s.rate;
    d.role = s.role;
    delete d.failed;
  }
}

/**
 * Delivers v1-shaped frames to registered v1 packs from one v2 host frame per tick.
 * Each pack owns preallocated slice buffers; talkers are rebound every frame.
 */
export class VizV1FrameAdapter {
  private readonly packs = new Map<string, V1PackSlot>();
  private work: V1PackSlot | null = null;
  private workTalkers: VizTalkerSample[] = preallocateTalkers(VIZ_MAX_TALKER_SAMPLES);
  private maxTalkersRegistered = 0;
  /** View option snapshot from scope sync; stable between delivers until replaced. */
  private viewOpts: Readonly<Record<string, string>> | null = null;

  /** Called from host scope sync when mode/plugin options change (not per frame). */
  syncViewOpts(opts: Readonly<Record<string, string>>): void {
    this.viewOpts = { ...opts };
  }

  hasV1Packs(): boolean {
    return this.packs.size > 0;
  }

  /** Preallocate a v1 delivery frame at load time. Returns the stable frame reference for tests. */
  register(packId: string, budget: VizV1WorkBudget = defaultV1WorkBudget()): VizDataFrame {
    const slot = allocV1PackFrame(budget);
    this.packs.set(packId, slot);
    this.maxTalkersRegistered = Math.max(this.maxTalkersRegistered, budget.maxTalkers);
    return slot.frame;
  }

  unregister(packId: string): void {
    this.packs.delete(packId);
    if (this.packs.size === 0) {
      this.work = null;
      this.maxTalkersRegistered = 0;
    } else {
      this.maxTalkersRegistered = Math.max(...[...this.packs.values()].map((p) => p.budget.maxTalkers));
    }
  }

  frameFor(packId: string): VizDataFrame | undefined {
    return this.packs.get(packId)?.frame;
  }

  deliver(v2: VizDataFrame): void {
    if (this.packs.size === 0) return;
    const maxTalkers = this.maxTalkersRegistered;
    if (!this.work) {
      this.work = allocV1PackFrame(defaultV1WorkBudget({ maxTalkers }));
    }
    const work = this.work;
    convertVizFrameV2ToV1(v2, work.frame, this.workTalkers, maxTalkers);
    for (const slot of this.packs.values()) copyWorkIntoPack(work.frame, slot);
  }
}

export const vizV1FrameAdapter = new VizV1FrameAdapter();
