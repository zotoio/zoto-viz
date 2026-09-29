/** Horizontal field of view past this stretches spheres into ellipses at the frame edge. */
export const MAX_H_FOV = 64;

/** Vertical FOV whose horizontal field stays at or under `maxH` for this aspect. */
export function lensFov(vertical: number, aspect: number, maxH = MAX_H_FOV): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const v = (vertical * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * a);
  const cap = (maxH * Math.PI) / 180;
  if (!(h > cap)) return vertical;
  return ((2 * Math.atan(Math.tan(cap / 2) / a)) * 180) / Math.PI;
}

/** Horizontal field of view, degrees, for a vertical fov and aspect. */
export function horizontalFov(vertical: number, aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const v = (vertical * Math.PI) / 180;
  return ((2 * Math.atan(Math.tan(v / 2) * a)) * 180) / Math.PI;
}
