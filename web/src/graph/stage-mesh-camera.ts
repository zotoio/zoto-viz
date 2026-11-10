/**
 * Stage camera for host-mesh packs. The graph orbit sits ~1000 m from the origin;
 * aquarium and koi GLBs are metre-scale, so they only read when the camera matches
 * the shader's tank / pond camera.
 */

export type StageMeshPose = {
  position: [number, number, number];
  target: [number, number, number];
  near: number;
  /** Set when the shader builds its own projection instead of using the view ray. */
  fov?: number;
};

export type StageSlotReader = (slot: number, index: number) => number;

const KOI_FOV = (2 * Math.atan(0.5 / 1.2) * 180) / Math.PI;

export function stageMeshPackId(modeId: string, pluginId?: string | null): string {
  if (pluginId) return pluginId;
  return modeId.replace(/^plugin:/, "").split(":")[0] ?? "";
}

/** Vertical fov of the aquarium stage camera (degrees). */
export const AQUARIUM_FOV = 38;
/** Tank opening the camera frames: glass half-width / half-height and the front pane z (aquarium-tank.ts). */
const AQ_HALF_W = 1.22;
const AQ_HALF_H = 0.82;
const AQ_FRONT_Z = 1.02;
/** Room left around the tank opening. */
const AQ_FRAME_MARGIN = 1.08;

/**
 * Aquarium stage camera. It stands back far enough that the whole front of the tank (glass edges
 * included) is in frame at this pane's aspect (slot0[12..13] = canvas w, h), so a fish near the
 * front never looks huge or outside the glass. Drift sways a little; hold sits still.
 */
export function aquariumStagePose(read: StageSlotReader, viewAspect?: number): StageMeshPose {
  // follow camera (slot3: [0] on, [1..3] eye, [4..6] aim, [7] fov) from the pack
  if (read(3, 0) >= 0.5) {
    const fov = read(3, 7);
    const vfov = fov > 10 && fov < 100 ? fov : AQUARIUM_FOV;
    const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1 ? viewAspect : 16 / 9;
    // portrait panes widen the vertical fov so a fish still fits across
    const t = Math.tan((vfov * Math.PI) / 360) / Math.min(1, aspect);
    return {
      position: [read(3, 1), read(3, 2), read(3, 3)],
      target: [read(3, 4), read(3, 5), read(3, 6)],
      near: 0.02,
      fov: Math.min(100, (2 * Math.atan(t) * 180) / Math.PI),
    };
  }
  const mode = read(0, 8);
  const phase = read(0, 9);
  const w = read(0, 12);
  const h = read(0, 13);
  // The pane's own camera aspect wins (a maximised or solo pane is far wider than the pack's canvas guess).
  const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1
    ? viewAspect
    : w > 1 && h > 1 ? w / h : 1.6;
  const t = Math.tan((AQUARIUM_FOV * Math.PI) / 360);
  // The pack sizes the tank to the pane (slot3[11] = glass half width, front aspect = pane aspect),
  // so the front glass is framed edge to edge with no letterboxing. Older packs: fixed tank + margin.
  const hw = read(3, 11);
  const sized = hw > 0.3 && hw < 5;
  const halfW = sized ? hw : AQ_HALF_W;
  const margin = sized ? 1 : AQ_FRAME_MARGIN;
  const dist = Math.max((AQ_HALF_H * margin) / t, (halfW * margin) / (t * aspect));
  let x = 0;
  let y = 0.02;
  const z = AQ_FRONT_Z + dist;
  if (mode >= 0.5 && mode <= 1.5) {
    x += Math.sin(phase) * 0.1;
    y += Math.sin(phase * 0.7) * 0.03;
  }
  return {
    position: [x, y, z],
    target: [x * 0.5, y, z - 1],
    near: 0.05,
    fov: AQUARIUM_FOV,
  };
}

/**
 * Koi stage camera. Slot3 follow (same layout as aquarium): [0] on, [1..3] eye, [4..6] aim, [7] fov.
 * When follow is off, top/angled drift matches the pond sky shader.
 */
/** Slot3 follow layout uses [0] in {0,1}; host-mesh v2 packets put version 2 at [0]. */
function followCamActive(read: StageSlotReader, slot: number): boolean {
  const on = read(slot, 0);
  return on >= 0.5 && on < 1.5;
}

export function koiStagePose(read: StageSlotReader, viewAspect?: number): StageMeshPose {
  if (followCamActive(read, 3)) {
    const fov = read(3, 7);
    const vfov = fov > 10 && fov < 100 ? fov : KOI_FOV;
    const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1 ? viewAspect : 16 / 9;
    const tt = Math.tan((vfov * Math.PI) / 360) / Math.min(1, aspect);
    return {
      position: [read(3, 1), read(3, 2), read(3, 3)],
      target: [read(3, 4), read(3, 5), read(3, 6)],
      near: 0.05,
      fov: Math.min(100, (2 * Math.atan(tt) * 180) / Math.PI),
    };
  }
  const camAng = read(0, 17);
  const phase = read(0, 18);
  const tilt = camAng < 0.5 ? 0.02 : 0.22;
  return {
    position: [Math.sin(phase) * 0.08, 1.35 + tilt, 1.05 + camAng * 0.35],
    target: [0, 0, 0],
    near: 0.05,
    fov: KOI_FOV,
  };
}

/**
 * Rocket-car-soccer sky shader camera: origin slot0[1..3], yaw/pitch slot0[4..5], the view
 * ray is the Three.js camera (vDir). Before the first tick (slot0[0] < 0.5) the shader uses
 * a fixed kickoff camera. Without this pose the cars sit at the origin while the stage
 * camera stays on the ~1000 m graph orbit, so none of them show.
 */
export function rocketCarStagePose(read: StageSlotReader): StageMeshPose {
  let x = read(0, 1);
  let y = read(0, 2);
  let z = read(0, 3);
  let yaw = read(0, 4);
  let pitch = read(0, 5);
  if (read(0, 0) < 0.5) {
    x = 0;
    y = 11;
    z = 26;
    yaw = Math.PI;
    pitch = -0.32;
  }
  const fx = Math.sin(yaw) * Math.cos(pitch);
  const fy = Math.sin(pitch);
  const fz = Math.cos(yaw) * Math.cos(pitch);
  return { position: [x, y, z], target: [x + fx, y + fy, z + fz], near: 0.1 };
}

/** Marble-run fallback pose (the whole board) before the pack's first frame. */
const MARBLE_WIDE: StageMeshPose = { position: [0.15, 1.05, 4.15], target: [0.12, 0.78, 0.15], near: 0.03, fov: 36 };

/**
 * Marble-run camera from the pack (slot0: 1..3 position, 4..6 target, 7 fov). The board is
 * ~3.3 m wide, so on a wide pane the camera backs off until it fits horizontally.
 */
export function marbleRunStagePose(read: StageSlotReader, viewAspect?: number): StageMeshPose {
  let pose = MARBLE_WIDE;
  if (read(0, 0) >= 0.5) {
    const fov = read(0, 7);
    pose = {
      position: [read(0, 1), read(0, 2), read(0, 3)],
      target: [read(0, 4), read(0, 5), read(0, 6)],
      near: 0.03,
      fov: fov > 10 && fov < 100 ? fov : 36,
    };
  }
  const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1 ? viewAspect : 16 / 9;
  if (aspect >= 1) return pose;
  // portrait panes: widen the vertical fov so the run's width still fits
  const t = Math.tan(((pose.fov ?? 36) * Math.PI) / 360) / aspect;
  return { ...pose, fov: Math.min(100, (2 * Math.atan(t) * 180) / Math.PI) };
}

/** Bonsai fallback pose (the garden camera) before the pack's first frame. */
const BONSAI_REST: StageMeshPose = { position: [0, 0.582, 1.467], target: [0, 0.27, 0], near: 0.02, fov: 30 };
/** Half-width (m) of the board and the widest pads that must stay in frame. */
const BONSAI_HALF_W = 0.44;

/**
 * Bonsai camera from the pack (slot0: 1..3 position, 4..6 target, 7 fov). The board is ~0.8 m
 * across, so on a narrow pane the vertical fov widens until the board still fits.
 */
export function bonsaiStagePose(read: StageSlotReader, viewAspect?: number): StageMeshPose {
  let pose = BONSAI_REST;
  if (read(0, 0) >= 0.5) {
    const fov = read(0, 7);
    pose = {
      position: [read(0, 1), read(0, 2), read(0, 3)],
      target: [read(0, 4), read(0, 5), read(0, 6)],
      near: 0.02,
      fov: fov > 10 && fov < 100 ? fov : 30,
    };
  }
  const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1 ? viewAspect : 16 / 9;
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  const dist = Math.max(0.2, Math.hypot(px - tx, py - ty, pz - tz));
  const need = BONSAI_HALF_W / dist / aspect;
  const have = Math.tan(((pose.fov ?? 30) * Math.PI) / 360);
  if (need <= have) return pose;
  return { ...pose, fov: Math.min(100, (2 * Math.atan(need) * 180) / Math.PI) };
}

/** Orrery fallback pose (desk-level three-quarter view) before the pack's first frame. */
const ORRERY_REST: StageMeshPose = { position: [0, 0.749, 1.233], target: [0, 0.2, 0], near: 0.02, fov: 30 };
/** Half-width (m) of the orrery plus its outer planet that must stay in frame. */
const ORRERY_HALF_W = 0.56;

/**
 * Orrery camera from the pack (slot0: 1..3 position, 4..6 target, 7 fov). The machine is ~1 m
 * across, so on a narrow pane the vertical fov widens until the outer arm still fits.
 */
export function orreryStagePose(read: StageSlotReader, viewAspect?: number): StageMeshPose {
  let pose = ORRERY_REST;
  if (read(0, 0) >= 0.5) {
    const fov = read(0, 7);
    pose = {
      position: [read(0, 1), read(0, 2), read(0, 3)],
      target: [read(0, 4), read(0, 5), read(0, 6)],
      near: 0.02,
      fov: fov > 10 && fov < 100 ? fov : 30,
    };
  }
  const aspect = viewAspect !== undefined && Number.isFinite(viewAspect) && viewAspect > 0.1 ? viewAspect : 16 / 9;
  const [px, py, pz] = pose.position;
  const [tx, ty, tz] = pose.target;
  const dist = Math.max(0.2, Math.hypot(px - tx, py - ty, pz - tz));
  const need = ORRERY_HALF_W / dist / aspect;
  const have = Math.tan(((pose.fov ?? 30) * Math.PI) / 360);
  if (need <= have) return pose;
  return { ...pose, fov: Math.min(100, (2 * Math.atan(need) * 180) / Math.PI) };
}

export function stageMeshPose(packId: string, read: StageSlotReader, viewAspect?: number): StageMeshPose | null {
  if (packId === "marble-run") return marbleRunStagePose(read, viewAspect);
  if (packId === "bonsai") return bonsaiStagePose(read, viewAspect);
  if (packId === "orrery") return orreryStagePose(read, viewAspect);
  if (packId === "aquarium") return aquariumStagePose(read, viewAspect);
  if (packId === "koi-pond") return koiStagePose(read, viewAspect);
  if (packId === "rocket-car-soccer") return rocketCarStagePose(read);
  return null;
}
