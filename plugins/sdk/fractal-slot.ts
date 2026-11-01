/** fractal-zoom slot 0 layout, shared by the pack drive and the host software painter. */

/** Slot 0 layout — must match `sky/fragment.glsl`. */
export const FZ_SLOT = {
  camX: 0,
  camY: 1,
  camZ: 2,
  dirX: 3,
  dirY: 4,
  dirZ: 5,
  roll: 6,
  zoomLog: 7,
  fractalType: 8,
  power: 9,
  scale: 10,
  fold: 11,
  maxIterN: 12,
  maxStepsN: 13,
  detail: 14,
  ao: 15,
  shadow: 16,
  glow: 17,
  fog: 18,
  dof: 19,
  palette: 20,
  paletteCycle: 21,
  orbitTrap: 22,
  hue: 23,
  sat: 24,
  bgR: 25,
  bgG: 26,
  bgB: 27,
  morphT: 28,
  morphAmt: 29,
  renderScale: 30,
  juliaCr: 31,
  juliaCi: 32,
  quatC2: 33,
  quatC3: 34,
  audioDrv: 35,
  pingPhase: 36,
  kaleidoSym: 37,
  mandelCx: 38,
  mandelCy: 39,
  mandelScale: 40,
  frameMs: 41,
  mark: 42,
  precisionClamp: 43,
  focusX: 44,
  focusY: 45,
  focusZ: 46,
  nearDist: 47,
  orbitLen: 48,
  generation: 49,
  /** Perturbation reference point relative to mandelCx/Cy, in window units (multiply by mandelScale). */
  refDx: 50,
  refDy: 51,
  /** Planar view rotation (radians): window point q maps to c = centre + scale * e^(i*viewRot) * q. */
  viewRot: 52,
  /**
   * Escape-count offset the loop jumps accumulate (mod FZ_BAND_WRAP): a jump out by |lambda| lowers
   * every pixel's count by the cycle period, so colour bands add this back and do not step.
   */
  iterShift: 53,
} as const;

export const FZ_SLOT0_FLOATS = 54;

/** Colour band per escape iteration (sky shader `FZ_BAND_K`). FZ_BAND_WRAP * FZ_BAND_K is a whole palette period (2). */
export const FZ_BAND_K = 0.07;
export const FZ_BAND_WRAP = 200;
