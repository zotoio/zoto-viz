import * as THREE from "three";

/**
 * Marble Run host scenery: glass marbles as two instanced meshes (a clear clear-coated shell and
 * a coloured cat's-eye core), plus the run's own lights. Positions come from the pack's viz slots
 * 1..3 (x, y, z, look) every frame; rolling is integrated here from each marble's motion so the
 * sandbox only sends positions. The track itself is the pack's GLB on the host mesh lane.
 * Nothing is allocated per frame.
 */

export const MARBLE_RUN_MAX = 48;
const PER_SLOT = 16;
const FIRST_SLOT = 1;
/** slot0 indices (plugins/src/marble-run/frontend/pack.ts MR_SLOT). */
const S_COUNT = 8;
const S_BELL = 9;
const S_XYLO0 = 10;
const S_AUDIO = 18;

export type SlotReader = (slot: number, index: number) => number;

/** Decode a marble look float: radius mm + hue, or -radius mm for clear glass. */
export function decodeLook(look: number): { radius: number; hue: number } {
  if (!Number.isFinite(look) || look === 0) return { radius: 0.017, hue: -1 };
  if (look < 0) return { radius: -look / 1000, hue: -1 };
  const mm = Math.floor(look);
  return { radius: Math.max(0.01, mm / 1000), hue: look - mm };
}

export type MarbleRunScenery = {
  root: THREE.Group;
  update(read: SlotReader, dt: number): void;
  /** Live marble count after the last update (tests). */
  readonly count: number;
};

export function buildMarbleRunScenery(): MarbleRunScenery {
  const root = new THREE.Group();
  root.name = "marble-run-scenery";

  // lights: warm key from above-left, cool teal rim from the right, soft sky fill
  const hemi = new THREE.HemisphereLight(0xfff1e0, 0x2a1d14, 0.75);
  const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
  key.position.set(-1.6, 3.4, 2.6);
  key.target.position.set(0.1, 0.6, 0);
  const rim = new THREE.DirectionalLight(0x8fd6d8, 0.8);
  rim.position.set(2.8, 1.6, -1.2);
  const lamp = new THREE.PointLight(0xffc690, 0, 4, 1.6);
  lamp.position.set(-0.3, 0.9, 0.6);
  root.add(hemi, key, key.target, rim, lamp);

  const shellGeo = new THREE.SphereGeometry(1, 32, 18);
  const coreGeo = new THREE.SphereGeometry(1, 20, 12);
  // flatten the core into a twisted vane (cat's eye)
  const pos = coreGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = y * 1.6;
    const c = Math.cos(a), s = Math.sin(a);
    const fx = x * 0.62, fz = z * 0.16;
    pos.setXYZ(i, fx * c - fz * s, y * 0.66, fx * s + fz * c);
  }
  coreGeo.computeVertexNormals();

  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.32,
    specularIntensity: 1,
    ior: 1.5,
    depthWrite: false,
  });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.05, emissive: 0x000000 });
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, MARBLE_RUN_MAX);
  const cores = new THREE.InstancedMesh(coreGeo, coreMat, MARBLE_RUN_MAX);
  for (const m of [shells, cores]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
  }
  shells.renderOrder = 4;
  cores.renderOrder = 3;
  root.add(cores, shells);

  const prev = new Float32Array(MARBLE_RUN_MAX * 3);
  const rot = Array.from({ length: MARBLE_RUN_MAX }, () => new THREE.Quaternion());
  const had = new Uint8Array(MARBLE_RUN_MAX);
  const lastLook = new Float32Array(MARBLE_RUN_MAX).fill(Number.NaN);
  const m4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const dq = new THREE.Quaternion();
  const col = new THREE.Color();
  const glass = new THREE.Color(0xdfeef0);
  const up = new THREE.Vector3(0, 1, 0);
  let xylo: THREE.Mesh[] | null = null;
  let bellMesh: THREE.Mesh | null = null;
  let live = 0;

  const findTrackParts = (): void => {
    const lane = root.parent;
    if (!lane) return;
    if (xylo) {
      // the lane re-pins the track GLB on remount: drop stale bars
      let o: THREE.Object3D | null = xylo.find(Boolean) ?? null;
      while (o && o !== lane) o = o.parent;
      if (o === lane) return;
      xylo = null;
      bellMesh = null;
    }
    const bars: THREE.Mesh[] = [];
    lane.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const k = /^xylo-bar-(\d)$/.exec(o.name);
      if (k) bars[Number(k[1])] = mesh;
      if (o.name === "bell") bellMesh = mesh;
    });
    if (bars.length) {
      // own materials so a flash never touches another lane's template
      for (const b of bars) if (b) b.material = (b.material as THREE.MeshStandardMaterial).clone();
      if (bellMesh) bellMesh.material = (bellMesh.material as THREE.MeshStandardMaterial).clone();
      xylo = bars;
    }
  };

  const update = (read: SlotReader, dt: number): void => {
    const n = Math.max(0, Math.min(MARBLE_RUN_MAX, Math.round(read(0, S_COUNT))));
    for (let i = 0; i < n; i++) {
      const slot = FIRST_SLOT + Math.floor(i / PER_SLOT);
      const o = (i % PER_SLOT) * 4;
      const x = read(slot, o), y = read(slot, o + 1), z = read(slot, o + 2), look = read(slot, o + 3);
      const { radius, hue } = decodeLook(look);
      // roll: rotate about (up × motion) by distance / radius
      if (had[i]) {
        v3.set(x - prev[i * 3]!, y - prev[i * 3 + 1]!, z - prev[i * 3 + 2]!);
        const d = v3.length();
        if (d > 1e-5 && d < 0.3) {
          axis.crossVectors(up, v3).normalize();
          if (axis.lengthSq() > 0.5) {
            dq.setFromAxisAngle(axis, d / radius);
            rot[i]!.premultiply(dq).normalize();
          }
        }
      }
      prev[i * 3] = x; prev[i * 3 + 1] = y; prev[i * 3 + 2] = z; had[i] = 1;
      v3.set(x, y, z);
      sc.setScalar(radius);
      m4.compose(v3, rot[i]!, sc);
      shells.setMatrixAt(i, m4);
      sc.setScalar(radius * 0.97);
      m4.compose(v3, rot[i]!, sc);
      cores.setMatrixAt(i, m4);
      if (lastLook[i] !== look) {
        lastLook[i] = look;
        if (hue < 0) col.copy(glass).multiplyScalar(0.55);
        else col.setHSL(hue, 0.78, 0.52);
        cores.setColorAt(i, col);
        if (hue < 0) col.copy(glass); else col.setHSL(hue, 0.5, 0.82);
        shells.setColorAt(i, col);
        if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
        if (shells.instanceColor) shells.instanceColor.needsUpdate = true;
      }
    }
    for (let i = n; i < live; i++) had[i] = 0;
    live = n;
    shells.count = n;
    cores.count = n;
    shells.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;

    // accents: bell and xylophone bars glow when struck; the lamp breathes with audio
    findTrackParts();
    if (xylo) {
      for (let k = 0; k < xylo.length; k++) {
        const bar = xylo[k];
        if (!bar) continue;
        const m = bar.material as THREE.MeshStandardMaterial;
        const f = Math.max(0, Math.min(1, read(0, S_XYLO0 + k)));
        m.emissive.copy(m.color);
        m.emissiveIntensity = f * 0.9;
      }
    }
    if (bellMesh) {
      const m = (bellMesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.emissive.setRGB(1, 0.75, 0.35);
      m.emissiveIntensity = Math.max(0, Math.min(1, read(0, S_BELL))) * 0.8;
    }
    lamp.intensity = 0.6 + Math.max(0, Math.min(1, read(0, S_AUDIO))) * 1.4;
    void dt;
  };

  root.userData.onSlots = update;
  root.userData.dispose = () => {
    shellGeo.dispose(); coreGeo.dispose(); shellMat.dispose(); coreMat.dispose();
    shells.dispose(); cores.dispose();
  };
  return { root, update, get count() { return live; } };
}
