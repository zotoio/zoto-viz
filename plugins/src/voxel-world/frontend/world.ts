import type { VoxCamera, VoxOptions } from "./config";

export function voxelCamera(t: number, o: VoxOptions): {
  x: number; y: number; z: number; yaw: number; pitch: number;
} {
  const speed = o.reducedMotion ? o.cameraSpeed * 0.12 : o.cameraSpeed;
  const phase = t * speed * 0.1;
  const villageX = 32;
  const villageZ = -18;
  if (o.camera === "orbit") {
    const r = o.reducedMotion ? 24 : 28;
    const ang = o.reducedMotion ? 0.55 : phase * 0.22;
    const x = villageX + Math.cos(ang) * r;
    const z = villageZ + Math.sin(ang) * r;
    const y = 14 + Math.sin(phase * 0.15) * 1.5;
    return { x, y, z, yaw: Math.atan2(villageX - x, villageZ - z), pitch: -0.16 };
  }
  if (o.camera === "walk") {
    const path = phase * 5;
    const x = Math.sin(path * 0.12) * 28;
    const z = path * 1.8 - 24;
    const y = 8 + Math.sin(path * 1.5) * 0.03;
    return { x, y, z, yaw: Math.atan2(Math.cos(path * 0.12) * 3, 1.8), pitch: -0.04 };
  }
  const x = Math.sin(phase * 0.25) * 42;
  const z = -phase * 10;
  const y = 16 + Math.sin(phase * 0.18) * 2;
  return { x, y, z, yaw: Math.atan2(-Math.cos(phase * 0.25) * 8, 10), pitch: -0.22 };
}

export function sunDir(dayFrac: number): [number, number, number] {
  const ang = (dayFrac - 0.25) * Math.PI * 2;
  const y = Math.sin(ang);
  const xz = Math.cos(ang);
  return [xz * 0.65, y, xz * 0.35];
}
