export function roleHue(role: string): number {
  if (role === "gateway") return 0.08;
  if (role === "internet") return 0.78;
  if (role === "lan") return 0.45;
  return 0.22;
}

export function packStereoOrbs(
  talkers: { id: string; rate: number; role: string }[],
  t: number,
): number[] {
  const buf: number[] = [];
  const n = Math.min(8, talkers.length);
  for (let i = 0; i < n; i++) {
    const row = talkers[i]!;
    const h = (row.id.charCodeAt(0) + i * 19) % 97;
    const ang = (h / 97) * 6.283 + t * (0.12 + i * 0.025);
    const r = 0.22 + (h % 18) / 55;
    buf.push(
      Math.cos(ang) * r,
      Math.sin(ang) * r,
      0.14 + Math.min(0.26, row.rate / 70),
      roleHue(row.role),
    );
  }
  return buf;
}
