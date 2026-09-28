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

export function stageMeshPose(packId: string, read: StageSlotReader): StageMeshPose | null {
  if (packId === "aquarium") return aquariumStagePose(read);
  if (packId === "koi-pond") return koiStagePose(read);
  return null;
}
