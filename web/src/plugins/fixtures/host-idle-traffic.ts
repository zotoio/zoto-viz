import type { Packet } from "../../core/types";
import { goldenLanFixture } from "./golden-lan-state";

/** Same host idle declaration as `visualisation.yml` → `idle: fixture: host`. */
export const HOST_IDLE_FIXTURE = { fixture: "host" as const };

/** Header pkt/s on the golden host idle LAN (`goldenLanFixture().stats.pps`). */
export function hostIdleFixturePps(): number {
  return goldenLanFixture().stats.pps;
}

/** Cumulative host-idle packets due by `clockMs` on the fixture schedule (420 pkt/s). */
export function hostIdlePacketsDueByMs(clockMs: number): number {
  const pps = hostIdleFixturePps();
  return Math.floor((clockMs / 1000) * pps);
}

function mixU32(seed: number, seq: number): number {
  let h = (seed >>> 0) ^ Math.imul(seq >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return h >>> 0;
}

/** One deterministic packet from the golden LAN flows (same demo source as the header fixture). */
export function hostIdleFixturePacket(seq: number, seed: number): Packet {
  const golden = goldenLanFixture();
  const flows = golden.flows;
  const f = flows[seq % flows.length]!;
  const h = mixU32(seed, seq);
  const proto = f.protos[0] ?? "tcp";
  const peer = (seq + (h & 1)) % 2 === 0 ? f.a : f.b;
  const pps = hostIdleFixturePps();
  const t = 1_700_000_000 + (seq / pps);
  return [t, "in", peer, proto, "443", 64 + (h % 900), "eth0", "golden", `${peer}:443`];
}

export function hostIdleFixturePackets(seqStart: number, count: number, seed: number): Packet[] {
  const out: Packet[] = [];
  for (let i = 0; i < count; i++) out.push(hostIdleFixturePacket(seqStart + i, seed));
  return out;
}

/** Default idle seed when no `tetrisIdleSeed` is set. */
export const TETRIS_DEFAULT_IDLE_SEED = 42;

/** Fixed seed for QE: fills the well and reaches top-out hold without live capture. */
export const TETRIS_IDLE_TOPOUT_SEED = 9001;

export function parseTetrisIdleSeedFromSearch(search: string): number {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = (q.get("tetrisIdleSeed") ?? q.get("tetrisIdle") ?? "").trim().toLowerCase();
  if (raw === "topout" || raw === "top-out") return TETRIS_IDLE_TOPOUT_SEED;
  if (!raw) return TETRIS_DEFAULT_IDLE_SEED;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n) >>> 0;
  return TETRIS_DEFAULT_IDLE_SEED;
}
