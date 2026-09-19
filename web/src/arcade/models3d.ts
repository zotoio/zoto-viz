import * as THREE from "three";

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 24, 18),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 14),
  torus: new THREE.TorusGeometry(1, 0.18, 14, 32),
  capsule: new THREE.CapsuleGeometry(0.45, 0.7, 8, 16),
  octa: new THREE.OctahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 1),
  plane: new THREE.PlaneGeometry(1, 1),
};

function mat(color: number, extras: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.18, ...extras });
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

function hexOf(n: number): number {
  return n & 0xffffff;
}

/** Beveled crate / panel with a darker inset frame. */
export function makePanel(w: number, h: number, d: number, fill: number, frame = 0x1a1c22): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.box, mat(hexOf(fill), { roughness: 0.55 }), 0, 0, 0, w, h, d));
  const t = Math.min(w, h, d) * 0.08;
  const rim = mat(hexOf(frame), { roughness: 0.35, metalness: 0.4 });
  g.add(mesh(geo.box, rim, 0, h / 2, 0, w + t, t, d + t));
  g.add(mesh(geo.box, rim, 0, -h / 2, 0, w + t, t, d + t));
  g.add(mesh(geo.box, rim, w / 2, 0, 0, t, h, d + t));
  g.add(mesh(geo.box, rim, -w / 2, 0, 0, t, h, d + t));
  return g;
}

export function makeLighthouse(color: number): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0x6d6458, { roughness: 0.8 });
  const band = mat(hexOf(color), { roughness: 0.4 });
  const metal = mat(0xb0bec5, { metalness: 0.7, roughness: 0.25 });
  g.add(mesh(geo.cyl, stone, 0, 0.35, 0, 1.6, 0.7, 1.6));
  g.add(mesh(geo.cyl, band, 0, 2.1, 0, 0.85, 2.8, 0.85));
  g.add(mesh(geo.cyl, stone, 0, 3.6, 0, 0.95, 0.35, 0.95));
  g.add(mesh(geo.cyl, metal, 0, 4.15, 0, 0.72, 0.7, 0.72));
  const lamp = mesh(geo.sphere, mat(0xfff3c4, { emissive: hexOf(color), emissiveIntensity: 0.85, roughness: 0.2 }), 0, 4.2, 0, 0.42, 0.42, 0.42);
  lamp.castShadow = false;
  g.add(lamp);
  g.add(mesh(geo.cone, mat(0x3e2723, { roughness: 0.55 }), 0, 4.85, 0, 0.85, 0.7, 0.85));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(geo.box, metal, Math.cos(a) * 0.95, 3.7, Math.sin(a) * 0.95, 0.08, 0.55, 0.08));
  }
  return g;
}

export function makeShip(color: number): THREE.Group {
  const g = new THREE.Group();
  const hull = mat(hexOf(color), { roughness: 0.4, metalness: 0.25 });
  const deck = mat(0xd7ccc8, { roughness: 0.6 });
  const cabin = mat(0xeceff1, { roughness: 0.35 });
  g.add(mesh(geo.box, hull, 0, 0.35, 0, 2.8, 0.55, 1.05));
  g.add(mesh(geo.box, hull, 1.15, 0.28, 0, 0.9, 0.38, 0.7));
  g.add(mesh(geo.box, deck, 0, 0.68, 0, 2.4, 0.08, 0.9));
  g.add(mesh(geo.box, cabin, -0.15, 1.05, 0, 1.1, 0.7, 0.75));
  g.add(mesh(geo.cyl, mat(0x37474f, { metalness: 0.5 }), 0.55, 1.55, 0, 0.08, 1.1, 0.08));
  g.add(mesh(geo.box, mat(0x90a4ae), 0.55, 2.05, 0, 0.55, 0.08, 0.12));
  g.add(mesh(geo.sphere, mat(0xffcc80, { emissive: 0xff9800, emissiveIntensity: 0.5 }), 1.45, 0.55, 0, 0.1, 0.1, 0.1));
  return g;
}

export function makeBuoy(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.sphere, mat(hexOf(color), { roughness: 0.35 }), 0, 0.45, 0, 0.55, 0.45, 0.55));
  g.add(mesh(geo.cyl, mat(0xeeeeee), 0, 1.05, 0, 0.08, 0.9, 0.08));
  g.add(mesh(geo.sphere, mat(0xfff8e1, { emissive: hexOf(color), emissiveIntensity: 0.9 }), 0, 1.55, 0, 0.14, 0.14, 0.14));
  g.add(mesh(geo.cone, mat(0xfafafa), 0, 0.15, 0, 0.2, 0.35, 0.2));
  return g;
}

export function makeIsland(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.sphere, mat(0x5d4037, { roughness: 0.9 }), 0, -0.2, 0, 2.2, 0.7, 1.8));
  g.add(mesh(geo.sphere, mat(0x66bb6a, { roughness: 0.75 }), 0, 0.35, 0, 1.6, 0.55, 1.3));
  g.add(mesh(geo.cone, mat(0x2e7d32, { roughness: 0.7 }), 0.35, 1.1, 0.1, 0.45, 1.2, 0.45));
  g.add(mesh(geo.cyl, mat(0x6d4c41), 0.35, 0.45, 0.1, 0.1, 0.5, 0.1));
  g.add(mesh(geo.box, mat(hexOf(color), { roughness: 0.5 }), -0.55, 0.55, 0.2, 0.45, 0.4, 0.4));
  return g;
}

export function makeSatellite(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = mat(hexOf(color), { metalness: 0.55, roughness: 0.28 });
  const gold = mat(0xffd54f, { metalness: 0.7, roughness: 0.2 });
  const dark = mat(0x263238, { metalness: 0.4, roughness: 0.4 });
  g.add(mesh(geo.box, body, 0, 0, 0, 0.7, 0.55, 0.55));
  g.add(mesh(geo.box, gold, 1.05, 0, 0, 1.15, 0.04, 0.55));
  g.add(mesh(geo.box, gold, -1.05, 0, 0, 1.15, 0.04, 0.55));
  g.add(mesh(geo.box, dark, 1.05, 0.04, 0, 1.05, 0.01, 0.48));
  g.add(mesh(geo.box, dark, -1.05, 0.04, 0, 1.05, 0.01, 0.48));
  const dish = mesh(geo.sphere, mat(0xeceff1, { metalness: 0.3, roughness: 0.25, side: THREE.DoubleSide }), 0, 0.15, 0.42, 0.32, 0.32, 0.12);
  g.add(dish);
  g.add(mesh(geo.cyl, mat(0x90a4ae, { metalness: 0.6 }), 0, 0.15, 0.58, 0.02, 0.28, 0.02));
  g.add(mesh(geo.cyl, mat(0xb0bec5, { metalness: 0.5 }), 0, 0.55, 0, 0.03, 0.45, 0.03));
  return g;
}

export function makePlanet(color: number, ring = false): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.sphere, mat(hexOf(color), { roughness: 0.55, metalness: 0.08 }), 0, 0, 0, 1, 1, 1));
  g.add(mesh(geo.sphere, mat(hexOf(color), { roughness: 0.2, transparent: true, opacity: 0.18, emissive: hexOf(color), emissiveIntensity: 0.2 }), 0, 0, 0, 1.12, 1.12, 1.12));
  if (ring) {
    const r = mesh(geo.torus, mat(0xffe082, { metalness: 0.3, roughness: 0.4, transparent: true, opacity: 0.75 }), 0, 0, 0, 1.7, 1.7, 1.7);
    r.rotation.x = Math.PI / 2.4;
    g.add(r);
  }
  return g;
}

export function makeSun(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.sphere, mat(hexOf(color), { emissive: hexOf(color), emissiveIntensity: 1.1, roughness: 0.3 }), 0, 0, 0, 2.2, 2.2, 2.2));
  const corona = mesh(geo.sphere, mat(0xffecb3, { transparent: true, opacity: 0.22, emissive: 0xffc107, emissiveIntensity: 0.6 }), 0, 0, 0, 3.1, 3.1, 3.1);
  corona.castShadow = false;
  g.add(corona);
  return g;
}

export function makeNucleotide(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.ico, mat(hexOf(color), { roughness: 0.3, metalness: 0.2 }), 0, 0, 0, 0.7, 0.7, 0.7));
  const bar = mesh(geo.cyl, mat(0xeeeeee, { metalness: 0.15 }), 0.7, 0, 0, 0.12, 0.9, 0.12);
  bar.rotation.z = Math.PI / 2;
  g.add(bar);
  g.add(mesh(geo.octa, mat(0xf5f5f5, { roughness: 0.25 }), 1.15, 0, 0, 0.28, 0.28, 0.28));
  return g;
}

export function makeBuilding(color: number, floors: number): THREE.Group {
  const g = new THREE.Group();
  const h = Math.max(1.2, floors);
  const body = mat(hexOf(color), { roughness: 0.42, metalness: 0.22 });
  g.add(mesh(geo.box, body, 0, h / 2, 0, 1.15, h, 1.15));
  g.add(mesh(geo.box, mat(0x263238, { metalness: 0.4 }), 0, h + 0.08, 0, 1.25, 0.16, 1.25));
  const glass = mat(0xb3e5fc, { emissive: 0x4fc3f7, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.4 });
  const rows = Math.max(2, Math.min(10, Math.round(h)));
  for (let i = 0; i < rows; i++) {
    const y = 0.35 + (i / rows) * (h - 0.5);
    g.add(mesh(geo.box, glass, 0.58, y, 0.28, 0.04, 0.18, 0.22));
    g.add(mesh(geo.box, glass, 0.58, y, -0.28, 0.04, 0.18, 0.22));
    g.add(mesh(geo.box, glass, -0.58, y, 0.2, 0.04, 0.18, 0.22));
  }
  g.add(mesh(geo.cyl, mat(0x90a4ae, { metalness: 0.5 }), 0.28, h + 0.45, 0.28, 0.05, 0.55, 0.05));
  return g;
}

export function makePacman(color = 0xffee58): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.sphere, mat(color, { roughness: 0.35, metalness: 0.05 }), 0, 0.45, 0, 0.45, 0.45, 0.45));
  const mouth = mesh(geo.cone, mat(0x3e2723, { roughness: 0.6 }), 0.28, 0.42, 0, 0.28, 0.42, 0.28);
  mouth.rotation.z = -Math.PI / 2;
  g.add(mouth);
  g.add(mesh(geo.sphere, mat(0x212121), 0.18, 0.68, 0.18, 0.08, 0.08, 0.08));
  g.add(mesh(geo.sphere, mat(0x212121), 0.18, 0.68, -0.18, 0.08, 0.08, 0.08));
  return g;
}

export function makeGhost(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.capsule, mat(hexOf(color), { roughness: 0.4 }), 0, 0.7, 0, 1, 1, 1));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(mesh(geo.sphere, mat(hexOf(color)), Math.cos(a) * 0.32, 0.18, Math.sin(a) * 0.32, 0.16, 0.2, 0.16));
  }
  const eye = mat(0xfafafa);
  const pupil = mat(0x1565c0);
  g.add(mesh(geo.sphere, eye, 0.18, 0.95, 0.16, 0.12, 0.14, 0.1));
  g.add(mesh(geo.sphere, eye, 0.18, 0.95, -0.16, 0.12, 0.14, 0.1));
  g.add(mesh(geo.sphere, pupil, 0.26, 0.95, 0.16, 0.06, 0.06, 0.06));
  g.add(mesh(geo.sphere, pupil, 0.26, 0.95, -0.16, 0.06, 0.06, 0.06));
  return g;
}

export function makePellet(color = 0xfff8e1): THREE.Mesh {
  return mesh(geo.sphere, mat(color, { emissive: 0xffecb3, emissiveIntensity: 0.5 }), 0, 0.22, 0, 0.12, 0.12, 0.12);
}

export function makeTetBlock(color: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.box, mat(hexOf(color), { roughness: 0.32, metalness: 0.15 }), 0, 0, 0, 0.92, 0.92, 0.92));
  g.add(mesh(geo.box, mat(0xffffff, { transparent: true, opacity: 0.18 }), 0, 0.08, 0, 0.7, 0.7, 0.7));
  return g;
}

export function makePortalRing(color: number): THREE.Group {
  const g = new THREE.Group();
  const glow = mat(hexOf(color), { emissive: hexOf(color), emissiveIntensity: 0.95, roughness: 0.2, metalness: 0.3 });
  g.add(mesh(geo.torus, glow, 0, 0, 0, 1.35, 1.35, 1.35));
  const inner = mesh(geo.plane, new THREE.MeshStandardMaterial({
    color: hexOf(color), emissive: hexOf(color), emissiveIntensity: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  }), 0, 0, 0, 2.2, 2.2, 1);
  g.add(inner);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(mesh(geo.sphere, glow, Math.cos(a) * 1.35, Math.sin(a) * 1.35, 0, 0.08, 0.08, 0.08));
  }
  return g;
}

export function makeCompanionCube(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(geo.box, mat(0xcfd8dc, { roughness: 0.4, metalness: 0.15 }), 0, 0, 0, 1, 1, 1));
  const pink = mat(0xf48fb1, { emissive: 0xad1457, emissiveIntensity: 0.35 });
  for (const [x, y, z] of [[0.51, 0, 0], [-0.51, 0, 0], [0, 0.51, 0], [0, -0.51, 0], [0, 0, 0.51], [0, 0, -0.51]] as const) {
    const heart = mesh(geo.sphere, pink, x, y, z, 0.16, 0.14, 0.08);
    g.add(heart);
  }
  const edge = mat(0x455a64, { metalness: 0.45, roughness: 0.3 });
  for (const s of [-0.5, 0.5]) {
    g.add(mesh(geo.box, edge, s, 0, 0, 0.06, 1.02, 1.02));
    g.add(mesh(geo.box, edge, 0, s, 0, 1.02, 0.06, 1.02));
    g.add(mesh(geo.box, edge, 0, 0, s, 1.02, 1.02, 0.06));
  }
  return g;
}

export function makeTurret(color: number): THREE.Group {
  const g = new THREE.Group();
  const steel = mat(0x90a4ae, { metalness: 0.65, roughness: 0.28 });
  g.add(mesh(geo.cyl, steel, 0.28, 0.25, 0.22, 0.07, 0.7, 0.07));
  g.add(mesh(geo.cyl, steel, -0.28, 0.25, 0.22, 0.07, 0.7, 0.07));
  g.add(mesh(geo.cyl, steel, 0, 0.25, -0.3, 0.07, 0.7, 0.07));
  g.add(mesh(geo.sphere, mat(hexOf(color), { roughness: 0.35 }), 0, 0.85, 0, 0.42, 0.38, 0.42));
  const barrel = mesh(geo.cyl, steel, 0.45, 0.85, 0, 0.08, 0.55, 0.08);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  g.add(mesh(geo.sphere, mat(0xff1744, { emissive: 0xff1744, emissiveIntensity: 0.8 }), 0.18, 0.95, 0.28, 0.07, 0.07, 0.07));
  return g;
}

export function makeEnergyOrb(color: number): THREE.Mesh {
  return mesh(geo.sphere, mat(hexOf(color), { emissive: hexOf(color), emissiveIntensity: 0.9, roughness: 0.15 }), 0, 0, 0, 0.22, 0.22, 0.22);
}

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}
