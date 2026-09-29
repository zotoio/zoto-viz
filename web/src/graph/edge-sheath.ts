import * as THREE from "three";

/** World half-width at thickness 1. A thin fibre, not a ribbon. */
const HALF_AT_UNIT = 0.85;

export function edgeHalfWidth(weight: number): number {
  const w = Number.isFinite(weight) ? weight : 1;
  return HALF_AT_UNIT * Math.min(2.5, Math.max(0.3, w));
}

const VERT = `
attribute float along;
attribute float across;
attribute float glowAb;
attribute float glowBa;
varying vec3 vColor;
varying float vAlong;
varying float vAcross;
varying float vAb;
varying float vBa;
void main() {
  vColor = color;
  vAlong = along;
  vAcross = across;
  vAb = glowAb;
  vBa = glowBa;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform float uTime;
uniform float uSpeed;
uniform float uAmt;
uniform float uMode;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlong;
varying float vAcross;
varying float vAb;
varying float vBa;

float comet(float along, float phase) {
  float behind = fract(phase - along);
  return exp(-behind * 3.6);
}
float pulse(float along, float phase) {
  return 0.35 + 0.65 * 0.5 * (1.0 + sin((along - phase) * 6.2831853));
}

void main() {
  float flow = 0.0;
  float clock = uTime * max(uSpeed, 0.15);
  flow += 0.55 * exp(-fract(clock * 0.22 - vAlong) * 3.2);
  if (vAb > 0.001) {
    float phase = fract(clock * (0.40 + 0.70 * vAb));
    flow += vAb * (uMode < 0.5 ? comet(vAlong, phase) : pulse(vAlong, phase));
  }
  if (vBa > 0.001) {
    float phase = fract(clock * (0.40 + 0.70 * vBa));
    flow += vBa * (uMode < 0.5 ? comet(1.0 - vAlong, phase) : pulse(1.0 - vAlong, phase));
  }
  flow *= uAmt;
  float ax = vAcross;
  float rad = abs(ax);
  float round = sqrt(max(0.0, 1.0 - rad * rad));
  float core = exp(-ax * ax * 28.0);
  float spec = exp(-(ax - 0.34) * (ax - 0.34) * 80.0);
  vec3 jacket = vColor * (0.62 + 0.28 * round);
  vec3 filament = vec3(1.0, 0.98, 0.94);
  vec3 rgb = mix(jacket, filament, core);
  rgb += vec3(1.0) * spec * round * 0.55;
  rgb += filament * core * min(flow, 1.0) * 0.35;
  float body = smoothstep(1.0, 0.22, rad) * (0.4 + 0.6 * round);
  float a = body * (0.28 + 0.72 * uOpacity);
  a = max(a, core * (0.7 + 0.3 * uOpacity));
  gl_FragColor = vec4(min(rgb, vec3(1.0)), clamp(a, 0.0, 0.95));
}
`;

function sheathMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 1 },
      uAmt: { value: 1 },
      uMode: { value: 0 },
      uOpacity: { value: 0.5 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false,
  });
}

export type FibreSample = { x: number; y: number; z: number; r: number; g: number; b: number; along: number };

const sideX: number[] = [];
const sideY: number[] = [];
const sideZ: number[] = [];

/** Screen-facing ribbon. `across` is −1 at one edge and +1 at the other, so the light stays in the middle. */
export class EdgeSheath {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(0);
  private col = new Float32Array(0);
  private along = new Float32Array(0);
  private across = new Float32Array(0);
  private ab = new Float32Array(0);
  private ba = new Float32Array(0);
  private cap = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.mesh = new THREE.Mesh(geo, sheathMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  private grow(segs: number): void {
    if (segs <= this.cap) return;
    const next = Math.max(segs, this.cap * 2, 64);
    const pos = new Float32Array(next * 4 * 3);
    const col = new Float32Array(next * 4 * 3);
    const along = new Float32Array(next * 4);
    const across = new Float32Array(next * 4);
    const ab = new Float32Array(next * 4);
    const ba = new Float32Array(next * 4);
    pos.set(this.pos);
    col.set(this.col);
    along.set(this.along);
    across.set(this.across);
    ab.set(this.ab);
    ba.set(this.ba);
    this.pos = pos;
    this.col = col;
    this.along = along;
    this.across = across;
    this.ab = ab;
    this.ba = ba;
    const idx = new Uint32Array(next * 6);
    for (let s = 0; s < next; s++) {
      const b = s * 4;
      const o = s * 6;
      idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1;
      idx[o + 3] = b + 1; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    const geo = this.mesh.geometry;
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("along", new THREE.BufferAttribute(this.along, 1));
    geo.setAttribute("across", new THREE.BufferAttribute(this.across, 1));
    geo.setAttribute("glowAb", new THREE.BufferAttribute(this.ab, 1));
    geo.setAttribute("glowBa", new THREE.BufferAttribute(this.ba, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.cap = next;
  }

  /**
   * One segment of a link. The width faces the camera so the ribbon reads as a line
   * with a bright core.
   */
  write(
    seg: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    r0: number, g0: number, b0: number,
    r1: number, g1: number, b1: number,
    along0: number, along1: number,
    gab: number, gba: number,
    half: number,
    camX: number, camY: number, camZ: number,
  ): void {
    this.grow(seg + 1);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
    const vx = mx - camX, vy = my - camY, vz = mz - camZ;
    let sx = dy * vz - dz * vy;
    let sy = dz * vx - dx * vz;
    let sz = dx * vy - dy * vx;
    const sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-5) { sx = 0; sy = half; sz = 0; }
    else { sx = sx / sl * half; sy = sy / sl * half; sz = sz / sl * half; }
    const base = seg * 4;
    const corners: [number, number, number, number, number, number, number, number][] = [
      [ax - sx, ay - sy, az - sz, r0, g0, b0, along0, -1],
      [ax + sx, ay + sy, az + sz, r0, g0, b0, along0, 1],
      [bx - sx, by - sy, bz - sz, r1, g1, b1, along1, -1],
      [bx + sx, by + sy, bz + sz, r1, g1, b1, along1, 1],
    ];
    for (let k = 0; k < 4; k++) {
      const c = corners[k]!;
      const p = (base + k) * 3;
      this.pos[p] = c[0]; this.pos[p + 1] = c[1]; this.pos[p + 2] = c[2];
      this.col[p] = c[3]; this.col[p + 1] = c[4]; this.col[p + 2] = c[5];
      this.along[base + k] = c[6];
      this.across[base + k] = c[7];
      this.ab[base + k] = gab;
      this.ba[base + k] = gba;
    }
  }

  /**
   * One continuous fibre. Each sample's width faces the camera along the local
   * tangent, and neighbouring quads share that edge so the bend stays smooth.
   * Returns how many segments were written.
   */
  writeCurve(
    seg: number,
    pts: FibreSample[],
    count: number,
    gab: number, gba: number,
    half: number,
    camX: number, camY: number, camZ: number,
  ): number {
    if (count < 2) return 0;
    const n = count - 1;
    this.grow(seg + n);
    for (let i = 0; i < count; i++) {
      const p = pts[i]!;
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(count - 1, i + 1)]!;
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const vx = p.x - camX, vy = p.y - camY, vz = p.z - camZ;
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-5) { sx = half; sy = 0; sz = 0; }
      else { const k = half / sl; sx *= k; sy *= k; sz *= k; }
      sideX[i] = sx; sideY[i] = sy; sideZ[i] = sz;
    }
    for (let i = 0; i < n; i++) {
      const p0 = pts[i]!, p1 = pts[i + 1]!;
      this.write(
        seg + i,
        p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
        p0.r, p0.g, p0.b, p1.r, p1.g, p1.b,
        p0.along, p1.along, gab, gba, half,
        camX, camY, camZ,
      );
      const base = (seg + i) * 4;
      const place = (k: number, p: FibreSample, si: number, across: number) => {
        const o = (base + k) * 3;
        const s = across;
        this.pos[o] = p.x + sideX[si]! * s;
        this.pos[o + 1] = p.y + sideY[si]! * s;
        this.pos[o + 2] = p.z + sideZ[si]! * s;
      };
      place(0, p0, i, -1);
      place(1, p0, i, 1);
      place(2, p1, i + 1, -1);
      place(3, p1, i + 1, 1);
    }
    return n;
  }

  commit(segs: number, look: { time: number; opacity: number; speed: number; amt: number; mode: number }): void {
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, Math.max(0, segs) * 6);
    const touch = (name: string) => {
      const attr = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
      if (attr) attr.needsUpdate = true;
    };
    touch("position");
    touch("color");
    touch("along");
    touch("across");
    touch("glowAb");
    touch("glowBa");
    const u = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    u.uTime!.value = look.time;
    u.uOpacity!.value = look.opacity;
    u.uSpeed!.value = look.speed;
    u.uAmt!.value = look.amt;
    u.uMode!.value = look.mode;
    this.mesh.visible = segs > 0;
  }
}
