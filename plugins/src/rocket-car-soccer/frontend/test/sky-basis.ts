/**
 * Test-only CPU mirror of the sky camera basis (#180).
 *
 * Pulls the `fwd` / `right` / `up` / `rd` lines out of `sky/fragment.glsl` verbatim and
 * evaluates them with a tiny vec3 expression evaluator, so a test can ask "where does the
 * centre pixel look?" without a GL context. The plugin sky hands the pack a camera-local
 * `vDir` with -z forward, +x right, +y up.
 */

export type Vec3 = [number, number, number];
type Val = number | Vec3;

export const RCS_BASIS_NAMES = ["fwd", "right", "up", "rd"] as const;

/** The verbatim GLSL basis lines (`vec3 fwd = ...;` etc.) from the sky source. */
export function rcsSkyBasisLines(frag: string): Record<(typeof RCS_BASIS_NAMES)[number], string> {
  const out = {} as Record<(typeof RCS_BASIS_NAMES)[number], string>;
  for (const name of RCS_BASIS_NAMES) {
    const m = frag.match(new RegExp(`^\\s*vec3 ${name} = (.+);\\s*$`, "m"));
    if (!m) throw new Error(`sky/fragment.glsl has no 'vec3 ${name} = ...;' line`);
    out[name] = m[1]!.trim();
  }
  return out;
}

function isVec(v: Val): v is Vec3 {
  return Array.isArray(v);
}

function bin(a: Val, b: Val, f: (x: number, y: number) => number): Val {
  if (isVec(a) && isVec(b)) return [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])];
  if (isVec(a)) return [f(a[0], b as number), f(a[1], b as number), f(a[2], b as number)];
  if (isVec(b)) return [f(a as number, b[0]), f(a as number, b[1]), f(a as number, b[2])];
  return f(a as number, b as number);
}

const FNS: Record<string, (args: Val[]) => Val> = {
  vec3: (a) => (a.length === 1 ? [a[0] as number, a[0] as number, a[0] as number] : [a[0] as number, a[1] as number, a[2] as number]),
  sin: (a) => Math.sin(a[0] as number),
  cos: (a) => Math.cos(a[0] as number),
  normalize: (a) => {
    const v = a[0] as Vec3;
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  },
  cross: (a) => {
    const [x, y] = a as [Vec3, Vec3];
    return [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  },
};

/** Evaluate one GLSL vec3/float expression against `env`. */
export function evalGlsl(src: string, env: Record<string, Val>): Val {
  const toks = src.match(/\d+\.\d*|\.\d+|\d+|[A-Za-z_]\w*|[()+\-*/,.]/g) ?? [];
  let i = 0;
  const peek = (): string | undefined => toks[i];
  const take = (t?: string): string => {
    const got = toks[i++];
    if (t !== undefined && got !== t) throw new Error(`expected ${t} got ${got} in ${src}`);
    return got!;
  };
  const expr = (): Val => {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const r = term();
      v = bin(v, r, op === "+" ? (x, y) => x + y : (x, y) => x - y);
    }
    return v;
  };
  const term = (): Val => {
    let v = unary();
    while (peek() === "*" || peek() === "/") {
      const op = take();
      const r = unary();
      v = bin(v, r, op === "*" ? (x, y) => x * y : (x, y) => x / y);
    }
    return v;
  };
  const unary = (): Val => {
    if (peek() === "-") {
      take();
      return bin(-1, unary(), (x, y) => x * y);
    }
    return postfix(primary());
  };
  const postfix = (v: Val): Val => {
    while (peek() === ".") {
      take(".");
      const sw = take();
      const idx = { x: 0, y: 1, z: 2 }[sw];
      if (idx === undefined || !isVec(v)) throw new Error(`bad swizzle .${sw} in ${src}`);
      v = v[idx];
    }
    return v;
  };
  const primary = (): Val => {
    const t = take();
    if (t === "(") {
      const v = expr();
      take(")");
      return v;
    }
    if (/^[\d.]/.test(t)) return Number(t);
    if (peek() === "(") {
      take("(");
      const args: Val[] = [];
      if (peek() !== ")") {
        args.push(expr());
        while (peek() === ",") {
          take(",");
          args.push(expr());
        }
      }
      take(")");
      const fn = FNS[t];
      if (!fn) throw new Error(`unsupported GLSL call ${t}() in ${src}`);
      return fn(args);
    }
    if (!(t in env)) throw new Error(`unknown identifier ${t} in ${src}`);
    return env[t]!;
  };
  const v = expr();
  if (i !== toks.length) throw new Error(`trailing tokens in ${src}`);
  return v;
}

/** World-space ray for camera-local `dir` using the shader's own basis lines. */
export function rcsSkyRay(frag: string, cam: { yaw: number; pitch: number }, dir: Vec3): Vec3 {
  const lines = rcsSkyBasisLines(frag);
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const env: Record<string, Val> = { yaw: cam.yaw, pitch: cam.pitch, dir: [dir[0] / l, dir[1] / l, dir[2] / l] };
  for (const name of RCS_BASIS_NAMES) env[name] = evalGlsl(lines[name], env);
  return env.rd as Vec3;
}

/** Shader fallback camera used before the pack writes slot 0 (mark < 0.5). */
export function rcsSkyFallbackCamera(frag: string): { ro: Vec3; yaw: number; pitch: number } {
  const ro = frag.match(/ro = vec3\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\);/);
  const yaw = frag.match(/\byaw = ([-\d.]+);/);
  const pitch = frag.match(/\bpitch = ([-\d.]+);/);
  if (!ro || !yaw || !pitch) throw new Error("sky/fragment.glsl fallback camera not found");
  return { ro: [Number(ro[1]), Number(ro[2]), Number(ro[3])], yaw: Number(yaw[1]), pitch: Number(pitch[1]) };
}
