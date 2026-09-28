import type { MonoMs } from "../core/viz-time";
import { buildIdleVizFrame } from "../plugins/fixtures/idle-viz-frame";
import type {
  VizDataFrame,
  VizHeadline,
  VizPacketSample,
  VizRfBeacon,
  VizTalkerSample,
} from "../plugins/viz-host";
import type { DemoSnapshotPayload } from "./remix-types";

function asHeadlines(raw: unknown): VizHeadline[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VizHeadline[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const h = row as Record<string, unknown>;
    const id = String(h.id ?? "").trim();
    const text = String(h.text ?? "").trim();
    if (!id || !text) continue;
    out.push({
      id,
      label: String(h.label ?? "Demo"),
      text,
      kind: String(h.kind ?? "demo"),
      summary: h.summary ? String(h.summary) : undefined,
    });
  }
  return out.length ? out : undefined;
}

function asTalkers(raw: unknown): VizTalkerSample[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VizTalkerSample[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const t = row as Record<string, unknown>;
    const id = String(t.id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      rate: Number(t.rate) || 0,
      role: String(t.role ?? "internet"),
      failed: typeof t.failed === "number" ? t.failed : undefined,
    });
  }
  return out.length ? out : undefined;
}

function asPackets(raw: unknown): VizPacketSample[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VizPacketSample[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const p = row as Record<string, unknown>;
    out.push({
      proto: String(p.proto ?? "TCP"),
      size: Number(p.size) || 0,
      field: Number(p.field) || 0,
    });
  }
  return out.length ? out : undefined;
}

function asRf(raw: unknown): VizRfBeacon[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VizRfBeacon[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    out.push({
      ssid: String(r.ssid ?? "demo"),
      rssi: Number(r.rssi) || 0,
      channel: Number(r.channel) || 0,
    });
  }
  return out.length ? out : undefined;
}

/** Merge a bundled demo snapshot into the host viz frame used for pack delivery. */
export function mergeDemoSnapshotIntoFrame(
  payload: DemoSnapshotPayload,
  prevClockMs: MonoMs,
  audio: number,
  packContract = 2,
): VizDataFrame {
  const base = buildIdleVizFrame(prevClockMs / 1000, 1 / 60);
  const slice = payload.vizFrame ?? {};
  const headlines = asHeadlines(slice.headlines) ?? base.headlines;
  const talkers = asTalkers(slice.talkers) ?? base.talkers;
  const packets = asPackets(slice.packets) ?? base.packets;
  const rf = asRf(slice.rf) ?? base.rf;
  const demoSlices: NonNullable<VizDataFrame["demoSlices"]> = {};
  if (asPackets(slice.packets)) demoSlices.packets = true;
  if (asRf(slice.rf)) demoSlices.rf = true;
  if (asTalkers(slice.talkers)) demoSlices.talkers = true;
  if (asHeadlines(slice.headlines)) demoSlices.headlines = true;
  return {
    ...base,
    contract: packContract,
    t: prevClockMs / 1000,
    audio: typeof slice.audio === "number" ? Number(slice.audio) : audio,
    headlines,
    talkers,
    packets,
    rf,
    demo: true,
    demoSlices,
  };
}
