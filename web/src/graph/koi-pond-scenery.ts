/**
 * Koi pond host scenery: planar-reflective water, stone basin/kerb, fountain jet, and
 * bloom-driven lotus accents. Fish / pads / rocks stay as host-mesh GLB instances; this
 * group is parented via {@link HostMeshLane.setScenery} the same way aquarium glass is.
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

export function buildKoiPondScenery(): KoiPondScenery {
  const root = new THREE.Group();
  root.name = "koi-pond-scenery";

  const hemi = new THREE.HemisphereLight(0xcfefff, 0x3a4a38, 0.75);
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.15);
  sun.position.set(1.4, 2.8, 1.1);
  sun.target.position.set(0, 0, 0);
  root.add(hemi, sun, sun.target);

  const bed = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.08, 0.08, 48),
    new THREE.MeshStandardMaterial({ color: 0x2a3538, roughness: 0.92 }),
  );
  bed.position.y = -0.06;
  bed.name = "koi-basin-bed";
  root.add(bed);

  const kerbMat = new THREE.MeshStandardMaterial({ color: 0x6a6a68, roughness: 0.82 });
  const kerb = new THREE.Group();
  kerb.name = "koi-basin-kerb";
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), kerbMat);
    stone.position.set(Math.cos(a) * 1.02, 0.03, Math.sin(a) * 1.02);
    stone.scale.set(1.2, 0.7, 0.9);
    kerb.add(stone);
  }
  root.add(kerb);

  // Real planar reflection of rocks / fish / sky above the pond.
  const reflector = new Reflector(new THREE.CircleGeometry(0.98, 64), {
    clipBias: 0.003,
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x3a8a92,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = 0.008;
  reflector.name = "koi-water-reflector";
  root.add(reflector);

  // Transmissive tint layer so the water reads wet and ripples slightly (vertex bob).
  const tintMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a6a72,
    metalness: 0.02,
    roughness: 0.12,
    transmission: 0.35,
    thickness: 0.2,
    transparent: true,
    opacity: 0.45,
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
          "  transformed.y += 0.01 * (w1 * 0.6 + w2 * 0.4);",
          "}",
        ].join("\n"),
      );
  };
  tintMat.customProgramCacheKey = () => "zoto-koi-water-tint";
  const tint = new THREE.Mesh(new THREE.CircleGeometry(0.98, 64), tintMat);
  tint.rotation.x = -Math.PI / 2;
  tint.position.y = 0.012;
  tint.name = "koi-water-tint";
  tint.renderOrder = 2;
  root.add(tint);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.11, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.7 }),
  );
  pedestal.position.set(0, 0.1, 0);
  pedestal.name = "koi-fountain-pedestal";
  root.add(pedestal);

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.14, 0.04, 20),
    new THREE.MeshStandardMaterial({ color: 0x7a7a76, roughness: 0.65 }),
  );
  bowl.position.set(0, 0.2, 0);
  bowl.name = "koi-fountain-bowl";
  root.add(bowl);

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

  const lotusMat = new THREE.MeshStandardMaterial({
    color: 0xf2a0c0,
    emissive: 0x4a2030,
    emissiveIntensity: 0.25,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const lotuses: THREE.Mesh[] = [];
  const lotusPos = [
    [0.35, 0.35],
    [-0.4, 0.2],
    [0.15, -0.45],
    [-0.25, -0.3],
  ];
  for (let i = 0; i < lotusPos.length; i++) {
    const [x, z] = lotusPos[i]!;
    const flower = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 8), lotusMat.clone());
    flower.position.set(x, 0.04, z);
    flower.name = `koi-lotus-${i}`;
    flower.visible = false;
    root.add(flower);
    lotuses.push(flower);
  }

  const phases = Float32Array.from({ length: FOUNTAIN_DROPLETS }, (_, i) => i / FOUNTAIN_DROPLETS);

  const update = (read: SlotReader, dt: number): void => {
    uTime.value += Math.max(0, dt);
    const murk = read(0, 2);
    const clarity = read(0, 1);
    const bloomOn = read(0, 9);
    const lotusN = Math.max(0, Math.min(lotuses.length, Math.round(read(0, 7))));
    const traffic = read(0, 29);
    const bloom = bloomOn > 0.5 ? Math.max(0.15, Math.min(1, 0.35 + traffic)) : 0.08;

    tintMat.opacity = 0.3 + clarity * 0.25 - murk * 0.2;
    tintMat.color.setRGB(0.05 + murk * 0.08, 0.35 - murk * 0.15, 0.4 - murk * 0.1);

    for (let i = 0; i < lotuses.length; i++) {
      const m = lotuses[i]!;
      const on = i < lotusN;
      m.visible = on;
      if (!on) continue;
      const s = 0.55 + bloom * 0.9;
      m.scale.setScalar(s);
      m.position.y = 0.03 + bloom * 0.05;
      (m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + bloom * 0.45;
    }

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
