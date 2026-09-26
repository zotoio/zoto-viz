import type { DevicePxRatio } from "./render-host-device-px-ratio";
import { devicePxRatioNumber } from "./render-host-device-px-ratio";
import type * as THREE from "three";

/**
 * PointsMaterial.size for the shared host (renderer pixel ratio fixed at 1).
 * sizeAttenuation true: world-space size; Three applies scale = devH/2 — do not multiply.
 * sizeAttenuation false: screen-pixel diameter — multiply by layout device px ratio.
 */
export function hostPointsMaterialSize(
  cssSize: number,
  devicePxRatio: DevicePxRatio,
  sizeAttenuation: boolean,
): number {
  if (sizeAttenuation) return cssSize;
  return cssSize * devicePxRatioNumber(devicePxRatio);
}

/** Three points shader scale uniform at renderer pixel ratio 1. */
export function hostPointsShaderScale(canvasDeviceHeight: number): number {
  return canvasDeviceHeight / 2;
}

/** Fat-line LineMaterial: linewidth and resolution both in device pixels. */
export function hostLineMaterialDeviceUniforms(
  cssLineWidth: number,
  cssCanvasW: number,
  cssCanvasH: number,
  devicePxRatio: DevicePxRatio,
): { linewidth: number; resolutionX: number; resolutionY: number } {
  const pr = devicePxRatioNumber(devicePxRatio);
  return {
    linewidth: cssLineWidth * pr,
    resolutionX: cssCanvasW * pr,
    resolutionY: cssCanvasH * pr,
  };
}

export function applyHostLineMaterialUniforms(
  material: { linewidth: number; resolution: THREE.Vector2 },
  cssLineWidth: number,
  cssCanvasW: number,
  cssCanvasH: number,
  devicePxRatio: DevicePxRatio,
): void {
  const u = hostLineMaterialDeviceUniforms(cssLineWidth, cssCanvasW, cssCanvasH, devicePxRatio);
  material.linewidth = u.linewidth;
  material.resolution.set(u.resolutionX, u.resolutionY);
}

/** Shader uniforms that count canvas extents in device pixels (e.g. edge glow). */
export function hostShaderResolutionUniform(
  cssCanvasW: number,
  cssCanvasH: number,
  devicePxRatio: DevicePxRatio,
  out: { x: number; y: number },
): { x: number; y: number } {
  const pr = devicePxRatioNumber(devicePxRatio);
  out.x = cssCanvasW * pr;
  out.y = cssCanvasH * pr;
  return out;
}

export function applyHostPointsMaterialSize(
  material: THREE.PointsMaterial,
  cssSize: number,
  devicePxRatio: DevicePxRatio,
): void {
  material.size = hostPointsMaterialSize(cssSize, devicePxRatio, material.sizeAttenuation);
}
