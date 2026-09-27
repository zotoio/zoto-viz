export function pulse() {
  return 0.55 + 0.45 * Math.sin(Date.now() / 400);
}
