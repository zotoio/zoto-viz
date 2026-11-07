/**
 * Follow-koi camera: a smoothed camera drifts alongside one koi. When another fish passes
 * within {@link FOLLOW.passDist} of it (and the current fish has been followed for at least
 * {@link FOLLOW.minDwell} s), the focus eases over to the passer: the look point is a
 * smoothstep blend of both fish over {@link FOLLOW.blendS} s, and the eye and aim ride
 * critically damped springs, so there is never a snap. A lost fish (eaten, or its talker left)
 * hands over the same way from where it was last seen. Nothing is allocated per step.
 */

export const FOLLOW = {
  /** Another fish this close (tank units, centre to centre) to the followed one triggers a handoff. */
  passDist: 0.24,
  /** Seconds a fish is followed before another may take over (no ping-pong). */
  minDwell: 7,
  /** Seconds the focus takes to ease from one fish to the next. */
  blendS: 2.4,
  /** Spring stiffness (rad/s) of the eye and aim; critically damped. */
  omega: 1.05,
  /** Camera offset beside the fish, behind it and above it. */
  side: 0.55,
  /** Extra stand-off per metre of the fish's half length (a discus is kept further away than a neon). */
  sizeK: 4.0,
  back: 0.55,
  up: 0.42,
  /** How far ahead of the fish the camera looks. */
  lead: 0.18,
  /** Vertical fov while following (degrees). */
  fov: 40,
} as const;

/** Where the camera may stand: inside the glass, or out past the open front. */
const EYE_BOX = { xMin: -1.4, xMax: 1.4, yMin: 0.15, yMax: 1.8, zMin: -1.4, zMax: 1.6 } as const;

/** One frame of fish, filled by the sim into reused arrays. */
export interface FollowView {
  count: number;
  ids: string[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  /** Body half length; the camera stands further off a bigger fish. */
  size: Float32Array;
}

export function newFollowView(cap: number): FollowView {
  return {
    count: 0,
    ids: new Array<string>(cap).fill(""),
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    z: new Float32Array(cap),
    yaw: new Float32Array(cap),
    size: new Float32Array(cap),
  };
}

export function smoothstep01(t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return k * k * (3 - 2 * k);
}

/** One critically damped spring step for value `x` with velocity `v` toward `to`; writes [x, v] into `out`. */
export function springStep(x: number, v: number, to: number, omega: number, dt: number, out: Float64Array = SPRING_OUT): Float64Array {
  // exact solution of x'' = -w^2 (x - to) - 2 w x' over dt
  const d = x - to;
  const e = Math.exp(-omega * dt);
  const c = v + omega * d;
  const nx = to + (d + c * dt) * e;
  const nv = (v - omega * c * dt) * e;
  out[0] = nx; out[1] = nv;
  return out;
}

const SPRING_OUT = new Float64Array(2);

function indexOf(view: FollowView, id: string | null): number {
  if (!id) return -1;
  for (let i = 0; i < view.count; i++) if (view.ids[i] === id) return i;
  return -1;
}

export class FollowCam {
  targetId: string | null = null;
  nextId: string | null = null;
  /** 0..1 progress of the current handoff (0 when none). */
  blend = 0;
  /** Seconds on the current fish. */
  dwell = 0;
  readonly eye = new Float64Array(3);
  readonly aim = new Float64Array(3);
  readonly focus = new Float64Array(3);
  private readonly eyeV = new Float64Array(3);
  private readonly aimV = new Float64Array(3);
  private readonly lost = new Float64Array(4);
  private lostValid = false;
  private started = false;
  private side = 1;
  private readonly to = new Float64Array(6);
  private readonly out = new Float64Array(2);

  reset(): void {
    this.targetId = null; this.nextId = null; this.blend = 0; this.dwell = 0;
    this.started = false; this.lostValid = false;
  }

  /** Index of the followed fish in `view` (-1 when none). */
  targetIndex(view: FollowView): number { return indexOf(view, this.targetId); }
  nextIndex(view: FollowView): number { return indexOf(view, this.nextId); }

  step(view: FollowView, dt: number): void {
    if (view.count <= 0) return;
    const h = Math.max(0, Math.min(0.25, dt));
    let ti = indexOf(view, this.targetId);
    if (ti < 0 && !this.lostValid) {
      if (this.started) {
        // the followed fish is gone: keep its last spot as the handoff origin
        this.lost[0] = this.focus[0]!; this.lost[1] = this.focus[1]!; this.lost[2] = this.focus[2]!;
        this.lost[3] = Math.atan2(this.aim[0]! - this.eye[0]!, this.aim[2]! - this.eye[2]!);
        this.lostValid = true;
        this.targetId = null;
      } else {
        // first frame: start on the fish nearest the middle of the tank, at the camera's rest
        let best = 0, bd = Infinity;
        for (let i = 0; i < view.count; i++) {
          const d = view.x[i]! * view.x[i]! + view.y[i]! * view.y[i]! + view.z[i]! * view.z[i]!;
          if (d < bd) { bd = d; best = i; }
        }
        this.targetId = view.ids[best]!;
        ti = best;
      }
    }
    if (ti < 0 && !this.nextId) {
      // pick the fish nearest to where the lost one was
      let best = -1, bd = Infinity;
      for (let i = 0; i < view.count; i++) {
        const dx = view.x[i]! - this.lost[0]!, dy = view.y[i]! - this.lost[1]!, dz = view.z[i]! - this.lost[2]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      this.nextId = view.ids[best]!;
      this.blend = 0;
    }
    let ni = indexOf(view, this.nextId);
    if (this.nextId && ni < 0) {
      // the fish we were easing to left: settle back (or pick again next step)
      this.nextId = null; this.blend = 0;
    }

    if (ni >= 0) {
      this.blend = Math.min(1, this.blend + h / FOLLOW.blendS);
    } else if (ti >= 0) {
      this.dwell += h;
      if (this.dwell >= FOLLOW.minDwell) {
        // a fish swimming past close by takes over
        let best = -1, bd = FOLLOW.passDist * FOLLOW.passDist;
        for (let i = 0; i < view.count; i++) {
          if (i === ti) continue;
          const dx = view.x[i]! - view.x[ti]!, dy = view.y[i]! - view.y[ti]!, dz = view.z[i]! - view.z[ti]!;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) { this.nextId = view.ids[best]!; ni = best; this.blend = 0; }
      }
    }

    // focus: from (the fish, or where it was lost) eased toward the next fish
    let fx: number, fy: number, fz: number, fyaw: number, fsize: number;
    if (ti >= 0) { fx = view.x[ti]!; fy = view.y[ti]!; fz = view.z[ti]!; fyaw = view.yaw[ti]!; fsize = view.size[ti]!; }
    else { fx = this.lost[0]!; fy = this.lost[1]!; fz = this.lost[2]!; fyaw = this.lost[3]!; fsize = 0.05; }
    if (ni >= 0) {
      const k = smoothstep01(this.blend);
      fx += (view.x[ni]! - fx) * k; fy += (view.y[ni]! - fy) * k; fz += (view.z[ni]! - fz) * k;
      const dyaw = Math.atan2(Math.sin(view.yaw[ni]! - fyaw), Math.cos(view.yaw[ni]! - fyaw));
      fyaw += dyaw * k;
      fsize += (view.size[ni]! - fsize) * k;
      if (this.blend >= 1) {
        this.targetId = this.nextId; this.nextId = null; this.blend = 0; this.dwell = 0; this.lostValid = false;
      }
    }
    this.focus[0] = fx; this.focus[1] = fy; this.focus[2] = fz;

    // alongside: the side of the fish nearer the open front (hysteresis so it does not flip-flop)
    const hx = Math.sin(fyaw), hz = Math.cos(fyaw);
    const sx = hz, sz = -hx;                       // right of the heading
    const front = sz * this.side;
    if (front < -0.35) this.side = -this.side;
    const off = FOLLOW.side + Math.max(0, fsize) * FOLLOW.sizeK;
    let ex = fx + sx * this.side * off - hx * FOLLOW.back;
    let ey = fy + FOLLOW.up;
    let ez = fz + sz * this.side * off - hz * FOLLOW.back;
    ex = Math.max(EYE_BOX.xMin, Math.min(EYE_BOX.xMax, ex));
    ey = Math.max(EYE_BOX.yMin, Math.min(EYE_BOX.yMax, ey));
    ez = Math.max(EYE_BOX.zMin, Math.min(EYE_BOX.zMax, ez));
    const ax = fx + hx * FOLLOW.lead, ay = fy, az = fz + hz * FOLLOW.lead;

    if (!this.started) {
      this.eye[0] = ex; this.eye[1] = ey; this.eye[2] = ez;
      this.aim[0] = ax; this.aim[1] = ay; this.aim[2] = az;
      this.eyeV.fill(0); this.aimV.fill(0);
      this.started = true;
      return;
    }
    const to = this.to;
    to[0] = ex; to[1] = ey; to[2] = ez; to[3] = ax; to[4] = ay; to[5] = az;
    const o = this.out;
    for (let k = 0; k < 3; k++) {
      springStep(this.eye[k]!, this.eyeV[k]!, to[k]!, FOLLOW.omega, h, o);
      this.eye[k] = o[0]!; this.eyeV[k] = o[1]!;
      springStep(this.aim[k]!, this.aimV[k]!, to[k + 3]!, FOLLOW.omega * 1.6, h, o);
      this.aim[k] = o[0]!; this.aimV[k] = o[1]!;
    }
  }
}
