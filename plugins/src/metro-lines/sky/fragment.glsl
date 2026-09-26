// Metro Lines — schematic map drawn from packed zotoVizSlots (see frontend/metro.ts).

uniform float uTime;
uniform float uOpacity;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
in vec3 vDir;
out vec4 fragColor;

const vec3 ZOTO_FAIL = vec3(0.93, 0.12, 0.35);

float slotF(int slot, int fi) {
  int base = slot * 16 + fi;
  int q = base >> 2;
  int r = base & 3;
  vec4 v = zotoVizSlots[q];
  if (r == 0) return v.x;
  if (r == 1) return v.y;
  if (r == 2) return v.z;
  return v.w;
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
}

vec2 mapUv(vec2 uv) {
  float aspect = max(0.5, slotF(0, 1));
  vec2 p = uv;
  p.x *= aspect;
  return p;
}

vec3 palette(float hue, float pal) {
  float h = fract(hue + pal * 0.07);
  vec3 a = vec3(0.15, 0.55, 0.92);
  vec3 b = vec3(0.92, 0.42, 0.12);
  vec3 c = vec3(0.22, 0.78, 0.38);
  vec3 d = vec3(0.72, 0.22, 0.82);
  if (pal > 2.5) return mix(d, a, h);
  if (pal > 1.5) return mix(vec3(0.45), mix(a, b, h), 0.65);
  if (pal > 0.5) return mix(b, c, h);
  return mix(a, c, h);
}

float seg2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float octiSeg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 mid = vec2(b.x, a.y);
  float d1 = seg2(p, a, mid);
  float d2 = seg2(p, mid, b);
  float d = min(d1, d2);
  return smoothstep(w, w * 0.35, d);
}

float stationDisk(vec2 p, vec2 c, float r) {
  return 1.0 - smoothstep(r * 0.85, r, length(p - c));
}

float glyph5(int code, vec2 uv) {
  if (code < 32 || code > 126) return 0.0;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  vec2 g = floor(uv * vec2(5.0, 7.0));
  float bit = hash11(float(code * 17 + int(g.x) * 3 + int(g.y) * 11));
  return step(0.42, bit);
}

float drawLabel(vec2 p, vec2 anchor, int idx, float density) {
  float major = slotF(3, idx * 4 + 3);
  if (major < 0.2) return 0.0;
  float fade = smoothstep(0.25, 0.85, density);
  if (major < 0.6) fade *= 0.55;
  vec2 o = anchor + vec2(0.028, 0.022);
  float ink = 0.0;
  for (int i = 0; i < 3; i++) {
    float ch = slotF(3, idx * 4 + i);
    int code = int(ch * 95.0 + 0.5) + 32;
    vec2 cell = p - o - vec2(float(i) * 0.022, 0.0);
    ink = max(ink, glyph5(code, cell / vec2(0.02, 0.028)));
  }
  return ink * fade;
}

void main() {
  vec2 uv = normalize(vDir).xy / max(0.2, abs(normalize(vDir).z));
  uv = mapUv(uv);
  vec2 p = uv;

  float night = slotF(0, 2);
  float tilt = slotF(0, 3);
  float labelDensity = slotF(0, 4);
  float lineW = slotF(0, 5) * 0.012;
  float demo = slotF(0, 8);
  float disruptions = slotF(0, 9);
  int nSta = int(slotF(0, 11));
  int nEdge = int(slotF(0, 12));
  float reduced = slotF(0, 13);
  float pal = slotF(0, 14);
  float tickPhase = slotF(0, 15);

  float pitch = tilt * 0.35;
  mat2 rot = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch));
  p = rot * p;

  vec3 paper = mix(uBg, vec3(0.04, 0.06, 0.11), night);
  vec3 col = paper;

  float grid = 0.03 * (1.0 - night) * exp(-length(p) * 1.2);
  col += vec3(grid);

  float mapInk = 0.0;
  vec3 lineCol = vec3(0.0);

  for (int e = 0; e < 16; e++) {
    if (e >= nEdge) break;
    int a = int(slotF(2, e * 4) * 16.0 + 0.5);
    int b = int(slotF(2, e * 4 + 1) * 16.0 + 0.5);
    float hue = slotF(2, e * 4 + 2);
    float weight = slotF(2, e * 4 + 3);
    float disrupted = weight > 0.45 ? 1.0 : 0.0;
    weight = min(weight, 0.44);
    vec2 pa = vec2(slotF(1, a * 4), slotF(1, a * 4 + 1));
    vec2 pb = vec2(slotF(1, b * 4), slotF(1, b * 4 + 1));
    float w = lineW * (0.7 + weight * 0.9);
    float ink = octiSeg(p, pa, pb, w);
    vec3 c = palette(hue, pal);
    if (disrupted > 0.5) {
      float flash = 0.55 + 0.45 * sin(uTime * 4.0 + float(e));
      c = mix(c, ZOTO_FAIL, flash * 0.75);
    }
    lineCol += c * ink;
    mapInk = max(mapInk, ink);
  }

  col = mix(col, lineCol, clamp(mapInk, 0.0, 1.0));

  float trains = 0.0;
  for (int t = 0; t < 16; t++) {
    float edgeF = slotF(6, t * 4);
    int ei = int(edgeF);
    if (ei >= nEdge) continue;
    float u = slotF(6, t * 4 + 1);
    float len = slotF(6, t * 4 + 2);
    int a = int(slotF(2, ei * 4) * 16.0 + 0.5);
    int b = int(slotF(2, ei * 4 + 1) * 16.0 + 0.5);
    vec2 pa = vec2(slotF(1, a * 4), slotF(1, a * 4 + 1));
    vec2 pb = vec2(slotF(1, b * 4), slotF(1, b * 4 + 1));
    vec2 mid = vec2(pb.x, pa.y);
    float half = len * 0.5;
    float u0 = clamp(u - half, 0.0, 1.0);
    float u1 = clamp(u + half, 0.0, 1.0);
    vec2 ta = mix(pa, mid, u0);
    vec2 tb = mix(pa, mid, u1);
    float d = min(seg2(p, ta, tb), seg2(p, mix(mid, pb, u0), mix(mid, pb, u1)));
    trains = max(trains, smoothstep(0.01, 0.004, d));
  }
  col += vec3(1.0, 0.98, 0.92) * trains * (0.65 + uAudio * 0.35);

  for (int s = 0; s < 16; s++) {
    if (s >= nSta) break;
    vec2 c = vec2(slotF(1, s * 4), slotF(1, s * 4 + 1));
    float stress = slotF(1, s * 4 + 3);
    float r = 0.018 + 0.006 * slotF(1, s * 4 + 2);
    float ring = stationDisk(p, c, r * 1.55) * 0.35;
    float core = stationDisk(p, c, r);
    vec3 sc = mix(vec3(0.12), ZOTO_FAIL, smoothstep(0.35, 0.85, stress) * (0.6 + 0.4 * sin(uTime * 5.0 + float(s))));
    col = mix(col, sc, core);
    col += vec3(1.0) * ring * (1.0 - night * 0.5);
    col += drawLabel(p, c, s, labelDensity) * mix(vec3(0.08), vec3(0.92), night);
  }

  float tickerOn = slotF(0, 7);
  if (tickerOn > 0.5) {
    vec2 board = vec2(0.0, -0.48);
    float bh = 0.07;
    float inside = step(board.y, p.y) * step(p.y, board.y + bh) * step(abs(p.x), 0.92);
    col = mix(col, mix(vec3(0.08, 0.1, 0.14), vec3(0.12, 0.14, 0.2), night), inside * 0.92);
    float scroll = reduced > 0.5 ? 0.0 : tickPhase;
    for (int i = 0; i < 40; i++) {
      float ch = slotF(5, i);
      if (ch < 0.001) break;
      int code = int(ch * 95.0 + 0.5) + 32;
      float cellX = mod(float(i) - scroll * 12.0, 42.0) - 18.0;
      vec2 cell = p - board - vec2(cellX * 0.022, bh * 0.25);
      float flap = reduced > 0.5 ? 0.0 : sin(uTime * 3.0 + float(i) * 0.4) * 0.15;
      cell.y += flap;
      float g = glyph5(code, cell / vec2(0.018, 0.028));
      vec3 tc = disruptions > 0.5 ? mix(vec3(1.0, 0.85, 0.3), ZOTO_FAIL, 0.35) : vec3(0.85, 0.95, 1.0);
      col += tc * g * inside;
    }
  }

  vec2 badge = vec2(-0.78, 0.42);
  float badgeInk = stationDisk(p, badge, 0.04) * step(0.5, disruptions);
  col = mix(col, ZOTO_FAIL, badgeInk * 0.85);
  float demoInk = stationDisk(p, vec2(0.72, 0.44), 0.035) * demo;
  col = mix(col, vec3(0.2, 0.55, 0.95), demoInk * 0.7);

  vec2 legO = vec2(0.62, 0.38);
  for (int l = 0; l < 6; l++) {
    float hue = slotF(4, l * 8);
    if (hue < 0.001) continue;
    vec2 lp = p - legO - vec2(0.0, float(l) * 0.045);
    float sw = smoothstep(0.012, 0.006, abs(lp.x) - 0.04);
    col = mix(col, palette(hue, pal), sw * 0.85);
  }

  vec2 hud = vec2(-0.82, 0.46);
  float hudBg = smoothstep(0.08, 0.04, length(p - hud - vec2(0.12, 0.0)));
  col = mix(col, vec3(0.0, 0.0, 0.0), hudBg * 0.35 * (1.0 - night));
  col *= max(uBright, 0.85);
  col = min(col, vec3(1.15));
  fragColor = vec4(col, uOpacity);
}
