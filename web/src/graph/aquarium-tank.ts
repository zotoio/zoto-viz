import * as THREE from "three";

/** Matches the old raymarch tank half-extents so the stage camera still frames it. */
const HX = 1.22;
const HY = 0.82;
const HZ = 1.02;
const TH = 0.03;

function pane(
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

/**
 * Open-front glass tank. Contents (gravel, plants, fish) are separate host meshes
 * and stay readable through the missing front pane.
 */
export function buildAquariumTank(): THREE.Group {
  const group = new THREE.Group();
  group.name = "aquarium-tank";

  const glass = new THREE.MeshStandardMaterial({
    color: 0xd7eef2,
    transparent: true,
    opacity: 0.16,
    roughness: 0.06,
    metalness: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const waterBack = new THREE.MeshStandardMaterial({
    color: 0x0c4554,
    roughness: 0.45,
    metalness: 0.02,
    emissive: 0x062833,
    emissiveIntensity: 0.35,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: 0x1a2420,
    roughness: 0.85,
    metalness: 0,
  });
  const lip = new THREE.MeshStandardMaterial({
    color: 0x9eb8bc,
    roughness: 0.35,
    metalness: 0.15,
  });

  group.add(pane([HX * 2, HY * 2, TH], waterBack, [0, 0, -HZ]));
  group.add(pane([TH, HY * 2, HZ * 2], glass, [-HX, 0, 0]));
  group.add(pane([TH, HY * 2, HZ * 2], glass, [HX, 0, 0]));
  group.add(pane([HX * 2, TH, HZ * 2], floor, [0, -HY, 0]));
  group.add(pane([HX * 2, TH, HZ * 2], glass, [0, HY, 0]));
  group.add(pane([HX * 2 + TH, TH * 1.4, TH * 1.4], lip, [0, -HY, HZ]));
  group.add(pane([HX * 2 + TH, TH * 1.4, TH * 1.4], lip, [0, HY, HZ]));
  const puff = buildEatPuff();
  group.add(puff.root);
  group.userData.onSlots = (read: (slot: number, index: number) => number, dt: number) =>
    puff.update(read(2, AQU_PUFF_X), read(2, AQU_PUFF_X + 1), read(2, AQU_PUFF_X + 2), read(2, AQU_PUFF_X + 3), dt);
  return group;
}

/** slot2[60..63] from the aquarium pack: x, y, z, strength of the puff where a fish was eaten. */
export const AQU_PUFF_X = 60;
const PUFF_BLOBS = 7;
/** Peak opacity of one puff blob: a soft tinge, not gore. */
export const PUFF_MAX_OPACITY = 0.32;

let puffTexture: THREE.Texture | null = null;
function softDotTexture(): THREE.Texture {
  if (puffTexture) return puffTexture;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * n + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  puffTexture = tex;
  return tex;
}

/**
 * A faint red cloud of a few soft sprites. It blooms where the pack says, drifts and spreads as the
 * strength fades, and is hidden when the strength is 0.
 */
export function buildEatPuff(): {
  root: THREE.Group;
  update: (x: number, y: number, z: number, strength: number, dt: number) => void;
} {
  const root = new THREE.Group();
  root.name = "aquarium-eat-puff";
  root.visible = false;
  const blobs: { s: THREE.Sprite; ox: number; oy: number; oz: number; r: number }[] = [];
  for (let i = 0; i < PUFF_BLOBS; i++) {
    const mat = new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: new THREE.Color(0.72, 0.1, 0.08),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 4;
    s.frustumCulled = false;
    const a = i * 2.39996;
    blobs.push({ s, ox: Math.cos(a) * 0.5, oy: ((i % 3) - 1) * 0.35, oz: Math.sin(a) * 0.5, r: 0.7 + (i % 4) * 0.15 });
    root.add(s);
  }
  let spread = 0;
  let last = 0;
  return {
    root,
    update(x, y, z, strength, dt) {
      const k = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
      if (k <= 0.001) {
        root.visible = false;
        spread = 0;
        last = 0;
        return;
      }
      // A new puff (strength jumped up from near zero) starts small again.
      if (last < 0.05 && k > last) spread = 0;
      last = k;
      spread = Math.min(1, spread + Math.max(0, dt) / 4);
      root.visible = true;
      root.position.set(x, y, z);
      const size = 0.07 + spread * 0.16;
      for (const b of blobs) {
        b.s.position.set(b.ox * size, b.oy * size + spread * 0.04, b.oz * size);
        b.s.scale.setScalar(size * b.r * 1.6);
        (b.s.material as THREE.SpriteMaterial).opacity = PUFF_MAX_OPACITY * k;
      }
    },
  };
}
