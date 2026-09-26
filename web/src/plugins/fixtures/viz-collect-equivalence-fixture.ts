import type { Device, Flow, StateMsg } from "../../core/types";
import type { VizDataFrame, VizTalkerSample } from "../viz-host";
import { applyVizFrameContractV2, resolveVizFrameCollectOpts } from "../viz-frame-collect";

export const COLLECT_EQUIVALENCE_MAX_LINKS = 8;
export const COLLECT_EQUIVALENCE_TALKER_COUNT = 16;
export const COLLECT_EQUIVALENCE_FLOW_COUNT = 200;
export const COLLECT_EQUIVALENCE_FRAMES = 600;

const TALKER_IDS = Array.from(
  { length: COLLECT_EQUIVALENCE_TALKER_COUNT },
  (_, i) => `10.0.0.${i + 1}`,
);

export type CollectEquivalenceFrame = {
  links: { src: string; dst: string; rate: number }[];
  linksDropped: number;
  talkers: { id: string; failed?: number }[];
};

function device(ip: string, connFail = 0): Device {
  return {
    ip,
    mac: "",
    vendor: "",
    hostnames: [],
    names: [],
    sources: [],
    ports: [],
    ifaces: [],
    aliases: [],
    first_seen: 0,
    last_seen: 0,
    role: "lan",
    online: true,
    packets: 1000,
    bytes_in: 1,
    bytes_out: 1,
    conn_fail: connFail,
  };
}

/** Fixed 200-flow / 16-talker LAN slice; rates shift per frame index with a tie at the K=8 boundary. */
export function buildCollectEquivalenceState(frameIndex: number): StateMsg {
  const devices = TALKER_IDS.map((ip, i) => device(ip, i === 0 && frameIndex % 97 === 0 ? 0.25 : 0));
  const flows: Flow[] = [];
  for (let i = 0; i < COLLECT_EQUIVALENCE_FLOW_COUNT; i++) {
    const a = TALKER_IDS[i % COLLECT_EQUIVALENCE_TALKER_COUNT]!;
    const b = TALKER_IDS[(i * 7 + 3) % COLLECT_EQUIVALENCE_TALKER_COUNT]!;
    if (a === b) continue;
    const base = ((i * 13 + frameIndex) % 50) + 1;
    let rate = base + frameIndex * 0.001;
    if (i === 40 || i === 41) rate = 88.5 + frameIndex * 0.001;
    flows.push({
      a,
      b,
      bytes: 100,
      packets: 10,
      ports: [],
      protos: ["tcp"],
      ifaces: [],
      first_seen: 0,
      last_seen: 1,
      rate: 1,
      rate_pkt_ab: rate,
      rate_pkt_ba: 0,
    });
  }
  return {
    ts: frameIndex,
    devices,
    flows,
    sources: {},
    host: { vizFrame: { links: true, linksMax: COLLECT_EQUIVALENCE_MAX_LINKS } },
  };
}

export function frameTalkersForCollectEquivalence(): VizTalkerSample[] {
  return TALKER_IDS.map((id, i) => ({ id, rate: 100 - i, role: "lan" }));
}

export function captureCollectEquivalenceFrame(state: StateMsg): CollectEquivalenceFrame {
  const talkers = frameTalkersForCollectEquivalence();
  const frame: VizDataFrame = {
    contract: 1,
    t: state.ts ?? 0,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers,
    headlines: [],
  };
  applyVizFrameContractV2(frame, state, resolveVizFrameCollectOpts(state));
  return {
    links: (frame.links ?? []).map((l) => ({ src: l.src, dst: l.dst, rate: l.rate })),
    linksDropped: frame.linksDropped ?? 0,
    talkers: frame.talkers.map((t) => (t.failed !== undefined ? { id: t.id, failed: t.failed } : { id: t.id })),
  };
}

export function buildCollectEquivalenceFixture(): CollectEquivalenceFrame[] {
  const out: CollectEquivalenceFrame[] = [];
  for (let f = 0; f < COLLECT_EQUIVALENCE_FRAMES; f++) {
    out.push(captureCollectEquivalenceFrame(buildCollectEquivalenceState(f)));
  }
  return out;
}
