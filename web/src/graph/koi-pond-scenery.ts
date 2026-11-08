/**
 * Koi pond host scenery: planar-reflective water + fountain jet over the Blender
 * scape (plugins/src/koi-pond/assets/koi-pond-scape.glb). The scape is pinned as
 * host-mesh asset 0 (basin, kerb, substrate, fountain, flowering lilies, rocks);
 * this group finds it under the lane — same pattern as aquarium glass/caustics.
 */
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

export type SlotReader = (slot: number, index: number) => number;

export type KoiPondScenery = {
  root: THREE.Object3D;
  update(read: SlotReader, dt: number): void;
};

const FOUNTAIN_DROPLETS = 48;
const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

function patchVertexColors(root: THREE.Object3D): void {
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      if (!m || m.vertexColors) continue;
      m.vertexColors = true;
      m.needsUpdate = true;
    }
  });
}

export function buildKoiPondScenery(): KoiPondScenery {
  const root = new THREE.Group();
  root.name = "koi-pond-scenery";

  const hemi = new THREE.HemisphereLight(0xcfefff, 0x3a4a38, 0.75);
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
  sun.position.set(1.4, 2.8, 1.1);
  sun.target.position.set(0, 0, 0);
  root.add(hemi, sun, sun.target);

  // Planar reflection of the Blender scape / fish / sky.
  /** Irregular shoreline polygon — avoids a hard circular hoop from above. */
  const waterShape = (() => {
    const s = new THREE.Shape();
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 0.92 + 0.10 * Math.sin(a * 3.0) + 0.06 * Math.cos(a * 5.0) + 0.04 * Math.sin(a * 7.0 + 0.6);
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    return s;
  })();
  const waterGeo = new THREE.ShapeGeometry(waterShape, 48);

  // Reflections of bank/fish/sky — irregular edge, no torus kerb.
  const reflector = new Reflector(waterGeo.clone(), {
    clipBias: 0.002,
    textureWidth: 2048,
    textureHeight: 2048,
    color: 0x2a6a72,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = 0.006;
  reflector.name = "koi-water-reflector";
  reflector.renderOrder = 3;
  root.add(reflector);

  const tintMat = new THREE.MeshPhysicalMaterial({
    color: 0x146068,
    metalness: 0.04,
    roughness: 0.06,
    transmission: 0.55,
    thickness: 0.35,
    ior: 1.333,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const uTime = { value: 0 };
  tintMat.onBeforeCompile = (shader) => {
    shader.uniforms.uKoiTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uKoiTime;")
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "{",
          "  float w1 = sin(transformed.x * 9.0 + uKoiTime * 1.6);",
          "  float w2 = sin(transformed.z * 11.0 - uKoiTime * 1.3);",
          "  transformed.y += 0.016 * (w1 * 0.55 + w2 * 0.45);",
          "}",
        ].join("\n"),
      );
  };
  tintMat.customProgramCacheKey = () => "zoto-koi-water-tint-irregular";
  // ShapeGeometry already in XY; rotate flat onto XZ like the reflector.
  const tint = new THREE.Mesh(waterGeo, tintMat);
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.012;
  tint.name = "koi-water-tint";
  tint.renderOrder = 2;
  root.add(tint);

  const dropGeo = new THREE.SphereGeometry(0.012, 6, 4);
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.75,
    roughness: 0.05,
    transmission: 0.45,
    depthWrite: false,
  });
  const jet = new THREE.InstancedMesh(dropGeo, dropMat, FOUNTAIN_DROPLETS);
  jet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  jet.frustumCulled = false;
  jet.count = FOUNTAIN_DROPLETS;
  jet.name = "koi-fountain-jet";
  root.add(jet);

  const phases = Float32Array.from({ length: FOUNTAIN_DROPLETS }, (_, i) => i / FOUNTAIN_DROPLETS);

  let lane: THREE.Object3D | null = null;
  let scapeReady = false;

  const findScape = (): void => {
    const parent = root.parent;
    if (!parent) return;
    if (scapeReady && lane === parent) return;
    lane = parent;
    let found = false;
    lane.traverse((o) => {
      if (o === root || root.children.includes(o)) return;
      const n = o.name || "";
      if (
        n === "substrate" ||
        n === "basin-kerb" ||
        n === "bank-stones" ||
        n === "fountain" ||
        n === "pond-rocks" ||
        n.startsWith("lily-pad") ||
        n.startsWith("lotus-bloom") ||
        n === "koi-pond-scape"
      ) {
        found = true;
        patchVertexColors(o);
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            const m = mat as THREE.MeshStandardMaterial;
            if (!m) continue;
            m.transparent = true;
            m.depthTest = true;
            m.depthWrite = true;
            m.needsUpdate = true;
          }
          mesh.renderOrder = 3;
        }
      }
    });
    scapeReady = found;
  };

  const update = (read: SlotReader, dt: number): void => {
    uTime.value += Math.max(0, dt);
    findScape();
    const murk = read(0, 2);
    const clarity = read(0, 1);

    tintMat.opacity = 0.3 + clarity * 0.25 - murk * 0.2;
    tintMat.color.setRGB(0.05 + murk * 0.08, 0.35 - murk * 0.15, 0.4 - murk * 0.1);

    const t = uTime.value;
    for (let i = 0; i < FOUNTAIN_DROPLETS; i++) {
      const u = (phases[i]! + t * 0.35) % 1;
      const ang = (i / FOUNTAIN_DROPLETS) * Math.PI * 2 + t * 0.4;
      const h = u * 0.55;
      const rad = 0.02 + u * u * 0.18;
      _pos.set(Math.cos(ang) * rad, 0.22 + h, Math.sin(ang) * rad);
      _scl.setScalar(0.7 + (1 - u) * 0.8);
      _quat.identity();
      _m4.compose(_pos, _quat, _scl);
      jet.setMatrixAt(i, _m4);
    }
    jet.instanceMatrix.needsUpdate = true;
  };

  root.userData.onSlots = (read: SlotReader, dt: number) => update(read, dt);
  return { root, update };
}
