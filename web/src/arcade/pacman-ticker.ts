/** Ticker bites that fly into Pac-Man, plus crumb hops. No Three.js. */

export function biteWords(lines: string[], cap = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parts = (line || "").split(/[\s|/·→>]+/).map((w) => w.replace(/[^\w.#:+-]/g, "")).filter((w) => w.length >= 2 && w.length <= 22);
    for (const w of parts) {
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Short ticker fragments that stay readable on a flying card. */
export function bitePhrases(lines: string[], cap = 18): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length < 2) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t.slice(0, 18));
  };
  for (const line of lines) {
    const words = (line || "").replace(/\s+/g, " ").trim().split(" ").filter((w) => /\w/.test(w));
    let buf = "";
    for (const w of words) {
      const next = buf ? `${buf} ${w}` : w;
      if (next.length <= 18) buf = next;
      else {
        push(buf);
        buf = w.slice(0, 18);
        if (out.length >= cap) return out;
      }
    }
    push(buf);
    if (out.length >= cap) return out;
  }
  return out;
}

export function facingOf(dir: 0 | 1 | 2 | 3): [number, number] {
  return [[1, 0], [0, 1], [-1, 0], [0, -1]][dir] as [number, number];
}

/** Orbit theta that looks into the mouth along the incoming ticker rail. */
export function mouthCameraTheta(dir: 0 | 1 | 2 | 3): number {
  const [fx, fz] = facingOf(dir);
  return Math.atan2(fz, fx);
}

/** t 0..1: word slides from the ticker rail into the mouth. */
export function tickerApproach(
  from: [number, number, number],
  mouth: [number, number, number],
  t: number,
): [number, number, number] {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const ease = 1 - (1 - u) * (1 - u);
  return [
    from[0] + (mouth[0] - from[0]) * ease,
    from[1] + (mouth[1] - from[1]) * ease + Math.sin(u * Math.PI) * 0.55,
    from[2] + (mouth[2] - from[2]) * ease,
  ];
}

export type Crumb = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
};

export function launchCrumbs(
  origin: [number, number, number],
  n: number,
  salt: number,
): Crumb[] {
  const out: Crumb[] = [];
  const count = Math.max(1, Math.min(14, n | 0));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + salt * 0.7;
    const up = 6.4 + ((salt + i * 17) % 10) * 0.28;
    out.push({
      x: origin[0],
      y: origin[1] + 0.15,
      z: origin[2],
      vx: Math.cos(a) * (1.4 + (i % 3) * 0.35),
      vy: up,
      vz: Math.sin(a) * (1.4 + (i % 3) * 0.35),
      age: 0,
    });
  }
  return out;
}

/** Gravity hop: crumbs jump out, bounce once, then die. */
export function stepCrumb(c: Crumb, dt: number, floorY = 0): Crumb | null {
  const t = dt < 0 ? 0 : dt > 0.05 ? 0.05 : dt;
  const next: Crumb = {
    x: c.x + c.vx * t,
    y: c.y + c.vy * t,
    z: c.z + c.vz * t,
    vx: c.vx * (1 - 0.8 * t),
    vy: c.vy - 16 * t,
    vz: c.vz * (1 - 0.8 * t),
    age: c.age + t,
  };
  if (next.y < floorY) {
    next.y = floorY;
    next.vy *= -0.46;
    if (Math.abs(next.vy) < 0.9) return null;
  }
  if (next.age > 2.1) return null;
  return next;
}
