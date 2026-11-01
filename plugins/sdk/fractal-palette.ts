/** fractal-zoom gradient palettes, shared by the pack options and the host software painter. Must match `palette()` in `sky/fragment.glsl`. */

export const FRACTAL_PALETTES = ["classic", "topo", "ember", "ice", "mono", "neon"] as const;
export type FractalPalette = (typeof FRACTAL_PALETTES)[number];

type Rgb = [number, number, number];

/** Five stops per gradient palette; `neon` is the cosine rainbow and has no stops. */
export const FRACTAL_PALETTE_STOPS: Rgb[][] = [
  [[0.0, 0.03, 0.12], [0.05, 0.25, 0.75], [0.92, 0.96, 1.0], [1.0, 0.75, 0.2], [0.65, 0.25, 0.02]],
  [[0.03, 0.12, 0.3], [0.2, 0.45, 0.65], [0.82, 0.74, 0.52], [0.45, 0.32, 0.22], [0.95, 0.96, 1.0]],
  [[0.02, 0.0, 0.0], [0.45, 0.02, 0.04], [0.85, 0.18, 0.03], [1.0, 0.55, 0.1], [1.0, 0.9, 0.6]],
  [[0.01, 0.02, 0.06], [0.1, 0.2, 0.38], [0.3, 0.55, 0.75], [0.55, 0.88, 0.95], [0.95, 0.98, 1.0]],
  [[0.03, 0.03, 0.04], [0.2, 0.2, 0.22], [0.45, 0.45, 0.48], [0.72, 0.72, 0.75], [0.92, 0.92, 0.94]],
];

/** Mirrored gradient (period 2 in t, no seam), then hue rotation about the grey axis and saturation. */
export function fractalGradient(t: number, pal: number, hue: number, sat: number): Rgb {
  const p = Math.min(5, Math.max(0, Math.round(pal)));
  let col: Rgb;
  if (p === 5) {
    col = [0, 0.33, 0.67].map((ph) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (t + ph))) as Rgb;
  } else {
    const fr = t * 0.5 - Math.floor(t * 0.5);
    const u = Math.abs(fr * 2 - 1) * 4;
    const i = Math.min(3, Math.floor(u));
    let f = u - i;
    f = f * f * (3 - 2 * f);
    const a = FRACTAL_PALETTE_STOPS[p]![i]!;
    const b = FRACTAL_PALETTE_STOPS[p]![i + 1]!;
    col = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const h = hue * Math.PI * 2;
  const c = Math.cos(h);
  const s = Math.sin(h);
  const k = 0.57735;
  const kd = k * (col[0] + col[1] + col[2]) * (1 - c);
  const rot: Rgb = [
    col[0] * c + (k * col[2] - k * col[1]) * s + k * kd,
    col[1] * c + (k * col[0] - k * col[2]) * s + k * kd,
    col[2] * c + (k * col[1] - k * col[0]) * s + k * kd,
  ];
  const luma = rot[0] * 0.299 + rot[1] * 0.587 + rot[2] * 0.114;
  return rot.map((v) => Math.min(1.5, Math.max(0, luma + (v - luma) * sat))) as Rgb;
}
