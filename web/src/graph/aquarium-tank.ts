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
  return group;
}
