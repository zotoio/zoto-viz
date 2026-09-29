import type { DreamAnim } from "./scene";

/**
 * Floors / caps that keep the live graph readable when several drives stack.
 * Slider ranges stay full; this only rewrites a mix that would twitch the
 * camera, fling the cloud, or bury labels under sparks.
 */
export const READABLE = {
  camInertia: 0.45,
  moveEase: 0.35,
  camAudio: 1,
  camChange: 0.8,
  camGaze: 0.7,
  zoomPeriod: 40,
  gravity: 1,
  swirl: 0.7,
  stringAmt: 0.5,
  magnetRange: 1.2,
  magnetAbs: 0.85,
  labelWeight: 1.2,
  labelCount: 40,
  nodeWeight: 1.8,
  partSize: 1.5,
  partSpeed: 1.6,
  partBusy: 1.6,
  partAmt: 1.25,
  partCap: 800,
} as const;

function floor(n: number, lo: number): number {
  return Number.isFinite(n) ? Math.max(lo, n) : lo;
}

function cap(n: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, n) : hi;
}

function clampAbs(n: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-hi, Math.min(hi, n));
}

/** True when the orbit is being steered (audio, follow, or gaze) rather than sitting still. */
export function cameraDriven(a: Pick<DreamAnim, "audioCamera" | "follow" | "camGaze" | "camAudio">): boolean {
  return !!a.audioCamera || !!a.follow || (a.camGaze ?? 0) > 0.2 || (a.camAudio ?? 0) > 0.4;
}

/** True when magnets / gravity / swirl / strings are strong enough to fling nodes. */
export function physicsHot(a: Pick<DreamAnim, "audioPhysics" | "gravity" | "swirl" | "stringAmt">): boolean {
  return !!a.audioPhysics || (a.gravity ?? 0) > 0.8 || (a.swirl ?? 0) > 0.6 || (a.stringAmt ?? 0) > 0.45;
}

/** True when sparks are large / fast enough to bury labels. Cap stays open when they are small. */
export function sparksHot(a: Pick<DreamAnim, "partSize" | "partAmt" | "partBusy" | "partSpeed">): boolean {
  return (a.partSize ?? 0) > 1.4 || (a.partAmt ?? 0) > 1.2 || (a.partBusy ?? 0) > 1.5 || (a.partSpeed ?? 0) > 1.5;
}

/** Idempotent. Leaves a calm mix (DEFAULT_DREAM) unchanged. */
export function guardReadableAnim(anim: DreamAnim): DreamAnim {
  const next = { ...anim };
  if (!Number.isFinite(next.magnetTraffic)) next.magnetTraffic = 0;
  if (cameraDriven(next)) {
    next.camInertia = floor(next.camInertia, READABLE.camInertia);
    next.moveEase = floor(next.moveEase, READABLE.moveEase);
    next.camAudio = cap(next.camAudio, READABLE.camAudio);
    next.camChange = cap(next.camChange, READABLE.camChange);
    next.camGaze = cap(next.camGaze, READABLE.camGaze);
    if ((next.zoom ?? 0) > 0.15) next.zoomPeriod = floor(next.zoomPeriod, READABLE.zoomPeriod);
  }
  if (physicsHot(next)) {
    next.gravity = cap(next.gravity, READABLE.gravity);
    next.swirl = cap(next.swirl, READABLE.swirl);
    next.stringAmt = cap(next.stringAmt, READABLE.stringAmt);
    next.magnetRange = cap(next.magnetRange, READABLE.magnetRange);
    next.magnetSelf = clampAbs(next.magnetSelf, READABLE.magnetAbs);
    next.magnetGateway = clampAbs(next.magnetGateway, READABLE.magnetAbs);
    next.magnetLan = clampAbs(next.magnetLan, READABLE.magnetAbs);
    next.magnetLocal = clampAbs(next.magnetLocal, READABLE.magnetAbs);
    next.magnetInternet = clampAbs(next.magnetInternet, READABLE.magnetAbs);
    next.magnetMulticast = clampAbs(next.magnetMulticast, READABLE.magnetAbs);
    next.magnetCross = clampAbs(next.magnetCross, READABLE.magnetAbs);
    next.magnetTraffic = clampAbs(next.magnetTraffic, READABLE.magnetAbs);
  }
  next.labelWeight = cap(next.labelWeight, READABLE.labelWeight);
  next.labelCount = cap(next.labelCount, READABLE.labelCount);
  next.nodeWeight = cap(next.nodeWeight, READABLE.nodeWeight);
  if (sparksHot(next)) {
    next.partSize = cap(next.partSize, READABLE.partSize);
    next.partSpeed = cap(next.partSpeed, READABLE.partSpeed);
    next.partBusy = cap(next.partBusy, READABLE.partBusy);
    next.partAmt = cap(next.partAmt, READABLE.partAmt);
    next.partCap = cap(next.partCap, READABLE.partCap);
  }
  return next;
}
