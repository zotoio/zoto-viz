// Backrooms Level 0 as camcorder footage. The host director (frontend/director.ts) moves the camera
// and the creature in slot 0, lists walled corridor edges around the camera in slot 1, and passes the
// view options (OSD, tape wear, writing, objects, dead lights, shadows); this shader only draws.
// With no director the camera walks one straight hall.

#define PI 3.14159265
const float G = 4.0, HP = 0.92, CH = 2.6;

vec3 gCam, gBodyA, gBodyB, gBC; vec2 gCr, gDrag; ivec2 gWin; int gType;
float gYaw, gPitch, gRoll, gVis, gCS, gCC, gCT, gHush, gGlitch, gCut, gExpo, gTh, gBR, gBreath, gMouth;
float gDragVis, gDragC, gDragS, gOsd, gVhs, gWriting, gObjects, gDark, gShadows;
bool gSelf;
vec3 jH, jC, jSL, jSR, jHd, jEL, jER, jWL, jWR, jKL, jKR, jFL, jFR, jHL, jHR, fLa, fLb, fLc, fRa, fRb, fRc;
mat3 hM;

// 5×6 block font (camcorder OSD, signs, marker graffiti): A B C D E F G H I J L M N O P R S T U V X Y 0-9 : .
const uint FONT[34] = uint[34](589284910u, 521715247u, 1007715390u, 521717295u, 1041284159u, 34651199u, 488170558u, 588840497u, 474091662u, 211034396u, 1041269793u, 588830577u, 589092465u, 488162862u, 34651695u, 580042287u, 520632382u, 138547359u, 488162865u, 145049137u, 581046609u, 138547537u, 488232750u, 474091716u, 1042424366u, 520632847u, 277118249u, 520633407u, 488160302u, 138551839u, 488159790u, 487540270u, 4194432u, 134217728u);
// DONT MOVE | STAY STILL | HELP | NO EXIT | ITS BEHIND | YOU | RUN
const int TXT[46] = int[46](3, 13, 12, 17, -1, 11, 13, 19, 4, 16, 17, 0, 21, -1, 16, 17, 8, 10, 10, 7, 4, 10, 14, 12, 13, -1, 4, 20, 8, 17, 8, 17, 16, -1, 1, 4, 7, 8, 12, 3, 21, 13, 18, 15, 18, 12);
const int MON[36] = int[36](9, 0, 12, 5, 4, 1, 11, 0, 15, 0, 14, 15, 11, 0, 21, 9, 18, 12, 9, 18, 10, 0, 18, 6, 16, 4, 14, 13, 2, 17, 12, 13, 19, 3, 4, 2);

float slot(int i) { vec4 v = zotoVizSlots[i >> 2]; int c = i & 3; return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w; }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

uint hu(uvec3 v) {
  uint h = v.x * 1597334677u ^ v.y * 3812015801u ^ v.z * 2798796415u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
float hf(ivec2 i, int s) { return float(hu(uvec3(i + 4194304, s)) >> 8) / 16777216.0; }
float h1(float x) { return hf(ivec2(int(floor(x)), 7), 3); }
float vn(vec2 x, int s) {
  vec2 f = fract(x); ivec2 k = ivec2(floor(x));
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hf(k, s), hf(k + ivec2(1, 0), s), f.x), mix(hf(k + ivec2(0, 1), s), hf(k + ivec2(1, 1), s), f.x), f.y);
}
float fbm(vec2 x, int s) { return 0.5 * vn(x, s) + 0.3 * vn(x * 2.03 + 5.1, s) + 0.2 * vn(x * 4.1 + 1.7, s); }

float sdB(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdB3(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }
float cap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float seg2(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float ell(vec3 q, vec3 r) { return (length(q / r) - 1.0) * min(r.x, min(r.y, r.z)); }
// Tapered limb from a (radius r1) to b (radius r2).
float rcone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba), z = y - l2;
  vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
float cone0(vec3 p, float r1, float r2, float h) {
  float b = (r1 - r2) / h, a = sqrt(1.0 - b * b);
  vec2 q = vec2(length(p.xz), p.y);
  float k = dot(q, vec2(-b, a));
  if (k < 0.0) return length(q) - r1;
  if (k > a * h) return length(q - vec2(0.0, h)) - r2;
  return dot(q, vec2(a, b)) - r1;
}
float sdOct(vec2 p, float r) {
  const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

// ---------------------------------------------------------------- maze

bool walled(int i, int k, int a) {
  int x = i - gWin.x, z = k - gWin.y;
  if (x < 0 || z < 0 || x > 23 || z > 23) return false;
  int b = (z * 24 + x) * 2 + a, f = b / 24;
  return ((uint(slot(64 + f)) >> uint(b - f * 24)) & 1u) == 1u;
}
float chamber(vec2 xz) {
  ivec2 r = ivec2(floor((xz + 6.0) / 12.0));
  if (hf(r, 31) < 0.8) return -1e3;
  vec2 l = abs(xz - vec2(r) * 12.0);
  return 4.6 + hf(r, 32) - max(l.x, l.y);
}
float walls(vec2 xz) {
  float d = sdB(mod(xz, G) - 2.0, vec2(HP));
  ivec2 n = ivec2(floor(xz / G + 0.5));
  vec2 o = xz - vec2(n) * G;
  if (walled(n.x, n.y, 0)) d = min(d, sdB(o - vec2(2.0, 0.0), vec2(HP, 2.0)));
  if (walled(n.x - 1, n.y, 0)) d = min(d, sdB(o + vec2(2.0, 0.0), vec2(HP, 2.0)));
  if (walled(n.x, n.y, 1)) d = min(d, sdB(o - vec2(0.0, 2.0), vec2(2.0, HP)));
  if (walled(n.x, n.y - 1, 1)) d = min(d, sdB(o + vec2(0.0, 2.0), vec2(2.0, HP)));
  return max(d, chamber(xz));
}
float room(vec3 p) { return min(min(p.y, CH - p.y), walls(p.xz)); }

// ---------------------------------------------------------------- things that noclipped into the halls

float chair(vec3 q) {
  float d = sdB3(q, vec3(0.24, 0.045, 0.23)) - 0.02;
  d = min(d, sdB3(q - vec3(0.0, 0.3, -0.22), vec3(0.22, 0.24, 0.03)) - 0.02);
  d = min(d, cap(q, vec3(0.0, -0.05, 0.0), vec3(0.0, -0.36, 0.0), 0.025));
  for (int i = 0; i < 5; i++) {
    float an = float(i) * 1.2566;
    vec3 e = vec3(cos(an) * 0.3, -0.42, sin(an) * 0.3);
    d = min(d, min(cap(q, vec3(0.0, -0.38, 0.0), e, 0.018), length(q - e + vec3(0.0, 0.04, 0.0)) - 0.03));
  }
  return d;
}
float cone(vec3 q) { return min(cone0(q, 0.15, 0.025, 0.58), sdB3(q - vec3(0.0, 0.012, 0.0), vec3(0.19, 0.012, 0.19))); }
float tripod(vec3 q, float h) {
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    float an = float(i) * 2.094 + 0.5;
    d = min(d, cap(q, vec3(0.0, h, 0.0), vec3(cos(an) * 0.32, 0.0, sin(an) * 0.32), 0.012));
  }
  return d;
}
// Pillar cell c may hold one thing on one face. Kinds: 0 office chair, 1 filing cabinet, 2 door, 3 ladder into the
// ceiling, 4 turn-only sign, 5 stop sign, 6 traffic cones, 7 work light on a tripod, 8 camcorder on a tripod,
// 9 CRT TV showing static, 10 heap of cardboard boxes, 11 stained mattress. Local x along the face, z out.
bool objFrame(ivec2 c, out int kind, out vec2 base, out vec2 tg, out vec2 o2) {
  kind = -1; base = vec2(0.0); tg = vec2(1.0, 0.0); o2 = vec2(0.0, 1.0);
  if (hf(c, 80) > 0.14 * gObjects) return false;
  vec2 pc = vec2(c) * G + 2.0;
  if (chamber(pc) > -1.0) return false;
  kind = int(hf(c, 81) * 12.0);
  int f = int(hf(c, 82) * 4.0);
  o2 = f == 0 ? vec2(1.0, 0.0) : f == 1 ? vec2(0.0, 1.0) : f == 2 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
  tg = vec2(-o2.y, o2.x);
  base = pc + o2 * HP + tg * (hf(c, 83) - 0.5) * 0.9;
  return true;
}
float objAt(ivec2 c, vec3 p, out int kind, out vec3 lq) {
  vec2 base, tg, o2;
  lq = vec3(0.0);
  if (!objFrame(c, kind, base, tg, o2)) return 1e3;
  vec2 d2 = p.xz - base;
  vec3 q = vec3(dot(d2, tg), p.y, dot(d2, o2));
  lq = q;
  float bd = length(q - vec3(0.0, 1.1, 0.3)) - 1.7;
  if (bd > 0.2) return bd;
  float a = hf(c, 84) - 0.5;
  if (kind == 0) return chair(rotX(0.5 + a) * rotZ(a * 1.2) * (q - vec3(0.0, 0.62, 0.12)));
  if (kind == 1) return sdB3(rotZ(a * 0.3) * rotY(a * 0.8) * (q - vec3(0.0, 0.66, 0.02)), vec3(0.23, 0.66, 0.31)) - 0.008;
  if (kind == 2) {
    q = rotY(0.6 + a) * (q - vec3(0.0, 1.02, 0.0));
    return min(sdB3(q, vec3(0.45, 1.02, 0.022)), length(q - vec3(0.36, 0.0, 0.06)) - 0.03);
  }
  if (kind == 3) {
    q.z -= 0.14;
    float d = min(cap(q, vec3(-0.21, 0.0, 0.0), vec3(-0.21, CH + 0.4, 0.0), 0.02), cap(q, vec3(0.21, 0.0, 0.0), vec3(0.21, CH + 0.4, 0.0), 0.02));
    vec3 r = q;
    r.y = mod(r.y, 0.3) - 0.15;
    return min(d, max(cap(r, vec3(-0.21, 0.0, 0.0), vec3(0.21, 0.0, 0.0), 0.014), q.y - CH));
  }
  if (kind == 4) {
    q = rotZ(a * 0.5) * rotX(-0.2 + a * 0.3) * (q - vec3(0.0, 0.0, 0.42));
    lq = q;
    return min(cap(q, vec3(0.0, -0.3, 0.0), vec3(0.0, 1.9, 0.0), 0.022), sdB3(q - vec3(0.0, 1.75, 0.03), vec3(0.3, 0.3, 0.01)));
  }
  if (kind == 5) {
    q = rotZ(a * 0.4) * rotX(0.15 + a * 0.3) * (q - vec3(0.0, 0.0, 0.45));
    lq = q;
    return min(cap(q, vec3(0.0, -0.3, 0.0), vec3(0.0, 1.95, 0.0), 0.024), max(sdOct(q.xy - vec2(0.0, 1.95), 0.3), abs(q.z - 0.03) - 0.008));
  }
  if (kind == 6) {
    float d = 1e3;
    for (int i = 0; i < 3; i++) {
      vec3 c3 = q - vec3(-0.35 + 0.35 * float(i), 0.0, 0.35 + 0.12 * float(i & 1));
      if (i == 2 && a > 0.0) c3 = rotZ(1.45) * (c3 - vec3(0.0, 0.16, 0.0));
      d = min(d, cone(c3));
    }
    return d;
  }
  if (kind == 7) {
    q -= vec3(0.0, 0.0, 0.45);
    float d = min(tripod(q, 1.25), cap(q, vec3(0.0, 1.2, 0.0), vec3(0.0, 1.7, 0.0), 0.018));
    return min(d, sdB3(rotX(0.5) * (q - vec3(0.0, 1.78, 0.0)), vec3(0.17, 0.12, 0.06)) - 0.01);
  }
  if (kind == 8) {
    q -= vec3(0.0, 0.0, 0.4);
    vec3 cq = rotY(a * 2.0) * (q - vec3(0.0, 1.2, 0.0));
    return min(tripod(q, 1.1), min(sdB3(cq, vec3(0.05, 0.06, 0.11)) - 0.012, cap(cq, vec3(0.0, 0.01, 0.1), vec3(0.0, 0.01, 0.17), 0.03)));
  }
  if (kind == 9) return sdB3(rotY(a * 0.6) * (q - vec3(0.0, 0.25, 0.3)), vec3(0.28, 0.24, 0.25)) - 0.03;
  if (kind == 10) {
    float d = 1e3;
    for (int i = 0; i < 5; i++) {
      ivec2 id = c * 7 + ivec2(i, 3);
      vec3 sz = vec3(0.16, 0.13, 0.15) + 0.1 * vec3(hf(id, 93), hf(id, 94), hf(id, 95));
      vec3 o = vec3((float(i % 3) - 1.0) * 0.36, sz.y + float(i / 3) * 0.3, 0.3 + (hf(id, 96) - 0.5) * 0.12);
      d = min(d, sdB3(rotY((hf(id, 97) - 0.5) * 0.6) * (q - o), sz) - 0.005);
    }
    return d;
  }
  return sdB3(rotX(0.2) * (q - vec3(0.0, 0.98, 0.2)), vec3(0.46, 0.96, 0.08)) - 0.05;
}
// A heap of junk where a pillar should be, in the open rooms: chairs, boxes, cones. Kind tells the material.
float junkPile(vec3 p, out int kind) {
  kind = 0;
  ivec2 r = ivec2(floor((p.xz + 6.0) / 12.0));
  if (hf(r, 31) < 0.8 || hf(r, 85) > 0.65 * min(gObjects, 1.4)) return 1e3;
  int s = int(hf(r, 86) * 4.0);
  vec2 pc = vec2(r) * 12.0 + vec2(s == 0 || s == 1 ? 2.0 : -2.0, s == 0 || s == 2 ? 2.0 : -2.0);
  vec3 q = vec3(p.x - pc.x, p.y, p.z - pc.y);
  float b = length(q - vec3(0.0, 0.6, 0.0)) - 1.35;
  if (b > 0.2) return b;
  float d = 1e3;
  for (int i = 0; i < 7; i++) {
    ivec2 id = r * 8 + ivec2(i, s);
    int it = int(hf(id, 98) * 3.0);
    vec3 o = vec3((hf(id, 87) - 0.5) * 0.9, 0.3 + float(i / 2) * 0.36 + (hf(id, 88) - 0.5) * 0.1, (hf(id, 89) - 0.5) * 0.9) * vec3(1.0 - float(i) * 0.1, 1.0, 1.0 - float(i) * 0.1);
    vec3 lq = rotZ((hf(id, 90) - 0.5) * 2.2) * rotY(hf(id, 91) * 6.28) * rotX((hf(id, 92) - 0.5) * 1.8) * (q - o);
    float di = it == 0 ? chair(lq) : it == 1 ? sdB3(lq, vec3(0.22, 0.17, 0.2)) - 0.005 : cone(lq + vec3(0.0, 0.25, 0.0));
    if (di < d) { d = di; kind = it == 0 ? 0 : it == 1 ? 10 : 6; }
  }
  return d;
}
float objects(vec3 p, out int kind, out vec3 lq) {
  ivec2 c = ivec2(floor(p.xz / G));
  vec2 f = fract(p.xz / G);
  int k1, k2, k3, kp;
  vec3 q1, q2, q3;
  float d1 = objAt(c, p, k1, q1);
  float d2 = objAt(c + ivec2(f.x < 0.5 ? -1 : 1, 0), p, k2, q2);
  float d3 = objAt(c + ivec2(0, f.y < 0.5 ? -1 : 1), p, k3, q3);
  kind = k1; lq = q1;
  float d = d1;
  if (d2 < d) { d = d2; kind = k2; lq = q2; }
  if (d3 < d) { d = d3; kind = k3; lq = q3; }
  float dp = junkPile(p, kp);
  if (dp < d) { d = dp; kind = kp; lq = vec3(0.0, 9.0, 0.0); }
  return d;
}
float solid(vec3 p) { int k; vec3 q; return min(room(p), objects(p, k, q)); }

// ---------------------------------------------------------------- creatures

vec3 kneeOf(vec3 h, vec3 f, float a, float s) {
  vec3 d = f - h;
  float k = sqrt(max(a * a - dot(d, d) * 0.25, 0.0));
  return h + d * 0.5 + normalize(vec3(0.0, d.z, -d.y) + vec3(0.0, 0.0, 1e-3)) * k * s;
}
vec3 footAt(float u, float L, float mv, float side, float lift) {
  float w = clamp(u * 2.0 - 1.0, 0.0, 1.0);
  float z = u < 0.5 ? mix(0.5, -0.5, u * 2.0) : mix(-0.5, 0.5, w * w * (3.0 - 2.0 * w));
  return vec3(side * 0.13, (u < 0.5 ? 0.0 : lift * sin(PI * w)) * mv, mix(side * 0.06, z * L, mv));
}
vec3 toW(vec3 j) { return vec3(gCr.x + j.x * gCC + j.z * gCS, j.y, gCr.y + j.x * gCS - j.z * gCC); }
vec3 toL(vec3 w) { vec2 d = w.xz - gCr; return vec3(dot(d, vec2(gCC, gCS)), w.y, dot(d, vec2(gCS, -gCC))); }
vec3 dragW(vec3 l) { return vec3(gDrag.x + l.x * gDragC + l.z * gDragS, l.y, gDrag.y + l.x * gDragS - l.z * gDragC); }

void rig() {
  float ph = slot(11), sp = slot(28), hun = slot(13), rea = slot(14), la = slot(15) * 0.55, fl = slot(18), ct = gCT;
  float mv = clamp(sp / 0.5, 0.0, 1.0);
  hM = rotZ(slot(17)) * rotY(slot(16));
  gBreath = 1.0 + 0.035 * sin(ct * 1.7);
  gMouth = rea;
  // Now and then a limb spasms — a jerk that does not belong to the walk.
  float spasm = step(0.9, h1(ct * 2.3 + 17.0)) * (h1(ct * 11.0) - 0.5);
  if (gType == 3) {
    // Hound: a starved humanoid on all fours; the spine flexes with the gait, the head bobs low.
    float L = 0.3 + 0.22 * sp, bob = 0.035 * abs(sin(ph)) * mv;
    jH = vec3(0.0, 0.6 + bob, -0.42);
    jC = vec3(0.0, 0.64 + bob + 0.18 * rea + 0.05 * sin(ph * 2.0) * mv, 0.34);
    jHd = jC + vec3(0.03 * sin(ph), 0.02 + 0.08 * rea + 0.03 * sin(ph * 2.0 + 1.0) * mv, 0.3);
    jSL = jC + vec3(-0.15, -0.03, 0.0);
    jSR = jC + vec3(0.15, -0.03, 0.0);
    jHL = jH - vec3(0.13, 0.0, 0.0);
    jHR = jH + vec3(0.13, 0.0, 0.0);
    float u1 = fract(ph / (2.0 * PI)), u2 = fract(ph / (2.0 * PI) + 0.5);
    jWL = footAt(u1, L, mv, -1.3, 0.14) + vec3(0.0, 0.0, jC.z + 0.06);
    jWR = footAt(u2, L, mv, 1.3, 0.14) + vec3(0.0, 0.0, jC.z + 0.06);
    jFL = footAt(u2, L, mv, -1.0, 0.14) + vec3(0.0, 0.0, jH.z - 0.04);
    jFR = footAt(u1, L, mv, 1.0, 0.14) + vec3(0.0, 0.0, jH.z - 0.04);
    jEL = kneeOf(jSL, jWL, 0.38, -1.0);
    jER = kneeOf(jSR, jWR, 0.38, -1.0);
    jKL = kneeOf(jHL, jFL, 0.4, 1.0);
    jKR = kneeOf(jHR, jFR, 0.4, 1.0);
    fLa = jWL + vec3(-0.04, -0.01, 0.07); fLb = jWL + vec3(0.0, -0.01, 0.08); fLc = jWL + vec3(0.04, -0.01, 0.07);
    fRa = jWR + vec3(0.04, -0.01, 0.07); fRb = jWR + vec3(0.0, -0.01, 0.08); fRc = jWR + vec3(-0.04, -0.01, 0.07);
    gTh = 1.0;
    gBC = vec3(0.0, 0.5, 0.1); gBR = 1.2;
  } else {
    // Bipeds: Kane's wire Lifeform (0), its broad hunched kin (1), the pale Howler (2).
    float hip = gType == 2 ? 1.45 : gType == 1 ? 1.12 : 1.24;
    float spine = gType == 2 ? 0.66 : gType == 1 ? 0.56 : 0.6;
    float au = gType == 2 ? 0.84 : 0.72, al = gType == 2 ? 0.84 : 0.7;
    float lg = gType == 2 ? 0.8 : gType == 1 ? 0.64 : 0.7;
    float sw = gType == 2 ? 0.24 : gType == 1 ? 0.3 : 0.36;
    gTh = gType == 1 ? 1.9 : 1.0;
    hun = min(1.0, hun + (gType == 1 ? 0.45 : gType == 2 ? 0.3 : 0.0));
    // Hips sway and twist against the shoulders with each stride.
    jH = vec3(0.045 * sin(ph) * mv, hip + 0.05 * abs(sin(ph)) * mv, 0.0);
    float ha = 0.18 + 0.9 * hun + 0.04 * sin(ct * 1.3);
    jC = jH + vec3(sin(la) * cos(ha), cos(la) * cos(ha), sin(ha)) * spine;
    float tw = 0.28 * sin(ph) * mv;
    vec3 rt = vec3(cos(la) * cos(tw), -sin(la), sin(tw));
    float drop0 = gType == 0 ? 0.12 : 0.0;
    jSL = jC - rt * sw + vec3(0.0, 0.03 * sin(ct * 2.1) - drop0, 0.0);
    jSR = jC + rt * sw - vec3(0.0, drop0, 0.0);
    float hb = ha * 0.6 + 0.35;
    jHd = jC + vec3(sin(la) + 0.02 * sin(ph * 2.0) * mv, cos(hb), sin(hb)) * (gType == 2 ? 0.26 : 0.3);
    vec3 swing = vec3(0.0, 0.0, 0.45 * sin(ph) * mv * (1.0 - rea));
    vec3 fa = fl * vec3(0.3 * sin(ct * 7.3), 0.5 * sin(ct * 9.1 + 1.0), 0.35 * sin(ct * 6.1)) + vec3(0.0, spasm * 1.2, spasm * 0.6);
    vec3 fb = fl * vec3(0.3 * sin(ct * 8.1 + 2.0), 0.5 * sin(ct * 7.7 + 0.3), 0.35 * sin(ct * 5.3 + 1.0));
    vec3 aL = normalize(mix(vec3(-0.2, -1.0, 0.1), vec3(-0.12, 0.25, 1.0), rea) + swing + fa);
    vec3 aR = normalize(mix(vec3(0.2, -1.0, 0.1), vec3(0.12, 0.25, 1.0), rea) - swing + fb);
    jEL = jSL + aL * au;
    jER = jSR + aR * au;
    vec3 bend = vec3(0.0, -0.25 * (1.0 - rea), 0.2 + 0.25 * mv);
    vec3 bL = normalize(aL + bend + fb * 0.6), bR = normalize(aR + bend + fa * 0.6);
    jWL = jEL + bL * al;
    jWR = jER + bR * al;
    if (gDragVis > 0.5) {
      // Dragging: both hands locked on the dead operator's ankles behind it.
      jWL = toL(dragW(vec3(0.1, 0.42, 0.86)));
      jWR = toL(dragW(vec3(-0.09, 0.45, 0.84)));
      jEL = kneeOf(jSL, jWL, au, -1.0);
      jER = kneeOf(jSR, jWR, au, -1.0);
      bL = normalize(jWL - jEL);
      bR = normalize(jWR - jER);
    }
    // Long fingers that curl and twitch.
    float s = 0.25 + 0.35 * rea, cu = 0.12 * sin(ct * 3.1) + 0.1 * (1.0 - rea);
    fLa = jWL + normalize(bL - vec3(s, cu, 0.0)) * 0.34; fLb = jWL + normalize(bL - vec3(0.0, cu, 0.0)) * 0.38; fLc = jWL + normalize(bL + vec3(s, 0.05 - cu, 0.0)) * 0.32;
    fRa = jWR + normalize(bR + vec3(s, -cu, 0.0)) * 0.34; fRb = jWR + normalize(bR - vec3(0.0, cu, 0.0)) * 0.38; fRc = jWR + normalize(bR - vec3(s, cu - 0.05, 0.0)) * 0.32;
    float L = 0.5 + 0.3 * sp;
    jHL = jH - vec3(0.09, 0.0, 0.0);
    jHR = jH + vec3(0.09, 0.0, 0.0);
    jFL = footAt(fract(ph / (2.0 * PI)), L, mv, -1.0, 0.2);
    jFR = footAt(fract(ph / (2.0 * PI) + 0.5), L, mv, 1.0, 0.2);
    jKL = kneeOf(jHL, jFL, lg, 1.0);
    jKR = kneeOf(jHR, jFR, lg, 1.0);
    gBC = vec3(0.0, 1.2, 0.35); gBR = 1.8;
  }
}

// Braided wire: a core strand with two strands twisting round it, per limb segment.
float strand(vec3 q, vec3 a, vec3 b, float r, float ph, float d) {
  float dc = cap(q, a, b, r * 0.8);
  // Strands stay within 2.75 r of the core: far away, the core minus that is a safe bound.
  if (dc > 3.0 * r + 0.02) return min(d, dc - 1.95 * r);
  d = min(d, dc);
  vec3 ax = normalize(b - a + vec3(1e-4));
  vec3 u = normalize(cross(ax, abs(ax.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), v = cross(ax, u);
  for (int k = 0; k < 2; k++) {
    float th = float(k) * PI + ph + gCT * 0.5;
    vec3 o = (u * cos(th) + v * sin(th)) * r * 2.3;
    vec3 m1 = mix(a, b, 0.3) + o, m2 = mix(a, b, 0.7) - o;
    d = min(d, min(cap(q, a, m1, r * 0.45), min(cap(q, m1, m2, r * 0.45), cap(q, m2, b, r * 0.45))));
  }
  return d;
}
float braid(vec3 q) {
  float t = gTh, d = 1e3;
  d = strand(q, jH, jC, 0.02 * t, 0.0, d);
  d = strand(q, jC, mix(jC, jHd, 0.7), 0.015 * t, 1.7, d);
  d = strand(q, jSL, jEL, 0.017 * t, 3.4, d);
  d = strand(q, jEL, jWL, 0.014 * t, 5.1, d);
  d = strand(q, jSR, jER, 0.017 * t, 6.8, d);
  d = strand(q, jER, jWR, 0.014 * t, 8.5, d);
  d = strand(q, jHL, jKL, 0.02 * t, 10.2, d);
  d = strand(q, jKL, jFL, 0.016 * t, 11.9, d);
  d = strand(q, jHR, jKR, 0.02 * t, 13.6, d);
  return strand(q, jKR, jFR, 0.016 * t, 15.3, d);
}
// Three long fingers per hand, a knuckle each, hooked claws.
float hand(vec3 q, vec3 w, vec3 a, vec3 b, vec3 c, float r) {
  float hb = length(q - w) - 0.46;
  if (hb > 0.05) return hb;
  float d = 1e3;
  for (int i = 0; i < 3; i++) {
    vec3 tip = i == 0 ? a : i == 1 ? b : c;
    vec3 kn = mix(w, tip, 0.45) + vec3(0.0, 0.02, 0.0);
    d = min(d, min(cap(q, w, kn, r), cap(q, kn, tip, r * 0.8)));
    d = min(d, rcone(q, tip, tip + normalize(tip - kn) * 0.06 + vec3(0.0, -0.02, 0.0), r * 0.8, 0.002));
  }
  return d;
}
// Kane's Lifeform: pot-shaped head with a lip on a brim, ribbon strands arching out from the neck into arms that
// reach the floor, a braided ladder for a torso, stilt legs. The hunched kin shares the wiring over a thick body.
float wire(vec3 q) {
  float t = gTh;
  float d = braid(q);
  vec3 rp = mix(jH, jC, 0.3), rq = mix(jH, jC, 0.55), rs = mix(jH, jC, 0.8);
  d = min(d, min(min(length(q - rp), length(q - rq)), length(q - rs)) - 0.036 * t);
  d = min(d, min(cap(q, rp - vec3(0.07, 0.0, 0.0), rp + vec3(0.07, 0.03, 0.0), 0.01 * t), cap(q, rs - vec3(0.06, 0.02, 0.0), rs + vec3(0.07, 0.0, 0.01), 0.01 * t)));
  vec3 nk = mix(jC, jHd, 0.35);
  float sb = length(q - nk) - (0.55 + 0.1 * t);
  if (sb > 0.05) d = min(d, sb);
  else for (int i = 0; i < 3; i++) {
    // Coat-hanger shoulders: out, then down to the arm roots.
    float y = float(i) * 0.04, sway = 0.015 * sin(gCT * 2.0 + float(i));
    vec3 ol = vec3(jSL.x - 0.04 - 0.02 * float(i), nk.y - y + sway, nk.z), orr = vec3(jSR.x + 0.04 + 0.02 * float(i), nk.y - y - sway, nk.z);
    d = min(d, min(cap(q, nk - vec3(0.0, y, 0.0), ol, 0.012 * t), cap(q, ol, jSL, 0.011 * t)));
    d = min(d, min(cap(q, nk - vec3(0.0, y, 0.0), orr, 0.012 * t), cap(q, orr, jSR, 0.011 * t)));
  }
  float hbd = length(q - jHd) - 0.32 * t;
  if (hbd > 0.05) d = min(d, hbd);
  else {
    vec3 h = hM * (q - jHd);
    float pot = max(length(h.xz) - 0.12 * t, abs(h.y - 0.02) - 0.075) - 0.02;
    pot = max(pot, -(length(h - vec3(0.0, 0.2, 0.0)) - 0.1));
    pot = min(pot, length(vec2(length(h.xz) - 0.13 * t, h.y - 0.1)) - 0.013);
    d = min(d, min(pot, max(length(h.xz) - 0.2 * t, abs(h.y + 0.06) - 0.008)));
  }
  d = min(d, hand(q, jWL, fLa, fLb, fLc, 0.007 * t));
  d = min(d, hand(q, jWR, fRa, fRb, fRc, 0.007 * t));
  d = min(d, min(cap(q, jFL, jFL + vec3(0.0, 0.0, 0.13), 0.012), cap(q, jFR, jFR + vec3(0.0, 0.0, 0.13), 0.012)));
  d = min(d, min(min(length(q - jEL), length(q - jER)), min(length(q - jKL), length(q - jKR))) - 0.03 * t);
  if (gType == 1) {
    vec3 chest = mix(jH, jC, 0.72);
    float b = ell(q - chest, vec3(0.2 * gBreath, 0.17, 0.16 * gBreath));
    b = smin(b, ell(q - chest - vec3(0.0, 0.08, -0.11), vec3(0.21, 0.17, 0.16)), 0.08);
    b = smin(b, ell(q - jH, vec3(0.13, 0.09, 0.1)), 0.08);
    b = smin(b, rcone(q, jH, chest, 0.08, 0.12), 0.06);
    b = smin(b, rcone(q, jC, jHd, 0.08, 0.05), 0.05);
    b = smin(b, min(rcone(q, jSL, jEL, 0.07, 0.05), rcone(q, jSR, jER, 0.07, 0.05)), 0.05);
    b = smin(b, min(rcone(q, jEL, jWL, 0.05, 0.035), rcone(q, jER, jWR, 0.05, 0.035)), 0.04);
    b = smin(b, min(rcone(q, jHL, jKL, 0.07, 0.05), rcone(q, jHR, jKR, 0.07, 0.05)), 0.05);
    b = smin(b, min(rcone(q, jKL, jFL, 0.05, 0.035), rcone(q, jKR, jFR, 0.05, 0.035)), 0.04);
    d = min(d, b);
  }
  return d;
}
// The Howler: a huge pale hairless figure folded under the ceiling — ribs through the skin, long clawed arms,
// an elongated skull with a jaw, deep eye sockets.
float howler(vec3 q) {
  vec3 chest = mix(jH, jC, 0.72);
  float d = ell(q - jH - vec3(0.0, 0.02, 0.0), vec3(0.16, 0.1, 0.11));
  d = smin(d, rcone(q, jH, chest, 0.07, 0.11), 0.06);
  float rib = ell(q - chest, vec3(0.19 * gBreath, 0.17, 0.13 * gBreath));
  rib += 0.006 * sin((q.y - chest.y) * 70.0) * smoothstep(-0.05, 0.05, q.z - chest.z);
  d = smin(d, rib, 0.06);
  d = smin(d, cap(q, jSL, jSR, 0.05), 0.06);
  d = smin(d, rcone(q, jC, jHd, 0.055, 0.04), 0.04);
  vec3 h = hM * (q - jHd);
  float head = smin(ell(h - vec3(0.0, 0.03, 0.0), vec3(0.095, 0.13, 0.11)), ell(h - vec3(0.0, -0.08, 0.04 + 0.02 * gMouth), vec3(0.07, 0.05, 0.08)), 0.03);
  head = max(head, -ell(h - vec3(0.0, -0.075, 0.11), vec3(0.05, 0.008 + 0.02 * gMouth, 0.04)));
  head = max(head, 0.024 - min(length(h - vec3(0.04, 0.03, 0.1)), length(h - vec3(-0.04, 0.03, 0.1))));
  d = smin(d, head, 0.02);
  d = smin(d, min(rcone(q, jSL, jEL, 0.055, 0.04), rcone(q, jSR, jER, 0.055, 0.04)), 0.04);
  d = smin(d, min(rcone(q, jEL, jWL, 0.04, 0.028), rcone(q, jER, jWR, 0.04, 0.028)), 0.03);
  d = smin(d, min(length(q - jEL), length(q - jER)) - 0.045, 0.02);
  d = min(d, min(hand(q, jWL, fLa, fLb, fLc, 0.012), hand(q, jWR, fRa, fRb, fRc, 0.012)));
  d = smin(d, min(rcone(q, jHL, jKL, 0.075, 0.05), rcone(q, jHR, jKR, 0.075, 0.05)), 0.05);
  d = smin(d, min(rcone(q, jKL, jFL, 0.05, 0.034), rcone(q, jKR, jFR, 0.05, 0.034)), 0.03);
  d = smin(d, min(length(q - jKL), length(q - jKR)) - 0.055, 0.02);
  return min(d, min(cap(q, jFL, jFL + vec3(0.0, 0.0, 0.2), 0.035), cap(q, jFR, jFR + vec3(0.0, 0.0, 0.2), 0.035)));
}
// The Hound: a spine ridge, ribs, bony limbs with clawed hands, a gaping jaw, a curtain of long black hair.
float hound(vec3 q) {
  float d = rcone(q, jH, jC, 0.065, 0.08);
  float rib = ell(q - mix(jH, jC, 0.62), vec3(0.15 * gBreath, 0.13, 0.26));
  rib += 0.005 * sin((q.z - jC.z) * 60.0) * step(q.y, mix(jH.y, jC.y, 0.62));
  d = smin(d, rib, 0.06);
  vec3 sa = q - jH, sv = jC - jH;
  float st = clamp(dot(sa, sv) / dot(sv, sv), 0.0, 1.0);
  vec3 sp = jH + sv * (floor(st * 9.0 + 0.5) / 9.0) + vec3(0.0, 0.07, 0.0);
  d = smin(d, length(q - sp) - 0.03, 0.02);
  d = smin(d, min(ell(q - jSL - vec3(0.0, 0.05, -0.05), vec3(0.06, 0.03, 0.08)), ell(q - jSR - vec3(0.0, 0.05, -0.05), vec3(0.06, 0.03, 0.08))), 0.03);
  d = smin(d, cap(q, jC, jHd, 0.05), 0.04);
  vec3 hq = q - jHd;
  float head = ell(hq, vec3(0.11, 0.1, 0.13));
  head = smin(head, ell(hq - vec3(0.0, -0.08 - 0.05 * gMouth, 0.05), vec3(0.08, 0.035, 0.1)), 0.02);
  head = max(head, -ell(hq - vec3(0.0, -0.05 - 0.025 * gMouth, 0.1), vec3(0.07, 0.02 + 0.03 * gMouth, 0.07)));
  d = smin(d, head, 0.03);
  d = smin(d, min(rcone(q, jSL, jEL, 0.035, 0.028), rcone(q, jSR, jER, 0.035, 0.028)), 0.03);
  d = smin(d, min(rcone(q, jEL, jWL, 0.028, 0.02), rcone(q, jER, jWR, 0.028, 0.02)), 0.02);
  d = smin(d, min(rcone(q, jHL, jKL, 0.045, 0.032), rcone(q, jHR, jKR, 0.045, 0.032)), 0.03);
  d = smin(d, min(rcone(q, jKL, jFL, 0.032, 0.022), rcone(q, jKR, jFR, 0.032, 0.022)), 0.02);
  d = min(d, min(length(q - jEL), length(q - jKL)) - 0.034);
  d = min(d, min(length(q - jER), length(q - jKR)) - 0.034);
  d = min(d, min(hand(q, jWL, fLa, fLb, fLc, 0.01), hand(q, jWR, fRa, fRb, fRc, 0.01)));
  d = min(d, ell(hq - vec3(0.0, 0.06, -0.08), vec3(0.17, 0.11, 0.23)));
  for (int i = 0; i < 10; i++) {
    float x = (float(i) - 4.5) * 0.032;
    vec3 top = jHd + vec3(x, 0.07, -0.02 + 0.03 * float(i & 1));
    d = min(d, cap(q, top, top + vec3(x * 0.7 + 0.03 * sin(gCT * 3.0 + float(i)), -0.4 - 0.07 * float(i % 3), 0.08 + 0.05 * sin(gCT * 2.3 + float(i))), 0.011));
  }
  return d;
}
float creatureLo(vec3 p);
float creature(vec3 p) {
  vec3 q = toL(p);
  float b = length(q - gBC) - gBR;
  if (b > 0.3) return b;
  // Beyond ~14 m the braids and fingers are under a pixel: the coarse capsules draw the same thing.
  if (length(p - gCam) > 14.0) return creatureLo(p) - 0.0009 * length(p - gCam);
  float d = gType == 3 ? hound(q) : gType == 2 ? howler(q) : wire(q);
  // Thin wire stays at least a pixel wide at distance.
  return d - 0.0009 * length(p - gCam);
}
// Coarse capsules: shadows and contact occlusion.
float creatureLo(vec3 p) {
  vec3 q = toL(p);
  float b = length(q - gBC) - gBR;
  if (b > 0.25) return b;
  float t = gType == 2 ? 2.2 : gType == 3 ? 1.8 : gTh;
  float d = min(cap(q, jH, jC, 0.06 * t), length(q - jHd) - 0.13 * t);
  d = min(d, min(cap(q, jSL, jEL, 0.03 * t), cap(q, jSR, jER, 0.03 * t)));
  d = min(d, min(cap(q, jEL, jWL, 0.025 * t), cap(q, jER, jWR, 0.025 * t)));
  d = min(d, min(cap(q, jHL, jKL, 0.035 * t), cap(q, jHR, jKR, 0.035 * t)));
  return min(d, min(cap(q, jKL, jFL, 0.03 * t), cap(q, jKR, jFR, 0.03 * t)));
}
bool bodied() { return gVis > 0.5 && gType != 4; }

// The dead camera operator, on their back, dragged by the ankles toward the creature (+z), arms trailing past the head.
vec3 dragLocal(vec3 p) { vec2 d = p.xz - gDrag; return vec3(dot(d, vec2(gDragC, gDragS)), p.y, dot(d, vec2(gDragS, -gDragC))); }
float operatorBody(vec3 p, out int part) {
  vec3 q = dragLocal(p);
  part = 0;
  float bb = length(q - vec3(0.0, 0.2, 0.0)) - 1.5;
  if (bb > 0.2) return bb;
  float torso = smin(ell(q - vec3(0.0, 0.15, -0.36), vec3(0.2, 0.11, 0.2)), ell(q - vec3(0.0, 0.13, -0.08), vec3(0.17, 0.1, 0.14)), 0.08);
  torso = smin(torso, ell(q - vec3(0.0, 0.14, -0.6), vec3(0.16, 0.08, 0.09)), 0.04);
  float hips = ell(q - vec3(0.0, 0.14, 0.06), vec3(0.17, 0.1, 0.1));
  float head = ell(rotZ(0.5) * (q - vec3(0.02, 0.1, -0.8)), vec3(0.085, 0.1, 0.105));
  head = smin(head, cap(q, vec3(0.0, 0.12, -0.62), vec3(0.01, 0.1, -0.72), 0.045), 0.03);
  vec3 sL = vec3(0.19, 0.15, -0.5), sR = vec3(-0.19, 0.15, -0.5);
  vec3 eL = vec3(0.3, 0.09, -0.83), eR = vec3(-0.27, 0.08, -0.86);
  vec3 hL = vec3(0.27, 0.05, -1.13), hR = vec3(-0.22, 0.05, -1.15);
  float arms = min(min(rcone(q, sL, eL, 0.055, 0.045), rcone(q, eL, hL, 0.045, 0.036)), min(rcone(q, sR, eR, 0.055, 0.045), rcone(q, eR, hR, 0.045, 0.036)));
  float hands = min(ell(q - hL - vec3(0.0, 0.0, -0.06), vec3(0.04, 0.02, 0.07)), ell(q - hR - vec3(0.0, 0.0, -0.06), vec3(0.04, 0.02, 0.07)));
  vec3 kL = vec3(0.1, 0.22, 0.45), kR = vec3(-0.1, 0.25, 0.43), aL = vec3(0.1, 0.4, 0.86), aR = vec3(-0.09, 0.43, 0.84);
  float legs = min(min(rcone(q, vec3(0.09, 0.13, 0.08), kL, 0.075, 0.055), rcone(q, kL, aL, 0.055, 0.04)), min(rcone(q, vec3(-0.09, 0.13, 0.08), kR, 0.075, 0.055), rcone(q, kR, aR, 0.055, 0.04)));
  legs = smin(legs, hips, 0.05);
  float shoes = min(sdB3(q - aL - vec3(0.0, 0.09, 0.02), vec3(0.045, 0.12, 0.05)) - 0.02, sdB3(q - aR - vec3(0.0, 0.09, 0.02), vec3(0.045, 0.12, 0.05)) - 0.02);
  float d = min(min(torso, head), min(min(arms, hands), min(legs, shoes)));
  part = d == legs ? 1 : d == head ? 2 : d == arms ? 3 : d == hands ? 4 : d == shoes ? 5 : 0;
  return d;
}
float map(vec3 p) {
  float d = solid(p);
  if (gDragVis > 0.5) { int pt; d = min(d, operatorBody(p, pt)); }
  return bodied() ? min(d, creature(p)) : d;
}

// ---------------------------------------------------------------- light: troffers, tripod lamps, TVs, shadows

vec2 lampC(ivec2 q, int a) { return vec2(q) * G + (a == 0 ? vec2(2.333, 0.0) : vec2(0.0, 2.333)); }
float lampOn(ivec2 q, int a) {
  if (walled(q.x, q.y, a)) return 0.0;
  float r = hf(q, 40 + a), r2 = hf(q, 50 + a);
  if (r < 0.07 * gDark || hf(ivec2(floor(vec2(q) / 5.0)), 60) < 0.12 * gDark) return 0.0;
  // A Smiler only shows in the dark: the tubes around it are dead.
  if (gType == 4 && gVis > 0.5 && length(lampC(q, a) - gCr) < 9.0) return 0.0;
  float on = 0.86 + 0.2 * r2;
  if (r2 < 0.07 * gDark) on *= step(0.3, h1(uTime * 13.0 + r * 97.0));
  float nearC = gHush * smoothstep(12.0, 3.0, length(lampC(q, a) - gCr));
  return on * mix(1.0, 0.35 + 0.65 * step(0.4, h1(uTime * 17.0 + r * 31.0)), nearC);
}
float segSeg(vec3 p1, vec3 q1, vec3 p2, vec3 q2) {
  vec3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
  float a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
  float den = a * e - b * b;
  float s = den > 1e-6 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
  float t = (b * s + f) / e;
  if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); }
  else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
  return length(p1 + d1 * s - p2 - d2 * t);
}
// Soft shadow of the creature's real shape toward a light: a short march through its bound only.
float crShadow(vec3 p, vec3 lp) {
  vec3 rd = lp - p;
  float tl = length(rd);
  rd /= tl;
  vec3 cb = toW(gBC);
  float tc = clamp(dot(cb - p, rd), 0.0, tl);
  if (length(p + rd * tc - cb) > gBR + 0.1) return 1.0;
  float s = 1.0, t = max(gSelf ? 0.14 : 0.03, tc - gBR - 0.1), tend = min(tl, tc + gBR + 0.1);
  for (int i = 0; i < 14; i++) {
    float h = creatureLo(p + rd * t);
    s = min(s, 9.0 * h / t);
    t += clamp(h, 0.02, 0.25);
    if (s < 0.02 || t > tend) break;
  }
  return clamp(s, 0.0, 1.0);
}
// Shadows of the camera operator (while they still hold it) and of the creature.
float bodyShadow(vec3 p, vec3 lp) {
  if (gShadows < 0.5) return 1.0;
  float s = gDragVis > 0.5 ? 1.0 : smoothstep(0.08, 0.42, segSeg(p, lp, gBodyA, gBodyB));
  if (bodied()) s = min(s, crShadow(p, lp));
  return mix(0.15, 1.0, s);
}
// Work lights on tripods and TVs showing static light their surroundings.
vec2 objLights(vec3 p, vec3 n) {
  vec2 e = vec2(0.0);
  ivec2 c0 = ivec2(floor(p.xz / G));
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    int k;
    vec2 base, tg, o2;
    if (!objFrame(c0 + ivec2(i, j), k, base, tg, o2) || (k != 7 && k != 9)) continue;
    vec2 lxz = base + o2 * (k == 7 ? 0.55 : 0.6);
    vec3 L = vec3(lxz.x, k == 7 ? 1.72 : 0.28, lxz.y) - p;
    float d2 = dot(L, L);
    float w = (k == 7 ? 3.5 : 0.35 * (0.6 + 0.4 * h1(uTime * 20.0))) / (d2 + 0.3) * smoothstep(64.0, 9.0, d2);
    e += w * vec2(max(dot(n, L * inversesqrt(d2)), 0.0), 0.4);
  }
  return e;
}
// x: direct light on the surface; y: how lit the surroundings are (drives bounce, so dead zones go dark).
vec2 irr(vec3 p, vec3 n) {
  ivec2 c = ivec2(floor(p.xz / G + 0.5));
  bool near = (gDragVis < 0.5 && length(p.xz - gCam.xz) < 7.0) || (bodied() && length(p.xz - gCr) < 7.0);
  vec2 e = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) for (int a = 0; a < 2; a++) {
    ivec2 q = c + ivec2(i, j);
    vec2 lc = lampC(q, a);
    vec3 lp = vec3(lc.x, CH - 0.02, lc.y), L = lp - p;
    float d2 = dot(L, L);
    if (d2 > 49.0) continue;
    float on = lampOn(q, a);
    if (on <= 0.0) continue;
    vec3 l = L * inversesqrt(d2);
    float w = on * smoothstep(49.0, 20.0, d2) / (d2 + 0.4);
    e.y += w * max(l.y, 0.25);
    float k = max(dot(n, l), 0.0) * max(l.y, 0.0);
    if (k <= 0.0) continue;
    float wk = w * k;
    float sh = 1.0;
    if (wk > 0.006) {
      vec3 m1 = p + L * 0.4, m2 = p + L * 0.75;
      sh = smoothstep(-0.05, 0.25, min(walls(m1.xz), walls(m2.xz)));
      if (near && sh > 0.0) sh *= bodyShadow(p, lp);
    }
    e.x += wk * sh;
  }
  return e * 3.2 + objLights(p, n);
}
float lampRect(vec2 xz, out float on) {
  ivec2 c = ivec2(floor(xz / G + 0.5));
  float best = 1e3;
  on = 0.0;
  for (int k = 0; k < 4; k++) {
    int a = k & 1;
    ivec2 q = c - (k < 2 ? ivec2(0) : ivec2(1 - a, a));
    float dd = sdB(xz - lampC(q, a), a == 0 ? vec2(0.6667, 0.3333) : vec2(0.3333, 0.6667));
    if (dd < best) { best = dd; on = lampOn(q, a); }
  }
  return best;
}
// Wet highlights from the tubes overhead.
vec3 lampSpec(vec3 p, vec3 n, vec3 rd, float pw) {
  ivec2 c = ivec2(floor(p.xz / G + 0.5));
  vec3 s = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    int a = k & 1;
    ivec2 q = c - (k < 2 ? ivec2(0) : ivec2(1 - a, a));
    vec2 lc = lampC(q, a);
    float on = lampOn(q, a);
    if (on <= 0.0) continue;
    vec3 l = normalize(vec3(lc.x, CH - 0.02, lc.y) - p);
    s += on * pow(max(dot(n, normalize(l - rd)), 0.0), pw) * max(dot(n, l), 0.0);
  }
  return s * vec3(1.0, 0.97, 0.86);
}
float ao(vec3 p, vec3 n) {
  float o = 0.0, w = 1.0;
  bool nc = bodied() && length(p.xz - gCr) < 2.2;
  for (int i = 1; i <= 4; i++) {
    float h = 0.05 * float(i * i);
    vec3 x = p + n * h;
    float d = solid(x);
    if (nc && !gSelf) d = min(d, creatureLo(x));
    o += w * (h - d);
    w *= 0.6;
  }
  return clamp(1.0 - o * 1.2, 0.0, 1.0);
}
vec3 litE(vec3 alb, vec3 p, vec3 n, float amb, out vec2 e) {
  e = irr(p, n);
  return alb * (vec3(1.0, 0.97, 0.86) * e.x + vec3(0.95, 0.85, 0.5) * amb * (0.12 + 1.1 * e.y)) * mix(0.3, 1.0, ao(p, n));
}
vec3 lit(vec3 alb, vec3 p, vec3 n, float amb) { vec2 e; return litE(alb, p, n, amb, e); }
vec3 bumpN(vec3 p, vec3 n, float f, float k) {
  vec3 g = vec3(vn(p.yz * f, 150), vn(p.xz * f, 151), vn(p.xy * f, 152)) - 0.5;
  return normalize(n + k * (g - n * dot(g, n)));
}

// ---------------------------------------------------------------- writing on the walls

float glyph(vec2 g, int c) {
  float d = 9.0;
  ivec2 k = ivec2(floor(g));
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 cc = k + ivec2(i, j);
    if (cc.x < 0 || cc.x > 4 || cc.y < 0 || cc.y > 5) continue;
    if (((FONT[c] >> uint(cc.y * 5 + cc.x)) & 1u) == 0u) continue;
    d = min(d, length(g - vec2(cc) - 0.5));
  }
  return smoothstep(0.62, 0.42, d);
}
// Marker handwriting: each letter wobbles off the baseline.
float scrawl(vec2 lp, int start, int len, float hgt, int seed) {
  float x = lp.x + float(len) * hgt * 0.5;
  float ci = floor(x / hgt);
  if (ci < 0.0 || ci >= float(len) || abs(lp.y) > hgt * 0.7) return 0.0;
  int c = TXT[start + int(ci)];
  if (c < 0) return 0.0;
  ivec2 id = ivec2(int(ci), seed);
  vec2 g = vec2((x - ci * hgt) / hgt * 6.0 - 0.5 + (hf(id, 130) - 0.5) * 0.6, (0.5 - lp.y / hgt) * 6.0 + (hf(id, 131) - 0.5) * 0.8);
  return glyph(g, c);
}
float graffiti(vec3 p, vec3 n) {
  bool xw = abs(n.x) > abs(n.z);
  float u = xw ? p.z : p.x, cu = floor(u / 2.0 + 0.5) * 2.0;
  ivec2 id = ivec2(int(cu), int(floor((xw ? p.x : p.z) * 4.0)));
  if (hf(id, 120) > 0.085 * gWriting) return 0.0;
  float r = (hf(id, 123) - 0.5) * 0.12;
  vec2 lp = mat2(cos(r), sin(r), -sin(r), cos(r)) * vec2((u - cu) * (xw ? -n.x : n.z), p.y - 1.35 - (hf(id, 122) - 0.5) * 0.3);
  int d = int(hf(id, 121) * 8.0);
  float ink = 0.0;
  if (d == 0) ink = max(scrawl(lp - vec2(0.0, 0.12), 0, 9, 0.15, id.x), scrawl(lp + vec2(0.0, 0.12), 9, 10, 0.15, id.x + 7));
  else if (d == 1) {
    vec2 a = lp * vec2(hf(id, 124) < 0.5 ? -1.0 : 1.0, 1.0);
    float w = 0.022 + 0.004 * sin(a.x * 40.0);
    ink = smoothstep(w + 0.006, w - 0.004, min(seg2(a, vec2(-0.45, 0.0), vec2(0.4, 0.01)), min(seg2(a, vec2(0.42, 0.0), vec2(0.24, 0.14)), seg2(a, vec2(0.42, 0.0), vec2(0.25, -0.13)))));
  } else if (d == 2) {
    // The face from Kane's wall: slanted almond eyes, a nose, a crossed window above.
    vec2 eq = mat2(0.94, -0.34, 0.34, 0.94) * (vec2(abs(lp.x), lp.y) - vec2(0.13, 0.02));
    ink = smoothstep(1.05, 0.9, length(eq / vec2(0.085, 0.03))) * smoothstep(0.006, 0.012, length(eq - vec2(0.02, 0.005)));
    ink = max(ink, smoothstep(0.012, 0.006, min(seg2(lp, vec2(0.0, -0.06), vec2(-0.03, -0.11)), seg2(lp, vec2(-0.03, -0.11), vec2(0.03, -0.11)))));
    vec2 wq = lp - vec2(0.0, 0.36);
    ink = max(ink, smoothstep(0.011, 0.006, min(abs(sdB(wq, vec2(0.1))), sdB(wq, vec2(0.1)) < 0.0 ? min(abs(wq.x), abs(wq.y)) : 1.0)));
  } else if (d == 3) ink = scrawl(lp, 19, 4, 0.22, id.x);
  else if (d == 4) {
    ink = scrawl(lp + vec2(0.0, 0.14), 23, 7, 0.13, id.x);
    vec2 t = lp - vec2(-0.3, 0.12);
    float grp = floor(t.x / 0.16);
    if (grp >= 0.0 && grp < 4.0 && abs(t.y) < 0.08) {
      float lx = t.x - grp * 0.16;
      ink = max(ink, step(lx, 0.11) * smoothstep(0.006, 0.003, abs(fract(lx / 0.028) - 0.5) * 0.028));
      ink = max(ink, smoothstep(0.007, 0.003, seg2(vec2(lx, t.y), vec2(-0.01, -0.07), vec2(0.13, 0.07))));
    }
  } else if (d == 5) ink = max(scrawl(lp - vec2(0.0, 0.12), 30, 10, 0.14, id.x), scrawl(lp + vec2(0.0, 0.1), 40, 3, 0.14, id.x + 3));
  else if (d == 6) {
    // Frantic scribble: tangled looping strokes.
    for (int i = 0; i < 4; i++) {
      float k = float(i), ph = hf(id, 126 + i) * 6.28;
      float cy = 0.12 * sin(lp.x * (7.0 + 3.0 * k) + ph + 1.8 * sin(lp.x * (19.0 + 5.0 * k) + ph)) + 0.05 * sin(lp.x * 37.0 + ph * 2.0) + (k - 1.5) * 0.05;
      ink = max(ink, step(abs(lp.x), 0.48 - 0.06 * k) * smoothstep(0.014, 0.006, abs(lp.y - cy)));
    }
  } else {
    // RUN, over and over.
    vec2 g = vec2(lp.x, mod(lp.y + 0.3, 0.2) - 0.1);
    ink = step(abs(lp.y), 0.3) * scrawl(g + vec2((floor((lp.y + 0.3) / 0.2) - 1.0) * 0.05, 0.0), 43, 3, 0.12, id.x + int(floor(lp.y * 5.0)));
  }
  return ink * (0.8 + 0.2 * vn(lp * 60.0, 125));
}

// ---------------------------------------------------------------- the drag trail

// Blood on the carpet: a pool where it happened, then a smear along the path the body was actually dragged —
// uneven width, streaked along the pull, broken in places, with drips beside it, thinning as it goes.
float bloodTrail(vec2 x) {
  int n = int(slot(62) + 0.5);
  if (n < 1) return 0.0;
  vec2 p0 = vec2(slot(46), slot(47));
  float pool = smoothstep(0.08, -0.06, length(x - p0) - 0.34 - 0.14 * (vn(x * 5.0, 175) - 0.5));
  float trail = 0.0, run = 0.0;
  vec2 a = p0;
  for (int i = 1; i < 8; i++) {
    if (i >= n) break;
    vec2 b = vec2(slot(46 + 2 * i), slot(47 + 2 * i));
    vec2 ab = b - a;
    float l = max(length(ab), 1e-3);
    vec2 dir = ab / l, nrm = vec2(-dir.y, dir.x);
    float h = clamp(dot(x - a, dir), 0.0, l);
    float across = dot(x - a, nrm), s = run + h;
    float w = 0.16 + 0.07 * vn(vec2(s * 1.7, 3.0), 176);
    float fade = mix(1.0, 0.45, smoothstep(0.0, 14.0, s));
    float streak = 0.55 + 0.45 * vn(vec2(s * 3.0, across * 26.0), 177);
    float gaps = smoothstep(0.25, 0.45, vn(vec2(s * 0.9, 7.0), 178));
    float d = length(x - (a + dir * h));
    trail = max(trail, smoothstep(w, w * 0.45, d) * streak * gaps * fade);
    // Drips thrown beside the smear.
    vec2 cell = floor(vec2(s, across) * vec2(3.0, 5.0));
    float dr = hf(ivec2(cell), 179);
    vec2 dc = (vec2(s, across) - (cell + vec2(0.5, hf(ivec2(cell), 180))) / vec2(3.0, 5.0)) * vec2(3.0, 5.0);
    trail = max(trail, step(0.82, dr) * step(abs(across), 0.45) * step(0.0, s) * step(s, run + l) * smoothstep(0.35, 0.15, length(dc)) * fade * 0.9);
    run += l;
    a = b;
  }
  return clamp(max(pool, trail), 0.0, 1.0);
}

// ---------------------------------------------------------------- surfaces

vec3 surface(vec3 p, vec3 n, vec3 rd, float dist) {
  float fw = dist * 0.0012 + 0.0008;
  float det = smoothstep(0.02, 0.005, fw);
  vec3 alb, emit = vec3(0.0);
  float amb = 0.2, gloss = 0.0;
  if (n.y > 0.5) {
    // Damp mustard carpet: fibre, wear, dark wet patches — and where the body was dragged, a wet red smear.
    vec2 x = p.xz;
    float fine = mix(0.5, vn(x * 60.0, 1) * 0.6 + vn(x * 150.0, 2) * 0.4, smoothstep(0.03, 0.006, fw));
    float damp = smoothstep(0.56, 0.78, fbm(x * 0.28 + 3.0, 4));
    alb = vec3(0.30, 0.22, 0.085) * (0.82 + 0.3 * fine) * (0.85 + 0.3 * fbm(x * 0.9, 3));
    alb = mix(alb, alb * vec3(0.55, 0.46, 0.33), damp);
    amb = 0.15;
    gloss = damp;
    if (gDragVis > 0.5) {
      float smear = bloodTrail(x);
      alb = mix(alb, vec3(0.09, 0.012, 0.01), smear * 0.88);
      gloss = max(gloss, smear * 1.5);
    }
  } else if (n.y < -0.5) {
    // Acoustic drop ceiling, T-bar grid, recessed troffers.
    vec2 x = p.xz - 0.3333;
    vec2 tq = x / 0.6667, tf = fract(tq);
    ivec2 tid = ivec2(floor(tq));
    float edge = min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)) * 0.6667;
    alb = vec3(0.50, 0.46, 0.32) * (0.9 + 0.1 * vn(x * 3.0, 5)) * (1.0 - 0.22 * step(0.8, vn(x * 70.0, 6)) * det);
    if (hf(tid, 70) < 0.07) alb *= 1.0 - 0.3 * smoothstep(0.42, 0.18, length(tf - 0.5 - 0.15 * vec2(hf(tid, 71), hf(tid, 72))));
    if (hf(tid, 73) < 0.004) alb = vec3(0.012);
    alb = mix(alb, vec3(0.58, 0.56, 0.5), 1.0 - smoothstep(0.011, 0.011 + fw, edge));
    float on;
    float dd = lampRect(p.xz, on);
    if (dd < 0.0) {
      alb = vec3(0.36, 0.35, 0.3);
      if (dd < -0.035) emit = vec3(1.0, 0.97, 0.86) * on * 6.5 * (0.94 + 0.06 * step(0.5, fract((p.x + p.z) * 30.0)) * det);
    } else emit = vec3(1.0, 0.95, 0.8) * on * 0.45 * exp(-dd * 7.0);
    amb = 0.24;
  } else {
    // Mono-yellow wallpaper: chevron stripes, mottling, sheet seams, damp tide line, baseboard, outlets, writing.
    float u = abs(n.x) > abs(n.z) ? p.z : p.x, v = p.y;
    float s = fract(u / 0.16);
    float cv = abs(fract(v * 6.5 + abs(s - 0.75) * 2.4) - 0.5);
    float pat = (0.08 * step(0.5, s) * smoothstep(0.1, 0.04, cv) + 0.05 * (smoothstep(0.03, 0.0, abs(s - 0.5)) + smoothstep(0.03, 0.0, min(s, 1.0 - s)))) * det;
    alb = vec3(0.60, 0.53, 0.2) * (0.86 + 0.24 * fbm(vec2(u, v) * 1.4, 8)) * (1.0 - pat);
    alb *= 1.0 + 0.1 * smoothstep(0.004 + fw, 0.0, abs(fract(u / 0.533 + 0.5) - 0.5) * 0.533) * det;
    float th = 0.1 + 0.32 * fbm(vec2(u * 0.6, 3.0), 9);
    alb = mix(alb, alb * vec3(0.66, 0.56, 0.34), smoothstep(th, th - 0.2, v) * 0.75);
    alb *= (1.0 - 0.18 * exp(-abs(v - th) * 45.0)) * (1.0 - 0.14 * smoothstep(0.62, 0.82, vn(vec2(u, v) * 0.8 + 11.0, 10)));
    if (v < 0.095) alb = vec3(0.34, 0.27, 0.12) * (0.9 + 0.1 * vn(vec2(u * 8.0, v * 40.0), 12)) * (1.0 + 0.4 * smoothstep(0.08, 0.095, v));
    ivec2 fid = ivec2(floor(p.xz / G)) * 2 + ivec2(step(0.0, n.xz));
    vec2 ol = vec2(u - floor(u / G) * G - 2.0 - 0.4 * (hf(fid, 13) - 0.5), v - 0.36);
    if (hf(fid, 14) < 0.3 && abs(ol.x) < 0.04 && abs(ol.y) < 0.065) {
      alb = vec3(0.52, 0.48, 0.36);
      if (abs(abs(ol.y) - 0.025) < 0.012 && abs(abs(ol.x) - 0.008) < 0.003) alb *= 0.2;
    }
    alb = mix(alb, vec3(0.03, 0.03, 0.035), graffiti(p, n) * 0.9);
  }
  vec2 e;
  vec3 col = litE(alb, p, n, amb, e) + emit;
  if (gloss > 0.02) col += gloss * (0.06 * e.x * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) + 0.15 * lampSpec(p, n, rd, 60.0));
  return col;
}
vec3 objectShade(vec3 p, vec3 n, vec3 rd, int k, vec3 q) {
  vec3 alb = vec3(0.2, 0.22, 0.2), emit = vec3(0.0);
  float spec = 0.0;
  if (k == 0) { alb = vec3(0.04, 0.04, 0.045); spec = 0.2; }
  else if (k == 1) alb = vec3(0.34, 0.33, 0.29) * (1.0 - 0.6 * smoothstep(0.012, 0.004, abs(fract(p.y / 0.33 + 0.5) - 0.5) * 0.33));
  else if (k == 2) alb = vec3(0.4, 0.33, 0.22) * (0.85 + 0.15 * vn(vec2(p.y * 3.0, (p.x + p.z) * 40.0), 170));
  else if (k == 3) { alb = vec3(0.26, 0.26, 0.25); spec = 0.4; }
  else if (k == 4 && q.y > 1.45 && q.y < 2.05) {
    // Turn-only sign plate: white with a black arrow.
    vec2 s = vec2(q.x / 0.3 * 0.5 + 0.5, (q.y - 1.75) / 0.3);
    float arrow = smoothstep(0.08, 0.04, min(seg2(s, vec2(0.5, -0.7), vec2(0.5, 0.5)), min(seg2(s, vec2(0.5, 0.6), vec2(0.3, 0.3)), seg2(s, vec2(0.5, 0.6), vec2(0.7, 0.3)))));
    alb = mix(vec3(0.62, 0.62, 0.58), vec3(0.03), arrow);
  } else if (k == 5 && q.y > 1.62) {
    // STOP: red octagon, white rim and letters.
    vec2 s = q.xy - vec2(0.0, 1.95);
    float o = sdOct(s, 0.3);
    alb = o > -0.025 ? vec3(0.62) : vec3(0.42, 0.02, 0.02);
    int st[4] = int[4](16, 17, 13, 14);
    float ci = floor((s.x + 0.2) / 0.1);
    if (ci >= 0.0 && ci < 4.0 && abs(s.y) < 0.06) {
      vec2 g = vec2((s.x + 0.2 - ci * 0.1) / 0.1 * 6.0 - 0.5, (0.06 - s.y) / 0.12 * 6.0);
      alb = mix(alb, vec3(0.62), glyph(g, st[int(ci)]));
    }
    spec = 0.3;
  } else if (k == 6) {
    alb = vec3(0.55, 0.14, 0.02);
    float band = step(0.23, q.y) * step(q.y, 0.31) + step(0.4, q.y) * step(q.y, 0.45);
    if (q.y < 0.03) alb = vec3(0.04);
    alb = mix(alb, vec3(0.7, 0.7, 0.66), band * step(0.05, q.y));
    spec = 0.2;
  } else if (k == 7) {
    alb = vec3(0.12, 0.11, 0.1);
    vec3 hq = rotX(0.5) * (q - vec3(0.0, 0.0, 0.45) - vec3(0.0, 1.78, 0.0));
    if (hq.z > 0.05 && abs(hq.x) < 0.15 && abs(hq.y) < 0.1) emit = vec3(1.0, 0.86, 0.62) * 9.0;
    else if (length(hq) < 0.3) alb = vec3(0.5, 0.36, 0.05);
  } else if (k == 8) {
    alb = vec3(0.05);
    vec3 cq = q - vec3(0.0, 1.2, 0.4);
    if (length(cq - vec3(0.03, 0.07, 0.08)) < 0.03) emit = vec3(1.0, 0.05, 0.02) * 4.0 * step(0.5, fract(uTime));
    spec = 0.3;
  } else if (k == 9) {
    alb = vec3(0.14, 0.13, 0.12);
    vec3 tq = q - vec3(0.0, 0.25, 0.3);
    if (tq.z > 0.2 && abs(tq.x) < 0.22 && abs(tq.y) < 0.18) {
      float stat = hf(ivec2(floor(tq.xy * 220.0)), int(uTime * 30.0) & 1023);
      emit = vec3(0.7, 0.75, 0.85) * (0.3 + 0.9 * stat) * (0.85 + 0.15 * sin(tq.y * 400.0 + uTime * 60.0));
      alb = vec3(0.05);
    }
  } else if (k == 10) {
    alb = vec3(0.42, 0.3, 0.16) * (0.85 + 0.15 * vn(p.xz * 12.0 + p.y * 7.0, 171));
    if (abs(fract((p.x + p.z) * 3.1) - 0.5) < 0.04) alb = vec3(0.5, 0.42, 0.26);
  } else if (k == 11) {
    alb = vec3(0.55, 0.5, 0.36) * (1.0 - 0.2 * step(0.9, fract(p.y * 5.0)) - 0.1 * step(0.9, fract((p.x + p.z) * 5.0)));
    alb = mix(alb, vec3(0.32, 0.22, 0.08), smoothstep(0.55, 0.8, fbm(vec2(p.x + p.z, p.y) * 2.5, 172)) * 0.7);
  }
  vec3 col = lit(alb, p, n, 0.2) + emit;
  return spec > 0.0 ? col + spec * 0.2 * lampSpec(p, n, rd, 40.0) : col;
}
vec3 creatureShade(vec3 p, vec3 n, vec3 rd) {
  vec3 q = toL(p);
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
  gSelf = true;
  if (gType == 2) {
    // Pale, matte, faintly veined; glowing eyes deep in the sockets; a red circle on the chest that runs.
    vec3 nb = bumpN(p, n, 30.0, 0.25);
    vec2 ee = irr(p, nb);
    float e = ee.x + 0.3 * ee.y;
    float veins = smoothstep(0.03, 0.0, abs(fbm(q.xy * 6.0 + q.z * 3.0, 142) - 0.5)) * 0.35;
    vec3 skin = vec3(0.4, 0.39, 0.37) * (0.88 + 0.24 * vn(q.xy * 9.0, 140)) * (1.0 - veins * vec3(0.8, 0.7, 0.4));
    vec3 cc = mix(jH, jC, 0.72) + vec3(0.0, 0.0, 0.1);
    vec2 cd = (q - cc).xy;
    float circle = (smoothstep(0.1, 0.09, length(cd)) + smoothstep(0.012, 0.0, abs(cd.x - 0.03 * sin(cd.y * 20.0) - 0.05)) * step(cd.y, 0.0) * step(-0.35, cd.y)) * step(cc.z - 0.07, q.z);
    skin = mix(skin, vec3(0.34, 0.02, 0.015), clamp(circle, 0.0, 1.0));
    vec3 c = skin * (e + 0.2) * mix(0.4, 1.0, ao(p, n)) + 0.05 * lampSpec(p, nb, rd, 20.0);
    vec3 eh = hM * (q - jHd);
    if (eh.y < -0.06 && eh.y > -0.1 && eh.z > 0.08 && abs(eh.x) < 0.05) c = vec3(0.02);
    if (min(length(eh - vec3(0.04, 0.03, 0.09)), length(eh - vec3(-0.04, 0.03, 0.09))) < 0.018) c = vec3(3.2);
    gSelf = false;
    return c;
  }
  if (gType == 3) {
    // Grey, dirty skin over ribs; black hair; a gaping mouth of white teeth; pale eyes.
    vec3 hq = q - jHd;
    vec3 nb = bumpN(p, n, 45.0, 0.3);
    vec2 ee = irr(p, nb);
    float e = ee.x + 0.3 * ee.y;
    vec3 c = vec3(0.12, 0.11, 0.1) * (0.8 + 0.4 * fbm(q.xz * 8.0 + q.y * 5.0, 143)) * (e + 0.2);
    bool fur = q.y > mix(jH.y, jC.y, 0.5) - 0.02 || (hq.z < 0.06 && length(hq) < 0.5 && hq.y > -0.45);
    if (fur) c = vec3(0.014, 0.013, 0.012) * (e + 0.3) * (0.6 + 0.8 * vn(vec2(q.x * 60.0, q.y * 8.0 + q.z * 8.0), 141)) + fres * 0.05 + 0.06 * lampSpec(p, nb, rd, 30.0);
    if (hq.z > 0.05 && hq.y < -0.03 && hq.y > -0.12 - 0.04 * gMouth && abs(hq.x) < 0.07) {
      float mouthY = -0.05 - 0.025 * gMouth;
      float tooth = step(abs(fract(hq.x * 55.0) - 0.5) * 2.0, 1.0 - abs(hq.y - mouthY) / (0.02 + 0.03 * gMouth));
      c = mix(vec3(0.02, 0.005, 0.005), vec3(0.9, 0.88, 0.78) * (0.4 + e), tooth);
    }
    if (min(length(hq - vec3(0.045, 0.03, 0.1)), length(hq - vec3(-0.045, 0.03, 0.1))) < 0.016) c = vec3(1.4);
    gSelf = false;
    return c * mix(0.4, 1.0, ao(p, n));
  }
  // Wire and its hunched kin: near-black brown, fibrous, wet — highlights from the actual tubes above.
  vec3 nb = bumpN(p, n, gType == 1 ? 25.0 : 60.0, gType == 1 ? 0.35 : 0.5);
  vec2 ee = irr(p, nb);
  float e = ee.x + 0.3 * ee.y;
  vec3 alb = vec3(0.03, 0.023, 0.018);
  if (gType == 1) alb *= 0.8 + 0.5 * smoothstep(0.02, 0.0, abs(fbm(q.xy * 7.0 + q.z * 4.0, 144) - 0.5));
  gSelf = false;
  return alb * (e + 0.25) * mix(0.5, 1.0, ao(p, n)) + (0.35 * lampSpec(p, nb, rd, gType == 1 ? 40.0 : 90.0) + vec3(1.0, 0.95, 0.7) * fres * 0.08) * (0.4 + 0.6 * e);
}
// The dead operator: an olive hoodie with folds, worn indigo jeans, scuffed sneakers, grey skin, blood.
vec3 bodyShade(vec3 p, vec3 n, vec3 rd, int part, float dist) {
  vec3 q = dragLocal(p);
  float fw = dist * 0.0012 + 0.0008;
  vec3 alb;
  float wet = 0.0;
  vec3 nb = n;
  if (part == 0 || part == 3) {
    float fold = 0.5 + 0.5 * sin(q.z * 38.0 + 6.0 * vn(q.xz * 6.0, 161) + q.x * 12.0);
    nb = bumpN(p, n, 90.0, 0.25);
    alb = vec3(0.055, 0.068, 0.04) * (0.75 + 0.35 * fold) * (0.9 + 0.2 * vn(q.xz * 180.0, 162) * smoothstep(0.02, 0.005, fw));
    wet = smoothstep(0.6, 0.8, fbm(q.xz * 5.0 + q.y * 4.0, 163)) * step(q.z, -0.2);
  } else if (part == 1) {
    // Denim twill.
    float tw = abs(fract((q.x + q.z) * 160.0 + q.y * 80.0) - 0.5);
    alb = vec3(0.045, 0.065, 0.12) * (0.85 + 0.25 * smoothstep(0.1, 0.4, tw) * smoothstep(0.02, 0.004, fw));
    alb = mix(alb, vec3(0.12, 0.15, 0.22), smoothstep(0.6, 0.9, fbm(q.xz * 4.0, 164)) * 0.5);
  } else if (part == 5) {
    float lq = q.y - 0.4;
    alb = lq > 0.17 ? vec3(0.06) : vec3(0.48, 0.46, 0.42) * (0.8 + 0.2 * vn(q.xy * 40.0, 165));
  } else {
    bool hair = part == 2 && q.y > 0.15 && q.z < -0.78;
    alb = hair ? vec3(0.035, 0.025, 0.018) * (0.7 + 0.6 * vn(vec2(q.x * 120.0, q.z * 20.0), 166)) : vec3(0.3, 0.27, 0.27) * (0.85 + 0.2 * vn(q.xy * 20.0, 167));
    wet = smoothstep(0.55, 0.75, fbm(q.xz * 7.0, 168));
  }
  alb = mix(alb, vec3(0.1, 0.012, 0.01), wet * 0.9);
  vec3 col = lit(alb, p, nb, 0.2);
  return wet > 0.02 ? col + wet * 0.25 * lampSpec(p, nb, rd, 80.0) : col;
}
// The Smiler: glowing eyes and a long crooked grin of sharp teeth, and nothing else you can see.
float smiler(vec2 s) {
  float e = 0.0;
  for (int i = -1; i <= 1; i += 2) {
    float sg = float(i);
    vec2 q = mat2(cos(0.3 * sg), sin(0.3 * sg), -sin(0.3 * sg), cos(0.3 * sg)) * (s - vec2(sg * 0.1, 0.08));
    float r = length(q / vec2(0.05, 0.026));
    e = max(e, smoothstep(1.0, 0.55, r) * 1.4 + 0.35 * exp(-r * r * 0.3));
  }
  float x = s.x, my = -0.08 - 0.07 * (1.0 - x * x / 0.0576) + 0.012 * sin(x * 31.0);
  float dy = (s.y - my) / 0.028;
  float inM = step(abs(x), 0.24) * step(abs(dy), 1.0);
  float teeth = inM * max(step(abs(fract(x * 34.0) - 0.5) * 2.0, dy), step(abs(fract(x * 34.0 + 0.5) - 0.5) * 2.0, -dy));
  return e + teeth + 0.12 * exp(-dy * dy * 0.5) * step(abs(x), 0.26);
}

// ---------------------------------------------------------------- camcorder OSD (burned into the tape)

float osdGlyph(vec2 uv, vec2 at, float h, int c) {
  vec2 g = (uv - at) / h * 6.0;
  if (c < 0 || g.x < 0.0 || g.x >= 5.0 || g.y < 0.0 || g.y >= 6.0) return 0.0;
  ivec2 k = ivec2(floor(vec2(g.x, 6.0 - g.y)));
  return float((FONT[c] >> uint(k.y * 5 + k.x)) & 1u);
}
int digit(float v, float place) { return 22 + int(mod(floor(v / place), 10.0)); }
vec4 osd(vec2 uv, float t) {
  float asp = slot(34) > 0.1 ? slot(34) : 1.7778;
  float h = 0.03, adv = h * 1.1, top = 0.5206 - 0.12;
  float xl = -0.5206 * asp + 0.07, xr = 0.5206 * asp - 0.07;
  float ink = 0.0, red = 0.0;
  // REC dot and timecode.
  red = step(0.45, fract(t)) * smoothstep(0.014, 0.011, length(uv - vec2(xl + 0.012, top + h * 0.5)));
  int rec[3] = int[3](15, 4, 2);
  for (int i = 0; i < 3; i++) ink += osdGlyph(uv, vec2(xl + 0.035 + float(i) * adv, top), h, rec[i]);
  float tc = slot(26), tm = floor(mod(tc, 3600.0) / 60.0), tsec = floor(mod(tc, 60.0));
  int tcs[7] = int[7](digit(tc, 3600.0), 32, digit(tm, 10.0), digit(tm, 1.0), 32, digit(tsec, 10.0), digit(tsec, 1.0));
  for (int i = 0; i < 7; i++) ink += osdGlyph(uv, vec2(xl + float(i) * adv, top - h * 1.6), h, tcs[i]);
  // Battery: outline, tip, bars; blinks when nearly flat.
  float bat = slot(35);
  vec2 bp = uv - vec2(xr - 0.045, top + h * 0.5);
  float frame = step(abs(sdB(bp, vec2(0.04, 0.016))), 0.0025) + step(sdB(bp - vec2(0.046, 0.0), vec2(0.005, 0.007)), 0.0);
  float bars = 0.0;
  for (int i = 0; i < 3; i++) bars += step(float(i) / 3.0 + 0.02, bat) * step(sdB(bp - vec2(-0.026 + float(i) * 0.026, 0.0), vec2(0.009, 0.01)), 0.0);
  ink += (frame + bars) * (bat < 0.2 ? step(0.5, fract(t * 1.2)) : 1.0);
  // Date and time, right-aligned under the battery.
  int mo = clamp(int(slot(31)) - 1, 0, 11);
  float day = slot(32), yr = slot(30), sec = slot(33);
  int dl[11] = int[11](MON[mo * 3], MON[mo * 3 + 1], MON[mo * 3 + 2], 33, digit(day, 10.0), digit(day, 1.0), -1, digit(yr, 1000.0), digit(yr, 100.0), digit(yr, 10.0), digit(yr, 1.0));
  for (int i = 0; i < 11; i++) ink += osdGlyph(uv, vec2(xr - 11.0 * adv + float(i) * adv, top - h * 1.6), h, dl[i]);
  float hr = floor(sec / 3600.0), mi = floor(mod(sec, 3600.0) / 60.0), se = mod(sec, 60.0);
  float h12 = mod(hr + 11.0, 12.0) + 1.0;
  int tl[10] = int[10](h12 < 10.0 ? -1 : digit(h12, 10.0), digit(h12, 1.0), 32, digit(mi, 10.0), digit(mi, 1.0), 32, digit(se, 10.0), digit(se, 1.0), hr < 12.0 ? 0 : 14, 11);
  for (int i = 0; i < 10; i++) ink += osdGlyph(uv, vec2(xr - 10.0 * adv + float(i) * adv, top - h * 3.1), h, tl[i]);
  return vec4(clamp(ink, 0.0, 1.0), clamp(red, 0.0, 1.0), 0.0, 0.0);
}

// ---------------------------------------------------------------- camera, lens, tape

void main() {
  float t = uTime;
  bool dirOn = slot(0) > 0.5;
  if (dirOn) {
    gCam = vec3(slot(1), slot(2), slot(3));
    gYaw = slot(4); gPitch = slot(5); gRoll = slot(6);
    gCr = vec2(slot(8), slot(9));
    gCS = sin(slot(10)); gCC = cos(slot(10));
    gVis = slot(12); gCT = slot(19);
    gHush = slot(20); gGlitch = slot(21); gCut = slot(22); gExpo = slot(23);
    gWin = ivec2(int(slot(24)), int(slot(25)));
    gType = int(slot(29) + 0.5);
    gDragVis = slot(36);
    gDrag = vec2(slot(37), slot(38));
    gDragS = sin(slot(39)); gDragC = cos(slot(39));
    gOsd = slot(40); gVhs = slot(41); gWriting = slot(42); gObjects = slot(43); gDark = slot(44); gShadows = slot(45);
  } else {
    gCam = vec3(0.0, 1.5 + 0.015 * abs(sin(t * 5.4)), -mod(t * 1.25, 400.0));
    gYaw = 0.03 * sin(t * 0.31); gPitch = -0.03; gRoll = 0.012 * sin(t * 0.7);
    gVis = 0.0; gHush = 0.0; gGlitch = 0.05; gCut = 0.0; gExpo = 1.0;
    gWin = ivec2(-99999);
    gType = 0;
    gDragVis = 0.0;
    gOsd = 0.0; gVhs = 1.0; gWriting = 1.0; gObjects = 1.0; gDark = 1.0; gShadows = 1.0;
  }
  gSelf = false;
  gTh = 1.0;
  gBC = vec3(0.0, 1.2, 0.35); gBR = 1.8;
  gBreath = 1.0; gMouth = 0.0;
  // The operator: an unseen body just behind the camera, only there to cast a shadow.
  vec2 fw = vec2(sin(gYaw), -cos(gYaw));
  gBodyA = vec3(gCam.x - fw.x * 0.2, 0.15, gCam.z - fw.y * 0.2);
  gBodyB = vec3(gBodyA.x, gCam.y - 0.2, gBodyA.z);
  if (bodied()) rig();

  vec3 vd = normalize(vDir);
  vec2 uv0 = vd.xy / -vd.z, uv = uv0;
  float yb = uv.y / 1.0412 + 0.5;
  float line = floor(yb * 486.0);
  float fr = floor(t * 29.97);
  float wear = gVhs;
  // Time-base wobble per scan line, tracking bursts near the creature, head-switch tear at the bottom.
  float jit = (h1(line * 1.37 + fr * 91.0) - 0.5) * 0.0016 * wear;
  float tb = step(0.9, h1(floor(t * 4.0) + 11.0)) * smoothstep(0.2, 0.6, gGlitch) * smoothstep(0.12, 0.0, abs(yb - h1(floor(t * 4.0) + 5.0)));
  jit += tb * (h1(line * 0.21 + fr) - 0.5) * 0.014 * min(wear, 1.5);
  float hs = smoothstep(0.035, 0.0, yb) * min(wear, 1.0);
  uv.x += jit + hs * (0.05 + 0.04 * h1(line + fr * 3.0));
  vec2 uvT = uv;
  uv += (vec2(hf(ivec2(gl_FragCoord.xy), int(fr) & 1023), hf(ivec2(gl_FragCoord.yx), int(fr) & 1023)) - 0.5) * 0.0011 * min(wear, 1.5);
  uv *= 1.0 + 0.07 * dot(uv, uv);
  vec3 rd = rotY(gYaw) * rotX(gPitch) * rotZ(gRoll) * normalize(vec3(uv, -1.0));

  float hit = 0.03;
  vec3 p = gCam;
  bool got = false;
  for (int i = 0; i < 140; i++) {
    p = gCam + rd * hit;
    float d = map(p);
    if (d < 0.0012 * hit + 0.0004) { got = true; break; }
    hit += d;
    if (hit > 70.0) break;
  }

  vec3 col = vec3(0.10, 0.09, 0.04);
  if (got) {
    vec2 k = vec2(1.0, -1.0) * (0.0015 + hit * 0.0004);
    vec3 n = normalize(k.xyy * map(p + k.xyy) + k.yyx * map(p + k.yyx) + k.yxy * map(p + k.yxy) + k.xxx * map(p + k.xxx));
    int ok;
    vec3 oq;
    float dob = objects(p, ok, oq), drm = room(p);
    int bpart = 0;
    float dbo = gDragVis > 0.5 ? operatorBody(p, bpart) : 1e3;
    if (bodied() && creature(p) < min(min(drm, dob), dbo) + 0.001) col = creatureShade(p, n, rd);
    else if (dbo < min(drm, dob)) col = bodyShade(p, n, rd, bpart, hit);
    else if (dob < drm) col = objectShade(p, n, rd, ok, oq);
    else col = surface(p, n, rd, hit);
  }
  col *= exp(-hit * 0.017);
  col = mix(col, vec3(0.3, 0.27, 0.12), (1.0 - exp(-hit * 0.028)) * 0.45);

  if (gVis > 0.5 && gType == 4) {
    vec3 H = vec3(gCr.x, 1.62 + 0.03 * sin(gCT * 1.7), gCr.y);
    vec3 nrm = normalize(vec3(gCam.x - H.x, 0.0, gCam.z - H.z));
    float den = dot(rd, nrm);
    if (den < -0.01) {
      float ts = dot(H - gCam, nrm) / den;
      if (ts > 0.0 && ts < hit + 0.05) {
        vec3 hp = gCam + rd * ts - H;
        col += vec3(1.0, 0.97, 0.9) * smiler(vec2(dot(hp, vec3(nrm.z, 0.0, -nrm.x)), hp.y) / 1.6) * 2.6 * exp(-ts * 0.03);
      }
    }
  }

  // Lens glare from the troffers the camera can see.
  ivec2 cn = ivec2(floor(gCam.xz / G + 0.5));
  float gl = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) for (int a = 0; a < 2; a++) {
    ivec2 q = cn + ivec2(i, j);
    vec2 lc = lampC(q, a);
    vec3 L = vec3(lc.x, CH - 0.02, lc.y) - gCam;
    float dl = length(L), cs = dot(rd, L / dl);
    if (cs < 0.9 || dl > hit + 0.35) continue;
    gl += lampOn(q, a) * (exp(-(1.0 - cs) * 2500.0) * 0.6 + exp(-(1.0 - cs) * 180.0) * 0.12) / (1.0 + dl * 0.15);
  }
  col += vec3(1.0, 0.96, 0.82) * gl;

  // Auto-exposure, filmic shoulder, camcorder grade (olive cast, lifted blacks).
  col *= gExpo * 1.5 * clamp(uBright / 1.25, 0.6, 1.5);
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, 1.12) * vec3(1.0, 0.99, 0.86) * 0.93 + vec3(0.035, 0.035, 0.012);

  // OSD rides the same wobbling lines as the picture.
  if (dirOn && gOsd > 0.5 && uvT.y > 0.2) {
    vec4 o = osd(uvT, t);
    col = mix(col, vec3(0.02), max(osd(uvT + vec2(0.0025, -0.0025), t).x - o.x, 0.0) * 0.6);
    col = mix(col, vec3(0.96, 0.96, 0.92), o.x * 0.9);
    col = mix(col, vec3(0.95, 0.12, 0.08), o.y);
  }

  // VHS: grain, chroma noise per line, interlace, dropouts, tracking band, head-switch, vignette, tape cut.
  float g = hf(ivec2(gl_FragCoord.xy) + ivec2(int(fr) * 17, 0), 90) - 0.5;
  col += g * (0.045 + 0.035 * (1.0 - lum)) * wear;
  float cnz = hf(ivec2(int(uv0.x * 40.0), int(line)), 91 + (int(fr) & 255)) - 0.5;
  col += vec3(cnz, -0.3 * cnz, -cnz) * 0.03 * wear;
  col *= 1.0 - 0.02 * mod(line + fr, 2.0) * min(wear, 1.0);
  if (h1(line * 3.1 + fr * 7.0) > 1.0 - 0.0007 * wear) col += 0.3 * smoothstep(0.12, 0.0, abs(uv0.x - (h1(line + fr) - 0.5) * 1.6));
  float inb = smoothstep(0.03, 0.0, abs(yb - fract(t * 0.11))) * smoothstep(0.15, 0.6, gGlitch) * min(wear, 1.5);
  col = mix(col, col * 0.7 + vec3(0.5 + g) * 0.3, clamp(inb, 0.0, 1.0));
  col = mix(col, col * 0.55 + vec3(0.25 + g * 0.5), hs);
  col *= 1.0 - 0.3 * pow(clamp(dot(uv0, uv0) * 0.9, 0.0, 1.0), 1.5);
  col = mix(col, vec3(0.06 + 0.32 * (g + 0.5)), gCut);
  fragColor = vec4(max(col, 0.0), 1.0);
}
