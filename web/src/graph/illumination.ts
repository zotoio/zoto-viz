import * as THREE from "three";

/**
 * Real-time stand-in for global illumination on the graph:
 * a hemisphere (sky above, ground below) plus a dim directional bounce.
 * The key and fill are directional lights that orbit. Two point lights
 * travel on their own paths so the cloud is not lit from one frozen angle.
 * All of it is a smooth function of time — no per-frame snap.
 */

export type Vec3 = { x: number; y: number; z: number };

export type IlluminationPose = {
  key: Vec3;
  fill: Vec3;
  bounce: Vec3;
  warm: Vec3;
  cool: Vec3;
};

function orbit(t: number, radius: number, y: number, yAmp: number, phase: number): Vec3 {
  return {
    x: Math.cos(t + phase) * radius,
    y: y + Math.sin(t * 0.5 + phase) * yAmp,
    z: Math.sin(t + phase) * radius,
  };
}

/** Light positions in world units. The graph sits near the origin. */
export function illuminationPose(timeSec: number): IlluminationPose {
  const keyT = timeSec * (Math.PI * 2 / 34);
  const fillT = timeSec * (Math.PI * 2 / 48);
  const bounceT = timeSec * (Math.PI * 2 / 58);
  const warmT = timeSec * (Math.PI * 2 / 21);
  const coolT = timeSec * (Math.PI * 2 / 27);
  return {
    key: orbit(keyT, 440, 320, 90, 0.4),
    fill: orbit(fillT, 380, 140, 70, 2.4),
    bounce: {
      x: Math.sin(bounceT) * 240,
      y: -280 + Math.sin(bounceT * 0.5) * 30,
      z: Math.cos(bounceT) * 200,
    },
    warm: orbit(warmT, 260, 50, 110, 0.2),
    cool: orbit(coolT, 300, -20, 90, 1.8),
  };
}

const _sky = new THREE.Color();
const _ground = new THREE.Color();
const _white = new THREE.Color(0xffffff);
const _soil = new THREE.Color(0x1a120c);

export class GraphIllumination {
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly fill: THREE.DirectionalLight;
  readonly bounce: THREE.DirectionalLight;
  readonly warm: THREE.PointLight;
  readonly cool: THREE.PointLight;

  constructor(scene: THREE.Scene, rimHex: number) {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x1a140e, 0.46);
    this.key = new THREE.DirectionalLight(0xfff6ee, 1.25);
    this.fill = new THREE.DirectionalLight(rimHex, 0.42);
    this.bounce = new THREE.DirectionalLight(0xffc9a0, 0.28);
    this.warm = new THREE.PointLight(0xffb080, 3600, 0, 1.2);
    this.cool = new THREE.PointLight(rimHex, 2800, 0, 1.2);
    scene.add(this.hemi, this.key, this.fill, this.bounce, this.warm, this.cool);
    this.setRim(rimHex);
    this.step(0);
  }

  /** Sky tint follows the theme rim. Ground bounce stays warm and dark. */
  setRim(hex: number): void {
    _sky.setHex(hex).lerp(_white, 0.62);
    this.hemi.color.copy(_sky);
    _ground.setHex(hex).lerp(_soil, 0.72);
    this.hemi.groundColor.copy(_ground);
    this.fill.color.setHex(hex);
    this.cool.color.setHex(hex);
  }

  step(timeSec: number): void {
    const p = illuminationPose(timeSec);
    this.key.position.set(p.key.x, p.key.y, p.key.z);
    this.fill.position.set(p.fill.x, p.fill.y, p.fill.z);
    this.bounce.position.set(p.bounce.x, p.bounce.y, p.bounce.z);
    this.warm.position.set(p.warm.x, p.warm.y, p.warm.z);
    this.cool.position.set(p.cool.x, p.cool.y, p.cool.z);
  }
}
