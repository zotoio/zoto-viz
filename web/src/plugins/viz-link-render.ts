/** Stable link record identity from endpoints (not output rank). */
export function vizLinkRecordIdentity(src: string, dst: string, _rank = 0): string {
  return `${src}\0${dst}`;
}

/** Stable render key from endpoints only (no slot / rank). */
export function vizLinkRenderKey(src: string, dst: string): string {
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  for (let i = 0; i < dst.length; i++) h = Math.imul(h ^ dst.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LINK_PALETTE = [
  "#4fc3f7",
  "#81c784",
  "#ffb74d",
  "#f06292",
  "#9575cd",
  "#4db6ac",
  "#ff8a65",
  "#aed581",
] as const;

/** Palette colour from (src, dst) hash — pure function, no stored rank state. */
export function vizLinkRenderColor(src: string, dst: string): string {
  const h = Number.parseInt(vizLinkRenderKey(src, dst), 16);
  return LINK_PALETTE[h % LINK_PALETTE.length]!;
}
