/**
 * Whole-cloud drift for graph views (topology and the other graph engines).
 * Floor, sky, and host-mesh models stay on their own motion. The cloud draws
 * a slow eased figure-8 whose long axis is Z, tilted a few degrees off the
 * floor, and nods at a different rate than the camera pitch.
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
 * Smootherstep. Position, speed, and acceleration all meet at each turn, so the
 * figure-8 target does not kick when a lap restarts.
 */
export function easeCycle(turns: number): number {
  const u = turns - Math.floor(turns);
  const s = u * u * u * (u * (u * 6 - 15) + 10);
  return Math.floor(turns) + s;
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
