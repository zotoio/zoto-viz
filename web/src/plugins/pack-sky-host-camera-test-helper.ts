/**
 * Test-only helpers for rendering shipped pack skies the way the host frames them.
 *
 * `smokeRenderPluginSky` draws a camera-local ray `normalize(vec3(ndc, -1))` over a
 * 90 degree view. These helpers rewrite the pack's single `normalize(vDir)` so the
 * ray first spans the host stage camera (scene.ts baseFov 55 at 16:10: tan 27.5 =
 * 0.52 vertical, 0.83 horizontal) and then goes through a 3x3 camera-to-dome matrix.
 *
 * - {@link parentedSkyRay} builds that matrix from a real `Backdrop` after
 *   `syncCamera(camera)` (plugin skies are parented to the camera since 2f44932a),
 *   for a graph camera orbited to any pitch.
 * - {@link worldDomeSkyRay} is the pre-2f44932a framing: the dome stays at the origin
 *   with no rotation, so the ray is the camera's world-space ray.
 */
import * as THREE from "three";
import { expect } from "vitest";
import { Backdrop } from "../graph/backdrop";
import { lensFov } from "../graph/lens-fov";

/** scene.ts default graph camera sits at (0, 820, 820) looking at the origin. */
export const HOST_DEFAULT_PITCH_DEG = 45;
const HOST_CAMERA_DISTANCE = Math.hypot(820, 820);

export type SkyRay = readonly number[];

export const IDENTITY_SKY_RAY: SkyRay = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Graph camera orbited to `pitchDeg` below the horizon, looking at the origin. */
export function hostCameraAtPitch(pitchDeg: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(55, 1.6, 1, 12000);
  const p = THREE.MathUtils.degToRad(pitchDeg);
  cam.position.set(0, HOST_CAMERA_DISTANCE * Math.sin(p), HOST_CAMERA_DISTANCE * Math.cos(p));
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

function rotationOf(obj: THREE.Object3D): THREE.Matrix4 {
  obj.updateMatrixWorld(true);
  return new THREE.Matrix4().extractRotation(obj.matrixWorld);
}

/** Camera-local ray to sky-mesh-local vDir, with the sky bound and synced like the host does it. */
export function parentedSkyRay(packId: string, skySource: string, pitchDeg: number): SkyRay {
  const sky = new Backdrop();
  expect(sky.setPluginShader({ id: packId, source: skySource }, () => null)).toBeNull();
  sky.setKind("plugin");
  expect(sky.pluginSkyId()).toBe(packId);
  const cam = hostCameraAtPitch(pitchDeg);
  sky.syncCamera(cam);
  const m = rotationOf(sky.mesh).invert().multiply(rotationOf(cam));
  return new THREE.Matrix3().setFromMatrix4(m).toArray();
}

/** Pre-2f44932a: the dome sat at the origin unrotated, so vDir was the camera's world ray. */
export function worldDomeSkyRay(pitchDeg: number): SkyRay {
  return new THREE.Matrix3().setFromMatrix4(rotationOf(hostCameraAtPitch(pitchDeg))).toArray();
}

/** Camera-local ray half-spans (tan of half the horizontal / vertical fov) the smoke draw covers. */
export type SkySpan = readonly [x: number, y: number];

/** Raw baseFov 55 at 16:10, before scene.ts clamps it with lensFov (the default here). */
export const BASE_FOV_SKY_SPAN: SkySpan = [0.83, 0.52];

/**
 * What the app's camera actually spans at `aspect`: scene.ts sets camera.fov =
 * lensFov(baseFov 55, aspect) every frame (:2616, :4598), which caps the horizontal fov at
 * MAX_H_FOV 64 degrees, so a 1280 x 800 window draws 64 x 42.7 degrees, not 79.6 x 55.
 */
export function appLensSkySpan(aspect = 1280 / 800): SkySpan {
  const v = THREE.MathUtils.degToRad(lensFov(55, aspect)) / 2;
  return [Math.tan(v) * aspect, Math.tan(v)];
}

/** Rewrite the pack's `normalize(vDir)` to the host-camera ray through `ray` (column-major). */
export function atHostCamera(skySource: string, ray: SkyRay = IDENTITY_SKY_RAY, span: SkySpan = BASE_FOV_SKY_SPAN): string {
  const hits = skySource.match(/normalize\(vDir\)/g)?.length ?? 0;
  expect(hits, "pack sky reads vDir through normalize(vDir) exactly once").toBe(1);
  const m = `mat3(${ray.map((v) => v.toFixed(7)).join(", ")})`;
  return skySource.replace("normalize(vDir)", `normalize(${m} * (vDir * vec3(${span[0].toFixed(7)}, ${span[1].toFixed(7)}, 1.0)))`);
}
