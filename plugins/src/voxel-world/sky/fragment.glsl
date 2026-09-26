// Voxel World — procedural block terrain. Host director (`frontend/world.ts`) fills slot 0 (camera, sun, options) and slot 1 (mobs).

#define PI 3.14159265
const int MAX_STEPS = 96;
const float SEA = 5.0;

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

uint hu(ivec3 p) {
  uint h = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u ^ uint(p.z) * 2798796415u;
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
float hf(ivec3 p) { return float(hu(p) >> 8) / 16777216.0; }

float vn(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hf(ivec3(i, 0));
  float b = hf(ivec3(i + ivec2(1, 0), 0));
  float c = hf(ivec3(i + ivec2(0, 1), 0));
  float d = hf(ivec3(i + ivec2(1, 1), 0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vn(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

float terrainH(vec2 xz) {
  float seed = slot(8);
  float biome = slot(9);
  float s = seed * 0.001;
  vec2 q = xz * 0.07 + vec2(s, s * 2.0);
  float n = fbm(q) * 2.0 - 1.0;
  float h = 6.0 + n * 10.0;
  h += biome * 4.0;
  if (biome > 0.65) h = 5.0 + n * 5.0;
  if (biome > 0.35 && biome < 0.55) {
    float island = exp(-0.0025 * dot(xz, xz));
    h = 2.0 + island * 14.0;
  }
  return h;
}

float biomeSnow() { return slot(9) > 0.5 ? 2.0 : 8.0; }

int blockAt(ivec3 c, float seed) {
  float h = terrainH(vec2(c.x, c.z));
  if (float(c.y) > h + 0.5) {
    if (float(c.y) <= SEA && c.y > int(SEA) - 3) return 5;
    return 0;
  }
  if (float(c.y) > h) return 0;
  float cave = vn(vec2(c.x, c.z) * 0.11 + seed) * vn(vec2(c.y, c.x) * 0.17);
  if (cave > 0.82 && float(c.y) < h - 2.0) return 0;
  int surface = int(floor(h));
  if (c.y == surface) {
    if (h < SEA + 0.5) return 4;
    if (h > 14.0 + biomeSnow()) return 6;
    return 1;
  }
  if (c.y > surface - 3) return 2;
  if (hf(ivec3(c + ivec3(int(seed), 0, 0))) > 0.96) return 9;
  return 3;
}

bool treeAt(ivec2 xz, float seed) {
  float h = terrainH(vec2(xz));
  if (h < SEA + 1.0 || h > 18.0) return false;
  float r = hf(ivec3(xz.x, xz.y, int(seed) + 17));
  return r > 0.93;
}

int villageBlock(ivec3 p) {
  vec2 village = vec2(slot(28), slot(29));
  ivec3 base = ivec3(int(floor(village.x)), int(floor(terrainH(village))), int(floor(village.y)));
  ivec3 q = p - base;
  if (q.x >= 0 && q.x < 7 && q.z >= -3 && q.z < 4 && q.y >= 0 && q.y < 5) {
    if (q.y == 0) return 4;
    if (q.y < 4 && (q.x == 0 || q.x == 6 || q.z == -3 || q.z == 3)) return 3;
    if (q.y == 4 && q.x > 1 && q.x < 5 && q.z > -2 && q.z < 2) return 7;
    if (q.y > 0 && q.y < 4) return 0;
  }
  return 0;
}

int voxel(ivec3 p) {
  int v = villageBlock(p);
  if (v != 0) return v;
  float seed = slot(8);
  int b = blockAt(p, seed);
  if (b != 0) return b;
  if (treeAt(p.xz, seed)) {
    int h = int(floor(terrainH(vec2(p.x, p.z))));
    if (p.y > h && p.y <= h + 4) return 7;
    if (p.y > h + 4 && p.y <= h + 7) return 8;
  }
  if (p.y == int(floor(terrainH(vec2(p.x, p.z)))) + 1) {
    float fl = hf(ivec3(p.x, 0, p.z + int(seed)));
    if (fl > 0.97) return 10;
  }
  return 0;
}

vec3 blockCol(int id, vec3 n, vec3 wp) {
  float tex = slot(22);
  vec2 uv = wp.xz;
  if (abs(n.y) < 0.5) uv = wp.xy;
  if (abs(n.z) > 0.5) uv = wp.xy;
  vec2 cell = fract(uv * 4.0);
  float pix = tex < 0.5 ? step(0.5, fract(cell.x * 16.0)) * step(0.5, fract(cell.y * 16.0)) : 1.0;
  float shade = 0.85 + 0.15 * pix;
  if (id == 1) return vec3(0.28, 0.62, 0.22) * shade;
  if (id == 2) return vec3(0.42, 0.28, 0.16) * shade;
  if (id == 3) return vec3(0.48, 0.48, 0.5) * shade;
  if (id == 4) return vec3(0.76, 0.7, 0.42) * shade;
  if (id == 5) return vec3(0.12, 0.35, 0.62);
  if (id == 6) return vec3(0.92, 0.94, 0.98) * shade;
  if (id == 7) return vec3(0.35, 0.22, 0.1) * shade;
  if (id == 8) return vec3(0.18, 0.55, 0.2) * shade;
  if (id == 9) return vec3(0.92, 0.14, 0.18);
  if (id == 10) return vec3(0.9, 0.25, 0.55);
  return vec3(0.5);
}

float aoAt(ivec3 p, vec3 n) {
  ivec3 o = ivec3(sign(n));
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    ivec3 q = p - ivec3((i == 0) ? o.x : 0, (i == 1) ? o.y : 0, (i == 2) ? o.z : 0);
    if (voxel(q) != 0) a += 0.22;
  }
  return clamp(1.0 - a, 0.55, 1.0);
}

vec3 skyCol(vec3 rd, float day, vec3 sun) {
  float pal = slot(21);
  vec3 zen = mix(vec3(0.05, 0.12, 0.32), vec3(0.45, 0.62, 0.92), day);
  vec3 hor = mix(vec3(0.15, 0.1, 0.22), vec3(0.95, 0.72, 0.45), day);
  if (pal > 2.5) { zen = mix(zen, vec3(0.55, 0.35, 0.75), 0.35); hor = mix(hor, vec3(0.95, 0.55, 0.75), 0.4); }
  else if (pal > 1.5) { zen = mix(zen, vec3(0.35, 0.55, 0.75), 0.3); }
  else if (pal > 0.5) { hor = mix(hor, vec3(1.0, 0.45, 0.25), 0.35); }
  float y = rd.y * 0.5 + 0.5;
  vec3 col = mix(hor, zen, pow(y, 0.65));
  float sunDot = max(dot(rd, normalize(sun)), 0.0);
  col += vec3(1.0, 0.92, 0.7) * pow(sunDot, 128.0) * slot(19);
  if (day < 0.25 || day > 0.75) {
    float stars = step(0.995, hf(ivec3(int(rd.x * 400.0), int(rd.y * 400.0), int(rd.z * 400.0))));
    col += vec3(0.8, 0.85, 1.0) * stars * (1.0 - y);
  }
  return col;
}

float cloudLayer(vec3 ro, vec3 rd) {
  if (mod(floor(slot(15)), 2.0) < 1.0) return 0.0;
  float cover = slot(27);
  float t = 40.0 / max(rd.y, 0.05);
  vec3 p = ro + rd * t;
  float c = step(0.55 - cover * 0.2, vn(p.xz * 0.04 + uTime * 0.02));
  return c * (0.2 + cover * 0.45) * smoothstep(0.0, 0.4, rd.y);
}

bool traceVoxel(vec3 ro, vec3 rd, out float dist, out vec3 n, out vec3 wp, out int id) {
  float maxD = min(slot(10), 48.0);
  vec3 pos = ro;
  vec3 stepDir = sign(rd);
  vec3 tDelta = abs(1.0 / max(abs(rd), vec3(0.0001)));
  vec3 side = fract(pos) * -stepDir + stepDir * 0.5 + 0.5;
  vec3 tMax = tDelta * side;
  ivec3 ip = ivec3(floor(pos));
  dist = 0.0;
  int stepAxis = 0;
  for (int i = 0; i < MAX_STEPS; i++) {
    id = voxel(ip);
    if (id != 0) {
      wp = vec3(ip);
      if (stepAxis == 0) n = vec3(-stepDir.x, 0.0, 0.0);
      else if (stepAxis == 1) n = vec3(0.0, -stepDir.y, 0.0);
      else n = vec3(0.0, 0.0, -stepDir.z);
      return true;
    }
    if (tMax.x < tMax.y && tMax.x < tMax.z) {
      dist = tMax.x;
      tMax.x += tDelta.x;
      ip.x += int(stepDir.x);
      stepAxis = 0;
    } else if (tMax.y < tMax.z) {
      dist = tMax.y;
      tMax.y += tDelta.y;
      ip.y += int(stepDir.y);
      stepAxis = 1;
    } else {
      dist = tMax.z;
      tMax.z += tDelta.z;
      ip.z += int(stepDir.z);
      stepAxis = 2;
    }
    if (dist > maxD) break;
  }
  id = 0;
  return false;
}

vec3 beaconCol(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    int base = 64 + i * 4;
    float kindF = slot(base + 3);
    if (kindF < 0.5) continue;
    int kind = int(floor(kindF));
    float strength = fract(kindF) * 10.0;
    vec3 bp = vec3(slot(base), slot(base + 1), slot(base + 2));
    vec3 h = bp - ro;
    float t = dot(h, rd);
    if (t < 0.0) continue;
    vec3 q = h - rd * t;
    float d = length(q);
    float sz = kind == 9 ? 1.2 + strength : 0.65;
    if (d > sz) continue;
    float core = 1.0 - d / sz;
    if (kind == 1) col += vec3(1.0, 0.72, 0.25) * core * 0.9;
    else col += vec3(0.55, 0.55, 0.58) * core * 0.7;
  }
  return col;
}

vec3 mobCol(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    int base = 64 + i * 4;
    vec3 mp = vec3(slot(base), slot(base + 1), slot(base + 2));
    float sz = slot(base + 3);
    if (sz < 0.1 || sz >= 0.95) continue;
    vec3 h = mp - ro;
    float t = dot(h, rd);
    if (t < 0.0) continue;
    vec3 q = h - rd * t;
    float d = length(q);
    if (d < sz) col += vec3(0.85, 0.55, 0.35) * (1.0 - d / sz);
  }
  return col;
}

void main() {
  if (slot(0) < 0.5) {
    vec3 rd = normalize(vDir);
    fragColor = vec4(skyCol(rd, 0.55, vec3(0.4, 0.8, 0.2)) * uBright, uOpacity);
    return;
  }
  vec3 ro = vec3(slot(1), slot(2), slot(3));
  float yaw = slot(4);
  float pitch = slot(5);
  vec3 fwd = normalize(vec3(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw)));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec2 uv = vec2(atan(vDir.x, vDir.z), vDir.y);
  vec3 rd = normalize(fwd + right * uv.x * 0.85 + up * uv.y * 0.65);
  float day = slot(7);
  vec3 sun = vec3(slot(16), slot(17), slot(18));
  vec3 col = skyCol(rd, day, sun);
  col += cloudLayer(ro, rd);
  float dist;
  vec3 n;
  vec3 wp;
  int id;
  if (traceVoxel(ro, rd, dist, n, wp, id)) {
    float ao = aoAt(ivec3(wp), n);
    vec3 al = blockCol(id, n, wp);
    vec3 l = normalize(sun);
    float diff = max(dot(n, l), 0.0) * slot(19);
    vec3 amb = vec3(0.18, 0.22, 0.28) * (0.35 + day * 0.65);
    col = al * (amb + diff) * ao;
    if (id == 5) {
      float wave = sin(wp.x * 0.8 + uTime * 1.5) * 0.5 + 0.5;
      col = mix(col, vec3(0.1, 0.4, 0.55), 0.35 + wave * 0.2);
    }
    float fog = slot(11);
    col = mix(col, skyCol(rd, day, sun), 1.0 - exp(-dist * 0.035 * (0.5 + fog)));
    col += vec3(1.0, 0.75, 0.35) * slot(20) * exp(-dist * 0.08) * 0.35;
  }
  col += mobCol(ro, rd);
  float fail = slot(23);
  float wMix = slot(24);
  float w = slot(12);
  if (w > 0.5 || wMix > 0.2) {
    float precip = hf(ivec3(int(ro.x + uTime * 10.0), int(ro.y * 3.0), int(ro.z * 2.0)));
    col += vec3(0.7, 0.75, 0.85) * step(0.92, precip) * (0.08 + wMix * 0.2);
  }
  col = mix(col, vec3(0.92, 0.14, 0.18), fail * 0.45);
  vec3 beacons = beaconCol(ro, rd);
  col = max(col, beacons);
  col = mix(col, uAccent * 0.15, uAudio * 0.15 * (1.0 - fail));
  col *= uBright;
  float osdY = vDir.y + 0.93;
  if (osdY > 0.0) {
    vec3 bar = vec3(0.04, 0.07, 0.11);
    col = mix(col, bar, smoothstep(0.0, 0.04, osdY));
    float demo = slot(25);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0);
    col += vec3(0.2, 0.85, 0.45) * demo * pulse * smoothstep(0.0, 0.03, osdY);
    col += vec3(0.85, 0.55, 0.2) * smoothstep(0.0, 0.03, osdY) * (slot(26) / 100.0);
  }
  col = max(col, vec3(0.06, 0.08, 0.12));
  fragColor = vec4(col, uOpacity);
}
