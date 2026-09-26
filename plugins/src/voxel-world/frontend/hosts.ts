/** Stable host-id → world placement (never list index). */

export type VoxPacketRow = {
  field: number;
  proto?: string;
  host?: string;
  id?: string;
  /** Explicit failure gauge from host — not inferred from field. */
  failed?: number;
};

export type VoxTalkerRow = { id: string; rate: number; role?: string; failed?: number };

export const PACKETS_PER_FRAME_CAP = 8;
export const MAX_HOST_SLOTS = 6;
const HOST_LEAVE_GRACE_FRAMES = 120;

export function hostKeyFromPacket(p: VoxPacketRow): string | null {
  const h = (p.host ?? p.id)?.trim();
  return h || null;
}

export function hostWorldXZ(hostId: string, worldSeed: number): { x: number; z: number; label: number } {
  let h = 0;
  for (let i = 0; i < hostId.length; i++) h = (Math.imul(h, 31) + hostId.charCodeAt(i)) | 0;
  const a = ((h ^ worldSeed) >>> 0) / 4294967296;
  const b = (((h * 1103515245 + worldSeed) >>> 0) % 997) / 997;
  return {
    x: (a - 0.5) * 48,
    z: (b - 0.5) * 48,
    label: (h >>> 0) % 10000,
  };
}

export interface HostSlotState {
  hostId: string;
  x: number;
  y: number;
  z: number;
  kind: number;
  strength: number;
  fail: number;
  label: number;
  lastSeen: number;
}

export class HostSlotRegistry {
  private slots = new Map<string, HostSlotState>();
  private frame = 0;

  reset(): void {
    this.slots.clear();
    this.frame = 0;
  }

  tickFrame(): void {
    this.frame++;
    for (const [id, s] of this.slots) {
      if (this.frame - s.lastSeen > HOST_LEAVE_GRACE_FRAMES) this.slots.delete(id);
    }
  }

  get(id: string): HostSlotState | undefined {
    return this.slots.get(id);
  }

  values(): HostSlotState[] {
    return [...this.slots.values()];
  }

  upsertFlow(
    hostId: string,
    worldSeed: number,
    kind: number,
    yBase: number,
  ): HostSlotState {
    const anchor = hostWorldXZ(hostId, worldSeed);
    const prev = this.slots.get(hostId);
    const row: HostSlotState = {
      hostId,
      x: anchor.x,
      y: yBase,
      z: anchor.z,
      kind,
      strength: 1,
      fail: prev?.fail ?? 0,
      label: anchor.label,
      lastSeen: this.frame,
    };
    this.slots.set(hostId, row);
    return row;
  }

  setFail(hostId: string, worldSeed: number, fail: number, yBase: number): void {
    const anchor = hostWorldXZ(hostId, worldSeed);
    const prev = this.slots.get(hostId);
    this.slots.set(hostId, {
      hostId,
      x: anchor.x,
      y: yBase + 2,
      z: anchor.z,
      kind: 9,
      strength: fail,
      fail,
      label: anchor.label,
      lastSeen: this.frame,
    });
  }

  syncTalkers(talkers: VoxTalkerRow[], worldSeed: number, yBase: number): void {
    for (const t of talkers) {
      if (!t.id) continue;
      const anchor = hostWorldXZ(t.id, worldSeed);
      const fail = typeof t.failed === "number" ? Math.min(1, Math.max(0, t.failed)) : 0;
      const prev = this.slots.get(t.id);
      this.slots.set(t.id, {
        hostId: t.id,
        x: anchor.x,
        y: yBase,
        z: anchor.z,
        kind: fail > 0 ? 9 : prev?.kind ?? 0,
        strength: fail > 0 ? fail : prev?.strength ?? 0,
        fail,
        label: anchor.label,
        lastSeen: this.frame,
      });
    }
  }
}
