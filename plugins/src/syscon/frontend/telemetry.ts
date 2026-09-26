/** 0..1 SYS gauges packed into viz slot 0 for the holotable sky. */

import type { VizSysTelemetry } from "../../../sdk/viz-contract";

export const EMPTY_SYS_GAUGES: VizSysTelemetry = {
  cpu: 0, mem: 0, disk: 0, gpu: 0, temp: 0, watts: 0, psi: 0, sockets: 0, failed: 0, udev: 0,
};

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function sysAlert(sys: VizSysTelemetry): number {
  return clamp01(Math.max(sys.failed, sys.psi, sys.temp > 0.75 ? sys.temp : 0));
}

export const SYSCON_CANVAS_DEFAULT = { w: 1280, h: 800 };

/** Prefer the host canvas; the sandbox iframe falls back to the default plate. */
export function sysconCanvasSize(doc?: Document | null): { w: number; h: number } {
  let root = doc ?? (typeof document !== "undefined" ? document : null);
  try {
    if (!doc && typeof parent !== "undefined" && parent.document) root = parent.document;
  } catch { /* cross-origin / sandbox */ }
  const canvas = (root?.querySelector?.("canvas.render-host")
    ?? root?.querySelector?.("#wall > canvas")
    ?? root?.querySelector?.("#scene canvas")) as { width?: number; height?: number } | null;
  const w = canvas?.width ?? 0;
  const h = canvas?.height ?? 0;
  return {
    w: w > 64 ? w : SYSCON_CANVAS_DEFAULT.w,
    h: h > 64 ? h : SYSCON_CANVAS_DEFAULT.h,
  };
}

/** Slot 0: cpu mem disk gpu | temp watts psi sockets | failed udev audio alert | canvas w h */
export function packSysGauges(
  sys: Partial<VizSysTelemetry> | undefined,
  audio: number,
  canvas: { w: number; h: number } = SYSCON_CANVAS_DEFAULT,
): number[] {
  const s = { ...EMPTY_SYS_GAUGES, ...sys };
  const w = canvas.w > 64 ? canvas.w : SYSCON_CANVAS_DEFAULT.w;
  const h = canvas.h > 64 ? canvas.h : SYSCON_CANVAS_DEFAULT.h;
  return [
    clamp01(s.cpu), clamp01(s.mem), clamp01(s.disk), clamp01(s.gpu),
    clamp01(s.temp), clamp01(s.watts), clamp01(s.psi), clamp01(s.sockets),
    clamp01(s.failed), clamp01(s.udev), clamp01(audio), sysAlert(s),
    w, h,
  ];
}
