/** Pack SYS + NET telemetry into viz slots for the Cypher CIC holodeck. */

export type SysGauges = {
  cpu: number;
  mem: number;
  disk: number;
  gpu: number;
  temp: number;
  watts: number;
  psi: number;
  sockets: number;
  failed: number;
  udev: number;
};

export type TalkerRow = { id: string; rate: number; role: string };
export type PacketRow = { proto?: string; size?: number; field?: number };
export type RfRow = { ssid?: string; rssi?: number; channel?: number };

export const EMPTY_SYS: SysGauges = {
  cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0, udev: 0,
};

export const CANVAS_DEFAULT = { w: 1280, h: 800 };

export type CicLook = { rain: number; glitch: number; hud: number };

export const DEFAULT_LOOK: CicLook = { rain: 1, glitch: 0.35, hud: 0.92 };

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function sysAlert(sys: SysGauges): number {
  return clamp01(Math.max(sys.failed, sys.psi, sys.temp > 0.75 ? sys.temp : 0));
}

export function roleCode(role: string): number {
  if (role === "gateway") return 0.95;
  if (role === "internet") return 0.75;
  if (role === "lan") return 0.45;
  if (role === "self") return 1;
  return 0.2;
}

export function idHash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return (h % 997) / 997;
}

export function parseCicLook(cfg?: Record<string, string> | null): CicLook {
  const n = (k: string, d: number) => {
    const v = Number(cfg?.[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    rain: clamp(n("rain", DEFAULT_LOOK.rain), 0, 2),
    glitch: clamp(n("glitch", DEFAULT_LOOK.glitch), 0, 1),
    hud: clamp(n("hud", DEFAULT_LOOK.hud), 0.35, 1.2),
  };
}

/** Prefer the host canvas; the sandbox iframe falls back to the default plate. */
export function cicCanvasSize(doc?: Document | null): { w: number; h: number } {
  let root = doc ?? (typeof document !== "undefined" ? document : null);
  try {
    if (!doc && typeof parent !== "undefined" && parent.document) root = parent.document;
  } catch { /* cross-origin / sandbox */ }
  const canvas = (root?.querySelector?.("canvas.render-host")
    ?? root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return {
    w: w > 64 ? w : CANVAS_DEFAULT.w,
    h: h > 64 ? h : CANVAS_DEFAULT.h,
  };
}

/** Slot 0: gauges + canvas + look + aggregate load. */
export function packSysSlot(
  sys: Partial<SysGauges> | undefined,
  audio: number,
  canvas: { w: number; h: number } = CANVAS_DEFAULT,
  look: CicLook = DEFAULT_LOOK,
  netLoad = 0,
  rfLoad = 0,
): number[] {
  const s = { ...EMPTY_SYS, ...sys };
  const w = canvas.w > 64 ? canvas.w : CANVAS_DEFAULT.w;
  const h = canvas.h > 64 ? canvas.h : CANVAS_DEFAULT.h;
  return [
    clamp01(s.cpu), clamp01(s.mem), clamp01(s.disk), clamp01(s.gpu),
    clamp01(s.temp), clamp01(s.watts), clamp01(s.psi), clamp01(s.sockets),
    clamp01(s.failed), clamp01(s.udev), clamp01(audio), sysAlert(s),
    w, h, clamp01(netLoad), clamp01(rfLoad),
    look.rain, look.glitch, look.hud,
  ];
}

/** Slot 1: up to 8 talkers — rate, hash, role, reserved. */
export function packTalkers(talkers: TalkerRow[] | undefined, cap = 8): number[] {
  const rows = (talkers ?? []).slice(0, cap);
  const out: number[] = [];
  for (const t of rows) {
    out.push(clamp01(t.rate / 200), idHash(t.id || ""), roleCode(t.role || ""), 0);
  }
  return out;
}

/** Slot 2: up to 8 protocol fields — field, size, proto-hash, reserved. */
export function packPackets(packets: PacketRow[] | undefined, cap = 8): number[] {
  const rows = (packets ?? []).slice(0, cap);
  const out: number[] = [];
  for (const p of rows) {
    out.push(
      clamp01(p.field ?? 0),
      clamp01((p.size ?? 0) / 1500),
      idHash(p.proto || "ip"),
      0,
    );
  }
  return out;
}

/** Slot 3: up to 6 RF beacons — rssi, channel, ssid-hash, reserved. */
export function packRf(rf: RfRow[] | undefined, cap = 6): number[] {
  const rows = (rf ?? []).slice(0, cap);
  const out: number[] = [];
  for (const b of rows) {
    const rssi = Number(b.rssi);
    const ch = Number(b.channel);
    out.push(
      clamp01(Number.isFinite(rssi) ? (rssi + 100) / 70 : 0),
      clamp01(Number.isFinite(ch) ? ch / 165 : 0),
      idHash(b.ssid || ""),
      0,
    );
  }
  return out;
}

export function peakTalker(talkers: TalkerRow[] | undefined): number {
  let peak = 0;
  for (const t of talkers ?? []) peak = Math.max(peak, t.rate);
  return clamp01(peak / 200);
}

export function peakRf(rf: RfRow[] | undefined): number {
  let peak = 0;
  for (const b of rf ?? []) {
    const rssi = Number(b.rssi);
    if (Number.isFinite(rssi)) peak = Math.max(peak, (rssi + 100) / 70);
  }
  return clamp01(peak);
}
