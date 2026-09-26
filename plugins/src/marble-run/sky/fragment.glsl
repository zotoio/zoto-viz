// Marble Run — wood, glass tubes, brass fittings. Slot 0 scene + slot 1 marble instances.

#define PI 3.14159265

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

float marbleHue(int i) { return slot(64 + i * 4 + 3); }
vec3 marblePos(int i) {
  return vec3(slot(64 + i * 4), slot(64 + i * 4 + 1), slot(64 + i * 4 + 2));
}

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
float sdCyl(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float trackU(vec3 p) {
  return clamp((p.x + 1.8) / 3.6, 0.0, 1.0);
}

vec3 trackPoint(float u) {
  float seed = slot(1);
  float comp = slot(24);
  float wob = sin(u * (6.0 + comp * 2.0) + seed * 40.0) * 0.35;
  float y = 1.15 + sin(u * 6.283 + seed * 3.0) * 0.35 + wob * 0.2;
  float x = -1.8 + u * 3.6;
  float z = cos(u * 9.42 + seed * 5.0) * 0.45;
  int kind = int(mod(floor(u * (6.0 + comp * 3.0)), 7.0));
  if (kind == 1) y += sin(u * 40.0) * 0.08; // spiral
  if (kind == 3) y += sin(u * 20.0) * 0.12; // seesaw
  if (kind == 6) z += sin(u * 30.0) * 0.15; // loop
  return vec3(x, y, z);
}

float trackTube(vec3 p) {
  float u = trackU(p);
  vec3 c = trackPoint(u);
  vec3 c2 = trackPoint(min(1.0, u + 0.02));
  vec3 tang = normalize(c2 - c);
  vec3 q = p - c;
  float along = dot(q, tang);
  vec3 perp = q - tang * along;
  float r = 0.14 + 0.02 * sin(u * 12.0 + slot(1) * 10.0);
  return length(perp) - r;
}

float glassShell(vec3 p) {
  float d = trackTube(p);
  return abs(d + 0.018) - 0.012;
}

float woodFrame(vec3 p) {
  float d = 1e4;
  float comp = slot(24);
  for (int i = 0; i < 8; i++) {
    if (float(i) > 5.0 + comp) break;
    float u = float(i) / (5.0 + comp);
    vec3 c = trackPoint(u);
    d = min(d, sdBox(p - c - vec3(0.0, -0.35, 0.0), vec3(0.22, 0.06, 0.22)));
    d = min(d, sdCyl(p - c - vec3(0.35, 0.0, 0.0), 0.05, 0.04));
  }
  return d;
}

float jars(vec3 p) {
  float d = 1e4;
  int n = int(slot(3));
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    float fi = float(i);
    vec3 pos = vec3(-1.2 + fi * (2.4 / max(1.0, float(n - 1))), 0.35, 1.35);
    float h = 0.35 + slot(4 + i) * 0.45;
    d = min(d, sdCyl(p - pos - vec3(0.0, h * 0.5, 0.0), h * 0.5, 0.12));
    d = min(d, sdBox(p - pos - vec3(0.0, h + 0.05, 0.0), vec3(0.14, 0.02, 0.14)));
  }
  return d;
}

float rejectTray(vec3 p) {
  vec3 q = p - vec3(0.0, 0.22, 1.65);
  float tray = sdBox(q, vec3(1.1, 0.06, 0.35));
  float lip = sdBox(q - vec3(0.0, 0.08, 0.0), vec3(1.15, 0.02, 0.4));
  return min(tray, lip);
}

float marbles(vec3 p) {
  float d = 1e4;
  int count = int(slot(26));
  for (int i = 0; i < 16; i++) {
    if (i >= count) break;
    float h = marbleHue(i);
    float r = 0.03 + fract(h * 10.0) * 0.035;
    if (h < 0.002) r = 0.04;
    d = min(d, sdSphere(p - marblePos(i), r));
  }
  return d;
}

float scene(vec3 p) {
  float d = trackTube(p);
  d = smin(d, woodFrame(p), 0.08);
  d = smin(d, jars(p), 0.05);
  d = min(d, rejectTray(p));
  d = min(d, marbles(p));
  return d;
}

vec3 marbleColor(float h) {
  float hue = fract(h);
  return 0.5 + 0.5 * cos(6.283 * (hue + vec3(0.0, 0.33, 0.67)));
}

vec3 shade(vec3 p, vec3 n, vec3 rd) {
  float mat = slot(23);
  vec3 wood = mix(vec3(0.45, 0.28, 0.14), vec3(0.62, 0.48, 0.28), mat * 0.5);
  if (mat > 1.5) wood = mix(vec3(0.55, 0.42, 0.22), vec3(0.75, 0.72, 0.55), 0.4);
  if (mat > 2.5) wood = mix(vec3(0.35, 0.32, 0.28), vec3(0.82, 0.78, 0.62), 0.5);
  vec3 col = wood * (0.35 + 0.65 * max(0.0, n.y));
  float tube = trackTube(p);
  if (abs(tube) < 0.05) {
    float gl = pow(1.0 - abs(tube) / 0.05, 2.0);
    col = mix(col, vec3(0.75, 0.88, 0.95), gl * 0.65);
  }
  float failR = slot(28), failG = slot(29), failB = slot(30);
  float tray = rejectTray(p);
  if (tray < 0.02) {
    vec3 failCol = vec3(failR, failG, failB);
    float glow = slot(20);
    col = mix(failCol, failCol * 1.3, glow);
  }
  float mDist = marbles(p);
  if (mDist < 0.05) {
    float h = 0.3;
    for (int i = 0; i < 16; i++) {
      if (length(p - marblePos(i)) < 0.06) h = marbleHue(i);
    }
    vec3 mc = marbleColor(h);
    vec3 refl = reflect(rd, n);
    float spec = pow(max(0.0, dot(refl, normalize(vec3(0.4, 0.9, 0.5)))), 32.0);
    col = mc * (0.4 + 0.6 * max(0.0, dot(n, normalize(vec3(0.3, 0.9, 0.4))))) + spec * 0.35;
  }
  return col;
}

float labelChar(int idx, vec2 uv) {
  float code = slot(32 + idx);
  int ch = int(floor(code * 36.0));
  if (ch < 0 || ch > 35) return 0.0;
  vec2 g = floor(uv * vec2(5.0, 7.0));
  if (g.x < 0.0 || g.x > 4.0 || g.y < 0.0 || g.y > 6.0) return 0.0;
  float bit = mod(float(ch + int(g.x) + int(g.y) * 5), 2.0);
  return bit;
}

vec4 hud(vec2 uv) {
  vec2 huv = (uv - vec2(0.02, 0.92)) * vec2(1.0, 0.25) * 18.0;
  float a = 0.0;
  for (int i = 0; i < 24; i++) {
    a = max(a, labelChar(i, huv - vec2(float(i) * 0.42, 0.0)));
  }
  vec3 fg = vec3(0.92, 0.88, 0.78);
  if (slot(21) > 0.5) fg = mix(fg, vec3(0.55, 0.85, 1.0), 0.35);
  return vec4(fg, a * 0.85);
}

void main() {
  vec3 ro = vec3(slot(13), slot(14), slot(15));
  vec3 ta = vec3(slot(16), slot(17), slot(18));
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec2 uv = gl_FragCoord.xy / vec2(1280.0, 800.0);
  uv = uv * 2.0 - 1.0;
  uv.x *= 1.6;
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.2 * ww);
  float t = 0.0;
  vec3 col = mix(uBg, vec3(0.12, 0.16, 0.22), 0.6);
  float alpha = uOpacity;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    float d = scene(p);
    if (d < 0.0015) {
      vec3 n = normalize(vec3(
        scene(p + vec3(0.001, 0.0, 0.0)) - scene(p - vec3(0.001, 0.0, 0.0)),
        scene(p + vec3(0.0, 0.001, 0.0)) - scene(p - vec3(0.0, 0.001, 0.0)),
        scene(p + vec3(0.0, 0.0, 0.001)) - scene(p - vec3(0.0, 0.0, 0.001))
      ));
      col = shade(p, n, rd);
      float shadow = 0.55 + 0.45 * clamp(scene(p + vec3(0.0, 0.2, 0.15)) * 8.0, 0.0, 1.0);
      col *= shadow;
      break;
    }
    t += d * 0.85;
    if (t > 18.0) break;
  }
  col *= uBright;
  col = mix(col, uAccent * 0.15, 0.08 + uAudio * 0.12);
  vec4 hudCol = hud(uv);
  col = mix(col, hudCol.rgb, hudCol.a);
  float vig = smoothstep(1.4, 0.25, length(uv));
  col *= 0.65 + 0.35 * vig;
  fragColor = vec4(col, alpha);
}
