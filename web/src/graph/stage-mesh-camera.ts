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

/** Aquarium shader `getCam` — view ray is the Three.js camera, origin is this pose. */
export function aquariumStagePose(read: StageSlotReader): StageMeshPose {
  const mode = read(0, 8);
  const phase = read(0, 9);
  let x = 0;
  let y = 0.05;
  let z = 2.35;
  if (mode > 1.5) z = 2.15;
  else if (mode < 0.5) {
    y = 0;
    z = 2.55;
  } else {
    x += Math.sin(phase) * 0.12;
    y += Math.sin(phase * 0.7) * 0.04;
  }
  return {
    position: [x, y, z],
    target: [x, y, z - 1],
    near: 0.05,
  };
}

/** Koi shader look-at camera (it does not use vDir). Vertical fov matches focal length 1.2. */
export function koiStagePose(read: StageSlotReader): StageMeshPose {
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

export function stageMeshPose(packId: string, read: StageSlotReader): StageMeshPose | null {
  if (packId === "aquarium") return aquariumStagePose(read);
  if (packId === "koi-pond") return koiStagePose(read);
  if (packId === "rocket-car-soccer") return rocketCarStagePose(read);
  return null;
}
