// Ant Colony cutaway — soil strata, chambers, pheromone trails, marching ants, fail soldiers on top.
uniform float uTime;
uniform float uBright;
uniform float uAudio;
uniform float uOpacity;
uniform vec3 uAccent;
uniform vec3 uBg;
in vec3 vDir;
out vec4 fragColor;

#define PI 3.14159265
const vec3 FAIL_COL = vec3(1.0, 0.2, 0.33);
const float SOIL_LIFT = 1.8;
const vec3 SOIL_AMBIENT = vec3(0.02, 0.015, 0.01);

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

const uvec2 LABEL_FONT[59] = uvec2[](
  uvec2(0u,0u), uvec2(135300u,1u), uvec2(10570u,0u), uvec2(11512810u,0u),
  uvec2(524752836u,1u), uvec2(27070835u,0u), uvec2(2471564582u,5u), uvec2(2180u,0u),
  uvec2(136382600u,2u), uvec2(2290360450u,0u), uvec2(719469220u,1u), uvec2(139432064u,0u),
  uvec2(2285895680u,0u), uvec2(1015808u,0u), uvec2(0u,1u), uvec2(1118480u,0u),
  uvec2(2738546222u,3u), uvec2(2286031044u,3u), uvec2(3292807726u,7u), uvec2(3775349263u,3u),
  uvec2(301246856u,2u), uvec2(2735225919u,3u), uvec2(2736227404u,3u), uvec2(2216829471u,0u),
  uvec2(2736211502u,3u), uvec2(2433697326u,1u), uvec2(4194432u,0u), uvec2(2285895808u,0u),
  uvec2(136349832u,2u), uvec2(32537600u,0u), uvec2(2290622594u,0u), uvec2(4473390u,1u),
  uvec2(2212165166u,3u), uvec2(1663026734u,4u), uvec2(3809986095u,3u), uvec2(2718991918u,3u),
  uvec2(3810051631u,3u), uvec2(3256321087u,7u), uvec2(1108837439u,0u), uvec2(2736686638u,3u),
  uvec2(1663026737u,4u), uvec2(2286030990u,3u), uvec2(2458132764u,1u), uvec2(1381078321u,4u),
  uvec2(3255862305u,7u), uvec2(1662703473u,4u), uvec2(1662834289u,4u), uvec2(2736309806u,3u),
  uvec2(1108854319u,0u), uvec2(2472068654u,5u), uvec2(1381484079u,4u), uvec2(2735146542u,3u),
  uvec2(138547359u,1u), uvec2(2736309809u,3u), uvec2(353945137u,1u), uvec2(2874852913u,2u),
  uvec2(1654794801u,4u), uvec2(138553905u,1u), uvec2(3257016863u,7u)
);

float labelFontBit(int code, int fx, int fy) {
  if (fx < 0 || fy < 0 || fx > 4 || fy > 6) return 0.0;
  int i = clamp(code - 32, 0, 58);
  uint bit = uint(fy * 5 + fx);
  uvec2 g = LABEL_FONT[i];
  uint on = bit < 32u ? ((g.x >> bit) & 1u) : ((g.y >> (bit - 32u)) & 1u);
  return float(on);
}

float labelGlyph(int code, vec2 uv) {
  if (uv.x < -0.12 || uv.y < -0.12 || uv.x > 1.12 || uv.y > 1.12) return 0.0;
  vec2 p = vec2(uv.x * 5.0, (1.0 - uv.y) * 7.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float s00 = labelFontBit(code, int(i.x), int(i.y));
  float s10 = labelFontBit(code, int(i.x) + 1, int(i.y));
  float s01 = labelFontBit(code, int(i.x), int(i.y) + 1);
  float s11 = labelFontBit(code, int(i.x) + 1, int(i.y) + 1);
  vec2 w = smoothstep(0.08, 0.92, f);
  return mix(mix(s00, s10, w.x), mix(s01, s11, w.x), w.y);
}

float labelInk(vec2 uv, float labelLen) {
  if (labelLen < 0.5) return 0.0;
  vec2 plaque = vec2((uv.x - 0.04) / 0.48, (uv.y - 0.885) / 0.08);
  if (plaque.x < 0.0 || plaque.y < 0.0 || plaque.y > 1.0 || plaque.x > 1.0) return 0.0;
  int cols = int(min(labelLen, 8.0));
  if (cols < 1) return 0.0;
  int ci = int(floor(plaque.x * float(cols)));
  if (ci < 0 || ci >= cols) return 0.0;
  float packed = slot(16 + ci);
  int code = int(packed * 95.0 + 0.5) + 32;
  vec2 cellUv = vec2(fract(plaque.x * float(cols)), plaque.y);
  return labelGlyph(code, (cellUv - vec2(0.06, 0.1)) / vec2(0.88, 0.78));
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

float pheroAt(vec2 uv) {
  int gx = int(clamp(uv.x, 0.0, 0.999) * 32.0);
  int gy = int(clamp(uv.y, 0.0, 0.999) * 8.0);
  int idx = gy * 32 + gx;
  return slot(192 + idx);
}

float chamberField(vec2 uv) {
  float chambers = slot(12);
  float d = 1e3;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= chambers) break;
    int o = 64 + i * 4;
    vec2 c = vec2(slot(o), slot(o + 1));
    float r = slot(o + 2);
    float cd = length(uv - c) - r;
    d = min(d, cd);
  }
  return d;
}

float tunnelField(vec2 uv) {
  float tunnels = slot(13);
  float d = 1e3;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= tunnels) break;
    int o = 128 + i * 4;
    vec2 a = vec2(slot(o), slot(o + 1));
    vec2 b = vec2(slot(o + 2), slot(o + 3));
    vec2 pa = uv - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    float td = length(pa - ba * h) - 0.012;
    d = min(d, td);
  }
  return d;
}

float antBody(vec2 p, vec2 pos, float head, float phase, float crumb, float soldier) {
  vec2 q = p - pos;
  float cs = cos(head * PI);
  float sn = sin(head * PI);
  q = vec2(q.x * cs + q.y * sn, -q.x * sn + q.y * cs);
  float body = length(q / vec2(0.018, 0.008)) - 1.0;
  float legWave = sin(phase * 6.283 + q.x * 40.0);
  float legs = 1e3;
  for (int i = 0; i < 3; i++) {
    float side = float(i) - 1.0;
    vec2 lp = q - vec2(float(i) * 0.01 - 0.01, side * 0.006);
    float ang = side * 0.9 + legWave * 0.35;
    vec2 tip = lp + vec2(cos(ang), sin(ang)) * 0.014;
    legs = min(legs, length(tip) - 0.002);
  }
  float crumbGlow = exp(-dot(q - vec2(0.016, 0.0), q - vec2(0.016, 0.0)) * 800.0) * crumb;
  float d = min(body, legs);
  if (soldier > 0.5) d = min(d, body - 0.004);
  return d - crumbGlow * 0.004;
}

float antsField(vec2 uv) {
  float d = 1e3;
  for (int i = 0; i < 8; i++) {
    int o = 448 + i * 6;
    vec2 pos = vec2(slot(o), slot(o + 1));
    if (length(pos) < 0.001) continue;
    float head = slot(o + 2);
    float phase = slot(o + 3);
    float crumb = slot(o + 4);
    float soldier = slot(o + 5);
    d = min(d, antBody(uv, pos, head, phase, crumb, soldier));
  }
  return d;
}

vec3 soilColor(vec2 uv, float strata) {
  float band = uv.y + fbm(uv * 3.0) * 0.08;
  vec3 loam = mix(vec3(0.12, 0.08, 0.05), vec3(0.22, 0.14, 0.08), smoothstep(0.2, 0.9, band));
  vec3 sand = mix(vec3(0.18, 0.14, 0.09), vec3(0.28, 0.22, 0.14), band);
  vec3 rock = mix(vec3(0.1, 0.09, 0.08), vec3(0.2, 0.18, 0.16), fbm(uv * 6.0));
  vec3 base = strata < 0.5 ? loam : (strata < 1.5 ? sand : rock);
  float roots = smoothstep(0.55, 0.95, fbm(uv * vec2(4.0, 1.2)));
  float pebb = step(0.92, fbm(uv * 11.0));
  base = mix(base, base * 0.7 + vec3(0.05), roots * 0.35);
  base += vec3(0.04) * pebb;
  // Lift the whole soil (base colour and a warm ambient), not just the dim outside the cut:
  // at 0.7 dim the bare loam still drew luma ~16-20 in the app and QE's patches read it as black.
  return base * SOIL_LIFT + SOIL_AMBIENT;
}

void main() {
  // vDir is the camera-local ray (the host parents plugin skies to the camera and
  // levels the stage-only camera), so the view looks down -z. Map the screen plane
  // onto the cutaway (0.9 fits the host 55 degree view top to bottom); a world-dome
  // dir.xz / |dir.y| mapping would put the whole view off the formicarium.
  vec3 dir = normalize(vDir);
  vec2 uv = dir.xy / max(-dir.z, 0.18) * 0.9 + 0.5;
  // Before the first frame the meta slots are zero: use the static cutaway camera
  // (colony.ts packSlots defaults) instead of dividing by a zero zoom.
  bool meta = slot(2) > 0.0;
  vec2 cam = meta ? vec2(slot(0), slot(1)) : vec2(0.5, 0.45);
  float zoom = meta ? slot(2) : 1.1;
  uv = (uv - 0.5) / zoom + cam;

  float day = slot(3);
  float rain = slot(4);
  float fail = slot(5);
  float soil = slot(10);
  float failWash = smoothstep(0.02, 0.45, fail);

  vec3 col = soilColor(uv, soil);
  col = mix(col, mix(col, FAIL_COL, 0.35 + fail * 0.25), failWash * 0.55);
  float cut = smoothstep(0.02, 0.0, abs(dir.y + 0.15));
  col = mix(col * 0.7, col, cut);

  float ph = pheroAt(uv);
  col += uAccent * ph * (0.35 + uAudio * 0.2);

  float cd = chamberField(uv);
  float td = tunnelField(uv);
  float cavity = min(cd, td);
  if (cavity < 0.0) {
    col = mix(col, uBg * 0.25 + vec3(0.05, 0.03, 0.02), smoothstep(0.02, -0.02, cavity));
    col += uAccent * 0.15 * exp(cavity * 30.0);
  }

  float ad = antsField(uv);
  vec3 antCol = mix(uAccent * 0.55, FAIL_COL, max(step(0.5, fail), 0.0) * step(0.0, -ad));
  antCol = mix(antCol, FAIL_COL, failWash * step(0.0, -ad));
  if (ad < 0.01) col = mix(col, antCol, smoothstep(0.01, -0.005, ad));

  float sky = max(0.0, dir.y) * (0.35 + 0.35 * day);
  col += vec3(0.55, 0.65, 0.85) * sky * (1.0 - rain * 0.35);
  if (rain > 0.5) col *= 0.92 + 0.04 * sin(uv.x * 80.0 + uTime * 6.0);

  float labelLen = slot(15);
  if (labelLen > 0.5 && uv.y > 0.88 && uv.x < 0.55) {
    col = mix(col, vec3(0.95, 0.92, 0.85), 0.65);
    float ink = labelInk(uv, labelLen);
    col = mix(col, vec3(0.18, 0.14, 0.1), smoothstep(0.15, 0.72, ink));
  }

  col *= uBright;
  fragColor = vec4(col, uOpacity);
}
