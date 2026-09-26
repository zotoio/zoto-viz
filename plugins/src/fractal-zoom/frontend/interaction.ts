/** Pointer / wheel deltas for manual orbit (host attaches to the scene canvas). */

export interface FractalPointerState {
  yaw: number;
  pitch: number;
  zoomWheel: number;
  dragging: boolean;
}

const state: FractalPointerState = {
  yaw: 0,
  pitch: 0,
  zoomWheel: 0,
  dragging: false,
};

let attached: HTMLElement | null = null;
let active = false;

function onDown(e: PointerEvent): void {
  if (!active) return;
  state.dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onMove(e: PointerEvent): void {
  if (!active || !state.dragging) return;
  state.yaw += e.movementX * 0.004;
  state.pitch = Math.max(-1.2, Math.min(1.2, state.pitch + e.movementY * 0.003));
}

function onUp(e: PointerEvent): void {
  state.dragging = false;
  try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
}

function onWheel(e: WheelEvent): void {
  if (!active) return;
  state.zoomWheel += Math.sign(e.deltaY) * 0.08;
}

export function fractalPointerState(): FractalPointerState {
  return state;
}

export function resetFractalPointer(): void {
  state.yaw = 0;
  state.pitch = 0;
  state.zoomWheel = 0;
  state.dragging = false;
}

export function setFractalInteractionActive(on: boolean): void {
  active = on;
  if (!on) resetFractalPointer();
}

export function attachFractalInteraction(el: HTMLElement | null): void {
  if (attached === el) return;
  if (attached) detachFractalInteraction();
  attached = el;
  if (!el) return;
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onUp);
  el.addEventListener("wheel", onWheel, { passive: true });
}

export function detachFractalInteraction(): void {
  if (!attached) return;
  attached.removeEventListener("pointerdown", onDown);
  attached.removeEventListener("pointermove", onMove);
  attached.removeEventListener("pointerup", onUp);
  attached.removeEventListener("pointerleave", onUp);
  attached.removeEventListener("wheel", onWheel);
  attached = null;
  resetFractalPointer();
}

export function disposeFractalInteraction(): void {
  setFractalInteractionActive(false);
  detachFractalInteraction();
}
