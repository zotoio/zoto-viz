/**
 * Whole-cloud drift for graph views (topology and the other graph engines).
 * Floor, sky, and host-mesh models stay on their own motion. The cloud draws
 * a slow figure-8 in the camera frame (screen right and depth), tilted a few
 * degrees off the floor, so orbiting the view does not swing that slide sideways.
 */

export type GraphDriftPose = {
  x: number;
  y: number;
  z: number;
  /** radians, nod around the cloud center */
  pitch: number;
  /** radians, extra yaw. Zero on a plane; on a sphere it slips against the sky dome. */
  yaw: number;
};

export type DriftCenter = { x: number; y: number; z: number };

const AMP_X = 14;
const AMP_Z = 36;

/**
 * Constant rate. The figure-8 is sin/cos of this angle, and those already
 * match position and velocity at every lap, so the cloud does not halt at
 * the crossing and then catch up against the camera.
 */
export function easeCycle(turns: number): number {
  return turns;
}

/**
 * Turn a camera-frame slide into world space. `viewYaw` is the camera's
 * spherical theta. Screen-right stays screen-right as the view orbits.
 */
export function driftInView(pose: GraphDriftPose, viewYaw: number): GraphDriftPose {
  const c = Math.cos(viewYaw);
  const s = Math.sin(viewYaw);
  return {
    x: pose.x * c - pose.z * s,
    y: pose.y,
    z: -pose.x * s - pose.z * c,
    pitch: pose.pitch,
    yaw: pose.yaw,
  };
}

/** Gerono lemniscate, long axis Z, tilted by `pitch` so it is not parallel to the floor. */
export function figureEight(theta: number, pitch: number): { x: number; y: number; z: number } {
  const x = Math.sin(theta) * AMP_X;
  const flatZ = Math.sin(theta) * Math.cos(theta) * AMP_Z * 2;
  return {
    x,
    y: Math.sin(pitch) * flatZ,
    z: Math.cos(pitch) * flatZ,
  };
}

/**
 * One cloud pose. `pitchPeriod` / `pitchDeg` are the camera nod; the cloud
 * uses a slower cycle and a slightly larger nod so it does not lock to them.
 */
export function graphDriftPose(
  timeSec: number,
  camera: { pitchDeg: number; pitchPeriod: number; yawPeriod?: number },
  phase = 0,
  sphere = false,
): GraphDriftPose {
  const camPeriod = Math.max(4, camera.pitchPeriod);
  const period = camPeriod * 1.45;
  const turns = timeSec / period + phase;
  const theta = easeCycle(turns) * Math.PI * 2;
  const nodPeriod = camPeriod * 1.23;
  const nodDeg = camera.pitchDeg * 0.82 + 2.1;
  const pitch = Math.sin((timeSec / nodPeriod) * Math.PI * 2 + phase * 1.7) * (nodDeg * Math.PI) / 180;
  const eight = figureEight(theta, pitch);
  const yawPeriod = Math.max(30, camera.yawPeriod ?? 150);
  const yaw = sphere ? ((timeSec / (yawPeriod * 1.7)) + phase * 0.13) * Math.PI * 2 : 0;
  return { x: eight.x, y: eight.y, z: eight.z, pitch, yaw };
}

/** Pitch first, then yaw. Matches a quaternion yaw * pitch. */
function rotateLocal(x: number, y: number, z: number, pitch: number, yaw: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const py = y * cp - z * sp;
  const pz = y * sp + z * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return { x: x * cy + pz * sy, y: py, z: -x * sy + pz * cy };
}

/** World position of a layout point after the cloud drift. */
export function applyDriftPoint(
  x: number,
  y: number,
  z: number,
  pose: GraphDriftPose,
  center: DriftCenter,
): { x: number; y: number; z: number } {
  const spun = rotateLocal(x - center.x, y - center.y, z - center.z, pose.pitch, pose.yaw);
  return {
    x: center.x + spun.x + pose.x,
    y: center.y + spun.y + pose.y,
    z: center.z + spun.z + pose.z,
  };
}

/** Inverse of {@link applyDriftPoint}. Layout position from a world hit. */
export function unapplyDriftPoint(
  x: number,
  y: number,
  z: number,
  pose: GraphDriftPose,
  center: DriftCenter,
): { x: number; y: number; z: number } {
  const dx = x - pose.x - center.x;
  const dy = y - pose.y - center.y;
  const dz = z - pose.z - center.z;
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const ux = dx * cy - dz * sy;
  const uz = dx * sy + dz * cy;
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  return {
    x: ux + center.x,
    y: center.y + dy * cp + uz * sp,
    z: center.z + -dy * sp + uz * cp,
  };
}

/**
 * Critically damped springs. The core follows the figure-8, nodes follow the
 * core, and edge middles follow the nodes. Lower frequency means more lag.
 * The eased set is the default so the cloud glides. Beat frequencies are for
 * when the graph's mic pulse is allowed to hit on transients.
 */
export const CORE_OMEGA = 1.05;
export const NODE_OMEGA = 0.48;
export const EDGE_OMEGA = 0.26;
export const BEAT_CORE_OMEGA = 2.2;
export const BEAT_NODE_OMEGA = 0.85;
export const BEAT_EDGE_OMEGA = 0.42;

export function driftOmegas(beat: boolean): { core: number; node: number; edge: number } {
  return beat
    ? { core: BEAT_CORE_OMEGA, node: BEAT_NODE_OMEGA, edge: BEAT_EDGE_OMEGA }
    : { core: CORE_OMEGA, node: NODE_OMEGA, edge: EDGE_OMEGA };
}

export type SpringBody = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

function stepAxis(
  pos: number,
  vel: number,
  target: number,
  dt: number,
  omega: number,
): { p: number; v: number } {
  const w = Math.max(0.05, omega);
  const y0 = pos - target;
  const e = Math.exp(-w * dt);
  const b = vel + w * y0;
  return {
    p: target + (y0 + b * dt) * e,
    v: (vel - w * b * dt) * e,
  };
}

/**
 * Where an edge middle wants to sit. It rests on the nodes, and when the core
 * has moved away it eases further back along that same trail, so the wire
 * draws inward instead of staying taut.
 */
export function edgeSpringTarget(
  core: { x: number; y: number; z: number },
  node: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = 0.85;
  return {
    x: node.x + (node.x - core.x) * k,
    y: node.y + (node.y - core.y) * k,
    z: node.z + (node.z - core.z) * k,
  };
}

/**
 * Pitch and yaw of the whole cloud. Same critical damping as the slide, so a
 * nod or a sphere turn eases in instead of taking the raw angle each frame.
 */
export function stepAngles(
  pitch: number,
  pitchV: number,
  yaw: number,
  yawV: number,
  targetPitch: number,
  targetYaw: number,
  dt: number,
  omega: number,
): { pitch: number; pitchV: number; yaw: number; yawV: number } {
  const t = Math.max(0, dt);
  if (t === 0) return { pitch, pitchV, yaw, yawV };
  const p = stepAxis(pitch, pitchV, targetPitch, t, omega);
  const y = stepAxis(yaw, yawV, targetYaw, t, omega);
  return { pitch: p.p, pitchV: p.v, yaw: y.p, yawV: y.v };
}

/** Advance one mass toward `target`. Critical damping, so it does not overshoot or snap. */
export function stepSpring(
  body: SpringBody,
  target: { x: number; y: number; z: number },
  dt: number,
  omega: number,
): SpringBody {
  const t = Math.max(0, dt);
  if (t === 0) return body;
  const x = stepAxis(body.x, body.vx, target.x, t, omega);
  const y = stepAxis(body.y, body.vy, target.y, t, omega);
  const z = stepAxis(body.z, body.vz, target.z, t, omega);
  return { x: x.p, y: y.p, z: z.p, vx: x.v, vy: y.v, vz: z.v };
}

/** World-space trail (follower minus pose) turned into the rig's layout axes. */
export function lagIntoLayout(
  world: DriftCenter,
  pose: GraphDriftPose,
): DriftCenter {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const ux = world.x * cy - world.z * sy;
  const uz = world.x * sy + world.z * cy;
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  return {
    x: ux,
    y: world.y * cp + uz * sp,
    z: -world.y * sp + uz * cp,
  };
}

/** Stable 0.9–1 scale so neighbouring nodes trail by slightly different amounts. */
export function nodeTravelScale(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 0.9 + 0.1 * ((h >>> 0) / 4294967295);
}

/**
 * How far a node of this drawn size may sit behind its connector.
 * Just past the glyph, so the line end stays visible in front of the node.
 */
export function nodeLagReach(scale: number): number {
  return Math.max(3.5, Math.abs(scale) * 1.22);
}

export type DragNode = { x: number; y: number; z: number; scale: number };

/** Mean position. The drag point when no single node leads the cloud. */
export function graphOrigin(nodes: { x: number; y: number; z: number }[]): DriftCenter {
  if (!nodes.length) return { x: 0, y: 0, z: 0 };
  let x = 0, y = 0, z = 0;
  for (const n of nodes) {
    x += n.x;
    y += n.y;
    z += n.z;
  }
  const k = 1 / nodes.length;
  return { x: x * k, y: y * k, z: z * k };
}

/**
 * Where a moving cloud is pulled from. A node that is clearly the largest
 * is the drag core. Otherwise the pull is the graph origin.
 */
export function pickDragCore(nodes: DragNode[]): DriftCenter {
  const origin = graphOrigin(nodes);
  let best: DragNode | null = null;
  let second = 0;
  for (const n of nodes) {
    if (!best || n.scale > best.scale) {
      second = best ? best.scale : 0;
      best = n;
    } else if (n.scale > second) {
      second = n.scale;
    }
  }
  if (best && best.scale >= 0.8 && (second <= 0.05 || best.scale >= second * 1.25)) {
    return { x: best.x, y: best.y, z: best.z };
  }
  return origin;
}

/** 0 on the drag point, 1 once an edge middle sits well away from it. */
export function edgeDragWeight(mid: DriftCenter, core: DriftCenter): number {
  const d = Math.hypot(mid.x - core.x, mid.y - core.y, mid.z - core.z);
  const u = Math.min(1, d / 72);
  return u * u * (3 - 2 * u);
}

/** String follows the drag with a little mass, fast enough to track the figure-8. */
export const EDGE_DRAG_OMEGA = 1.55;

/** Where a string middle wants to sit: opposite the cloud's acceleration, capped. */
export function edgeInertiaTarget(accel: DriftCenter, gain = 2.2, cap = 12): DriftCenter {
  const x = -accel.x * gain;
  const y = -accel.y * gain;
  const z = -accel.z * gain;
  const m = Math.hypot(x, y, z);
  if (m <= cap || m < 1e-6) return { x, y, z };
  const s = cap / m;
  return { x: x * s, y: y * s, z: z * s };
}

/** Finite-difference the camera-frame slide. Camera orbit is not in this pose. */
export function edgeDragAccel(
  prev: DriftCenter,
  prevVel: DriftCenter,
  next: DriftCenter,
  dt: number,
): { vel: DriftCenter; accel: DriftCenter } {
  const t = Math.max(dt, 1e-4);
  const vel = {
    x: (next.x - prev.x) / t,
    y: (next.y - prev.y) / t,
    z: (next.z - prev.z) / t,
  };
  let ax = (vel.x - prevVel.x) / t;
  let ay = (vel.y - prevVel.y) / t;
  let az = (vel.z - prevVel.z) / t;
  const m = Math.hypot(ax, ay, az);
  if (m > 40) {
    const s = 40 / m;
    ax *= s;
    ay *= s;
    az *= s;
  }
  return { vel, accel: { x: ax, y: ay, z: az } };
}

/**
 * 0 is a stiff rod, 1 is a slack cable. The string slider loosens the edge.
 * The spring slider tightens it. A longer rest length yields a little more.
 */
export function edgeFlex(stringAmt: number, spring: number, linkSpan = 1): number {
  const loose = Math.max(0, Math.min(1, stringAmt));
  const tight = Math.max(0, spring);
  const span = Math.min(1.6, Math.max(0.4, linkSpan));
  const give = loose * span;
  return Math.max(0, Math.min(1, give / (give + tight * 0.85 + 0.2)));
}

/** Stiff edges snap back. Slack cables keep the slow drag spring. */
export function edgeYieldOmega(flex: number, beat = false): number {
  const f = Math.max(0, Math.min(1, flex));
  const soft = beat ? EDGE_DRAG_OMEGA * 1.45 : EDGE_DRAG_OMEGA;
  const stiff = beat ? 7.2 : 5.8;
  return stiff + (soft - stiff) * f;
}

/** Rig spin in layout axes. Pitch rate is around X; yaw rate is around world Y. */
export function rigOmega(pitch: number, pitchRate: number, yawRate: number): DriftCenter {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: pitchRate, y: yawRate * cp, z: -yawRate * sp };
}

export function edgeCross(a: DriftCenter, b: DriftCenter): DriftCenter {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Tangential plus centripetal acceleration of a layout point on the spinning rig. */
export function angularAccelAt(r: DriftCenter, omega: DriftCenter, alpha: DriftCenter): DriftCenter {
  const centripetal = edgeCross(omega, edgeCross(omega, r));
  const tangential = edgeCross(alpha, r);
  return {
    x: tangential.x + centripetal.x,
    y: tangential.y + centripetal.y,
    z: tangential.z + centripetal.z,
  };
}

/** Spin change, clamped so a hitch cannot whip every cable. */
export function edgeSpinAlpha(prev: DriftCenter, next: DriftCenter, dt: number): DriftCenter {
  const t = Math.max(dt, 1e-4);
  let x = (next.x - prev.x) / t;
  let y = (next.y - prev.y) / t;
  let z = (next.z - prev.z) / t;
  const m = Math.hypot(x, y, z);
  if (m > 1.5) {
    const s = 1.5 / m;
    x *= s;
    y *= s;
    z *= s;
  }
  return { x, y, z };
}

/**
 * Hang per unit of edge length, toward world-down already mapped into layout.
 * A stiff edge does not hang. Gravity strengthens the droop; a slack string
 * still droops a little when the gravity slider is off.
 */
export function edgeGravityPerLength(down: DriftCenter, flex: number, gravity: number): DriftCenter {
  const f = Math.max(0, Math.min(1, flex));
  const g = Math.max(0, Math.min(2, gravity));
  const k = f * (0.35 + 0.65 * g) * 0.16;
  const m = Math.hypot(down.x, down.y, down.z) || 1;
  return { x: (down.x / m) * k, y: (down.y / m) * k, z: (down.z / m) * k };
}

/** Bow from the rig's spin. Farther from the drag core, and only as the edge yields. */
export function edgeAngularPull(
  mid: DriftCenter,
  core: DriftCenter,
  omega: DriftCenter,
  alpha: DriftCenter,
  flex: number,
  len: number,
): DriftCenter {
  const f = Math.max(0, Math.min(1, flex));
  if (f < 1e-4) return { x: 0, y: 0, z: 0 };
  const r = { x: mid.x - core.x, y: mid.y - core.y, z: mid.z - core.z };
  const a = angularAccelAt(r, omega, alpha);
  const gain = 1.15 * f;
  return edgeBowPull({ x: -a.x * gain, y: -a.y * gain, z: -a.z * gain }, 1, len);
}

/** Slack at one edge, quieter near the drag core and never longer than the chord. */
export function edgeBowPull(slack: DriftCenter, weight: number, len: number): DriftCenter {
  let x = slack.x * weight;
  let y = slack.y * weight;
  let z = slack.z * weight;
  const maxBow = Math.max(0.35, len * 0.45);
  const m = Math.hypot(x, y, z);
  if (m > maxBow && m > 1e-8) {
    const s = maxBow / m;
    x *= s;
    y *= s;
    z *= s;
  }
  return { x, y, z };
}

/** Group position that matches {@link applyDriftPoint} for children stored in layout space. */
export function driftRig(
  pose: GraphDriftPose,
  center: DriftCenter,
): { x: number; y: number; z: number; pitch: number; yaw: number } {
  const spun = rotateLocal(center.x, center.y, center.z, pose.pitch, pose.yaw);
  return {
    x: center.x + pose.x - spun.x,
    y: center.y + pose.y - spun.y,
    z: center.z + pose.z - spun.z,
    pitch: pose.pitch,
    yaw: pose.yaw,
  };
}
