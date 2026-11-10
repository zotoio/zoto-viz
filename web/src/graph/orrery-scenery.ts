import * as THREE from "three";

/**
 * Orrery host scenery: the study lights, the turning gear train, and instanced arms, planets and
 * sparks. The desk, the machine and the planet templates are the pack's three GLBs on the host
 * mesh lane (pinned at the origin); this scenery finds their named nodes, turns the gears from
 * viz slot 0, instances one arm + planet per slot-1 row and draws slot 2..3 sparks as points.
 * HD reflections come from the pack's `role: environment` image (host-mesh-env).
 * Nothing is allocated per frame.
 */

/** slot0 indices (plugins/src/orrery/frontend/orrery.ts OR_SLOT). */
const S_FAILED = 9;
const S_SUN = 16;
const S_SPARKS = 19;
const S_LOW_FPS = 22;
const S_LAMP = 23;
const GEARS: readonly [string, number][] = [
  ["gear-crown", 13], ["gear-2", 14], ["gear-3", 15], ["escape-wheel", 10], ["anchor", 11], ["balance", 12],
];
const ARM_SLOT = 1;
const ARM_FLOATS = 8;
export const ORRERY_MAX_ARMS = 8;
const SPARK_SLOT0 = 2;
const SPARKS_PER_SLOT = 16;
export const ORRERY_MAX_SPARKS = 32;
const ARM_PARTS = ["arm-hub", "arm-bar", "arm-post", "arm-cup"] as const;
export const ORRERY_PLANET_TYPES = 7;
/** Arm geometry shared with blender/build_orrery.py: bar half-height and post height (m). */
const BAR_TOP = 0.00175;
const POST_H = 0.026;
const PLANET_TILT = 0.41;

export type SlotReader = (slot: number, index: number) => number;

export type OrreryScenery = {
  root: THREE.Group;
  update(read: SlotReader, dt: number): void;
  /** Bound to the lane's GLB nodes (tests). */
  readonly bound: boolean;
  readonly planetCount: number;
  readonly sparkCount: number;
};

type Part = { mesh: THREE.InstancedMesh; rel: THREE.Matrix4 };

/** Every mesh under `node`, with its matrix relative to `node` (gltfpack puts dequantisation there). */
function partsOf(node: THREE.Object3D, cap: number, name: string): Part[] {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const out: Part[] = [];
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mesh = new THREE.InstancedMesh(m.geometry, m.material, cap);
    mesh.name = `${name}-instances`;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    out.push({ mesh, rel: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  return out;
}

function sparkSprite(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - (n - 1) / 2, y - (n - 1) / 2) / (n / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * n + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.pow(a, 2.2));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export function buildOrreryScenery(): OrreryScenery {
  const root = new THREE.Group();
  root.name = "orrery-scenery";

  // study light: the banker's lamp (warm, right), a cool window fill, a rim, the sun's own glow
  const hemi = new THREE.HemisphereLight(0xffe4c4, 0x1d130b, 0.5);
  const key = new THREE.DirectionalLight(0xffd3a0, 1.7);
  key.position.set(0.95, 0.95, 0.15);
  key.target.position.set(0, 0.2, 0);
  const lamp = new THREE.PointLight(0xffc58a, 1.4, 3.5, 1.4);
  lamp.position.set(0.92, 0.39, -0.22);
  const fill = new THREE.DirectionalLight(0x9fb6da, 0.35);
  fill.position.set(-1.3, 0.8, 1.4);
  const rim = new THREE.DirectionalLight(0xc0ccff, 0.55);
  rim.position.set(-0.7, 1.0, -1.5);
  const sunLight = new THREE.PointLight(0xffcf8a, 0.5, 1.0, 2);
  sunLight.position.set(0, 0.4, 0);
  root.add(hemi, key, key.target, lamp, fill, rim, sunLight);

  const sparkPos = new Float32Array(ORRERY_MAX_SPARKS * 3);
  const sparkCol = new Float32Array(ORRERY_MAX_SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setDrawRange(0, 0);
  const sprite = sparkSprite();
  const sparkMat = new THREE.PointsMaterial({
    size: 0.012, sizeAttenuation: true, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.name = "orrery-sparks";
  sparks.frustumCulled = false;
  sparks.renderOrder = 5;
  root.add(sparks);

  const instances = new THREE.Group();
  instances.name = "orrery-instances";
  root.add(instances);

  let anchorNode: THREE.Object3D | null = null;
  const gears: { node: THREE.Object3D; rest: THREE.Quaternion; slot: number }[] = [];
  const armParts: Part[][] = [];
  const planetParts: Part[][] = [];
  let sunMat: THREE.MeshStandardMaterial | null = null;
  let sunBase = 1;
  let shadeMat: THREE.MeshStandardMaterial | null = null;
  let shadeBase = 0.35;
  let planets = 0;
  let sparkCount = 0;

  const m4 = new THREE.Matrix4();
  const arm = new THREE.Matrix4();
  const tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const qy = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const white = new THREE.Color(1, 1, 1);
  const perType = new Uint8Array(ORRERY_PLANET_TYPES);

  const unbind = (): void => {
    for (const c of [...instances.children]) {
      instances.remove(c);
      (c as THREE.InstancedMesh).dispose();
    }
    armParts.length = 0;
    planetParts.length = 0;
    gears.length = 0;
    anchorNode = null;
    sunMat = null;
    shadeMat = null;
  };

  const attached = (o: THREE.Object3D | null, lane: THREE.Object3D): boolean => {
    let p = o;
    while (p && p !== lane) p = p.parent;
    return p === lane;
  };

  let boundChildren = -1;
  /** Find the pinned GLB nodes. The three GLBs land one by one and the lane re-pins (new clones) on
   *  remount, so rebind whenever the lane's children change. */
  const bind = (): boolean => {
    const lane = root.parent;
    if (!lane) return false;
    if (anchorNode && attached(anchorNode, lane) && lane.children.length === boundChildren) return true;
    if (anchorNode) unbind();
    boundChildren = lane.children.length;
    const named = new Map<string, THREE.Object3D>();
    for (const child of lane.children) {
      if (child === root) continue;
      child.traverse((o) => { if (o.name && !named.has(o.name)) named.set(o.name, o); });
    }
    const esc = named.get("escape-wheel");
    const hub = named.get("arm-hub");
    if (!esc || !hub) return false;
    for (const [name, slot] of GEARS) {
      const node = named.get(name);
      if (!node) continue;
      node.userData.orreryRest ??= node.quaternion.clone();
      gears.push({ node, rest: node.userData.orreryRest as THREE.Quaternion, slot });
    }
    for (const name of ARM_PARTS) {
      const node = named.get(name);
      armParts.push(node ? partsOf(node, ORRERY_MAX_ARMS, name) : []);
      if (node) node.visible = false;
    }
    for (let k = 0; k < ORRERY_PLANET_TYPES; k++) {
      const node = named.get(`planet-${k}`);
      planetParts.push(node ? partsOf(node, ORRERY_MAX_ARMS, `planet-${k}`) : []);
      if (node) node.visible = false;
    }
    for (const list of [...armParts, ...planetParts]) for (const p of list) instances.add(p.mesh);
    const sunMesh = named.get("sun");
    sunMesh?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "emissiveIntensity" in m && !sunMat) { sunMat = m; sunBase = m.emissiveIntensity || 1; }
    });
    // the sun glows from its emissive map; the study lights alone would clip its pale texture to white
    if (sunMat && !(sunMat as THREE.MeshStandardMaterial).userData.orrerySun) {
      (sunMat as THREE.MeshStandardMaterial).color.multiplyScalar(0.35);
      (sunMat as THREE.MeshStandardMaterial).userData.orrerySun = true;
    }
    named.get("lamp-shade")?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "emissiveIntensity" in m && !shadeMat) { shadeMat = m; shadeBase = m.emissiveIntensity || 0.35; }
    });
    anchorNode = esc;
    return true;
  };

  const place = (part: Part, i: number, base: THREE.Matrix4): void => {
    tmp.multiplyMatrices(base, part.rel);
    part.mesh.setMatrixAt(i, tmp);
  };

  const update = (read: SlotReader, dt: number): void => {
    void dt;
    const ok = bind();
    if (ok) {
      for (const g of gears) {
        qy.setFromAxisAngle(yAxis, read(0, g.slot) || 0);
        g.node.quaternion.copy(g.rest).multiply(qy);
      }
      let nArms = 0;
      perType.fill(0);
      for (let k = 0; k < ORRERY_MAX_ARMS; k++) {
        const o = k * ARM_FLOATS;
        if (read(ARM_SLOT, o + 6) < 0.5) continue;
        const angle = read(ARM_SLOT, o), radius = read(ARM_SLOT, o + 1), hub = read(ARM_SLOT, o + 2);
        const type = Math.round(read(ARM_SLOT, o + 3));
        const size = read(ARM_SLOT, o + 4), spin = read(ARM_SLOT, o + 5), flash = read(ARM_SLOT, o + 7);
        if (!(radius > 0)) continue;
        q.setFromAxisAngle(yAxis, angle);
        arm.compose(v3.set(0, hub, 0), q, s3.set(1, 1, 1));
        for (const p of armParts[0] ?? []) place(p, nArms, arm);
        m4.makeScale(radius, 1, 1).premultiply(arm);
        for (const p of armParts[1] ?? []) place(p, nArms, m4);
        m4.makeTranslation(radius, BAR_TOP, 0).premultiply(arm);
        for (const p of armParts[2] ?? []) place(p, nArms, m4);
        m4.makeTranslation(radius, BAR_TOP + POST_H - 0.001, 0).premultiply(arm);
        for (const p of armParts[3] ?? []) place(p, nArms, m4);
        nArms++;
        if (type < 0 || type >= ORRERY_PLANET_TYPES || !(size > 0.0005)) continue;
        const list = planetParts[type];
        if (!list?.length) continue;
        const i = perType[type]!;
        e.set(0, spin, PLANET_TILT, "ZYX");
        q.setFromEuler(e);
        m4.compose(v3.set(radius, BAR_TOP + POST_H + size, 0), q, s3.setScalar(size)).premultiply(arm);
        col.copy(white).multiplyScalar(1 + 0.35 * Math.max(0, Math.min(1, flash)));
        for (const p of list) {
          place(p, i, m4);
          p.mesh.setColorAt(i, col);
        }
        perType[type] = i + 1;
      }
      for (const list of armParts) for (const p of list) { p.mesh.count = nArms; p.mesh.instanceMatrix.needsUpdate = true; }
      planets = 0;
      for (let t = 0; t < planetParts.length; t++) {
        for (const p of planetParts[t]!) {
          p.mesh.count = perType[t]!;
          p.mesh.instanceMatrix.needsUpdate = true;
          if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
        }
        planets += perType[t]!;
      }
      const glow = Math.max(0, Math.min(1.5, read(0, S_SUN) || 0.8));
      if (sunMat) (sunMat as THREE.MeshStandardMaterial).emissiveIntensity = sunBase * (0.3 + 0.35 * glow);
      sunLight.intensity = 0.55 * glow;
      const lampLevel = Math.max(0, Math.min(1.2, read(0, S_LAMP) || 0.7));
      if (shadeMat) (shadeMat as THREE.MeshStandardMaterial).emissiveIntensity = shadeBase * (0.5 + lampLevel);
      lamp.intensity = 0.6 + 1.6 * lampLevel;
      key.intensity = 0.9 + 1.2 * lampLevel;
      hemi.intensity = read(0, S_FAILED) > 0.5 ? 0.42 : 0.5;
    }
    // sparks: x, y, z, look = round(hue * 255) + intensity
    const n = Math.max(0, Math.min(ORRERY_MAX_SPARKS, Math.round(read(0, S_SPARKS))));
    const show = read(0, S_LOW_FPS) === 1 ? Math.min(n, 12) : n;
    for (let i = 0; i < show; i++) {
      const slot = SPARK_SLOT0 + Math.floor(i / SPARKS_PER_SLOT);
      const o = (i % SPARKS_PER_SLOT) * 4;
      sparkPos[i * 3] = read(slot, o); sparkPos[i * 3 + 1] = read(slot, o + 1); sparkPos[i * 3 + 2] = read(slot, o + 2);
      const look = read(slot, o + 3);
      const k = Math.floor(look);
      col.setHSL(k / 255, 0.85, 0.62).multiplyScalar(Math.max(0, look - k) * 1.6);
      sparkCol[i * 3] = col.r; sparkCol[i * 3 + 1] = col.g; sparkCol[i * 3 + 2] = col.b;
    }
    sparkCount = show;
    sparkGeo.setDrawRange(0, show);
    (sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };

  root.userData.onSlots = update;
  // instanced arms and planets share the lane's template geometry and materials: detach them
  // so the lane's dispose walk frees those once, with the templates, not through this scenery
  root.userData.dispose = () => {
    unbind();
    sparkGeo.dispose(); sparkMat.dispose(); sprite.dispose();
  };
  return {
    root,
    update,
    get bound() { return anchorNode !== null; },
    get planetCount() { return planets; },
    get sparkCount() { return sparkCount; },  };
}
