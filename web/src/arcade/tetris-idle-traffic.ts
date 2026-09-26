import type { Packet } from "../core/types";
import { tetrominoForProto } from "./stage-math";

/** Default idle feed when no `tetrisIdleSeed` is set. */
export const TETRIS_DEFAULT_IDLE_SEED = 42;

/** Fixed seed for QE: fills the well and reaches top-out hold without live capture. */
export const TETRIS_IDLE_TOPOUT_SEED = 9001;

const PROTOS = ["tcp", "udp", "tls", "dns", "http", "quic", "ssh", "icmp"] as const;

function mixU32(seed: number, tick: number): number {
  let h = (seed >>> 0) ^ Math.imul(tick >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return h >>> 0;
}

export function parseTetrisIdleSeedFromSearch(search: string): number {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const raw = (q.get("tetrisIdleSeed") ?? q.get("tetrisIdle") ?? "").trim().toLowerCase();
  if (raw === "topout" || raw === "top-out") return TETRIS_IDLE_TOPOUT_SEED;
  if (!raw) return TETRIS_DEFAULT_IDLE_SEED;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n) >>> 0;
  return TETRIS_DEFAULT_IDLE_SEED;
}

/** Deterministic synthetic packets for the Tetris well when `/api/traffic` is empty. */
export function tetrisIdlePackets(seed: number, tick: number, baseTime = 1_700_000_000): Packet[] {
  const burst = seed === TETRIS_IDLE_TOPOUT_SEED ? 12 : 2;
  const out: Packet[] = [];
  for (let i = 0; i < burst; i++) {
    const h = mixU32(seed, tick * 17 + i);
    const proto = PROTOS[h % PROTOS.length]!;
    const peer = `10.0.${(h >>> 8) & 0xff}.${(h >>> 16) & 0xff}`;
    const t = baseTime + tick * 0.05 + i * 0.001;
    out.push([t, "in", peer, proto, "443", 64 + (h % 900), "eth0", "idle", `${peer}:443`]);
  }
  return out;
}

export function tetrominoKindForIdlePacket(p: Packet): string {
  return tetrominoForProto((p[3] || "tcp").toLowerCase());
}
