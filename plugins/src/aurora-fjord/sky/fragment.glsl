// Aurora Fjord — the night over the fjord. Terrain, shore, cabins and their reflections are host
// meshes (assets/fjord-*.glb); this sky is the aurora (raymarched curtains whose strength, speed
// and latitude follow the planetary Kp), the stars, the open water's mirror of both, the haze and
// the fog bank that rolls in on sys.failed (the same formula the scenery puts on the land), a
// steady Zoto Fail chip and a small Kp gauge. Motion comes from the pack's slots, so the chip and
// the gauge never pulse.

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

float rbox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// aurora state, read once in main()
float gPhase;
float gStrength;
float gLat;
float gStorm;
float gAudio;
float gFog;
float gTime;
int gSteps;
vec3 gGreen;

// band i: distance north (sky units, base altitude = 1) and weight
float bandDist(int i) {
  float d0 = mix(7.0, 3.0, gLat);
  return i == 0 ? d0 : i == 1 ? d0 + 3.2 : d0 * 0.62;
}

float bandWeight(int i) {
  return i == 0 ? 1.0 : i == 1 ? 0.5 + 0.2 * gLat : gStorm;
}

float bandCentre(int i, float x) {
  float fi = float(i);
  return -bandDist(i) + 0.8 * sin(x * 0.55 + gPhase * 0.11 + fi * 2.1) + 0.35 * sin(x * 1.7 - gPhase * 0.19 + fi * 4.7);
}

// curtain density at horizontal point q (x, z)
float curtain(vec2 q) {
  float d = 0.0;
  for (int i = 0; i < 3; i++) {
    float wgt = bandWeight(i);
    if (wgt < 0.01) continue;
    float fi = float(i);
    float dz = q.y - bandCentre(i, q.x);
    float w = 0.32 + 0.1 * sin(q.x * 0.7 + fi);
    float core = exp(-dz * dz / (w * w));
    if (core < 0.002) continue;
    float rays = 0.3 + 0.7 * pow(noise(vec2(q.x * 6.0 + dz * 1.2 + gPhase * 0.55, fi * 9.1 + gPhase * 0.04)), 1.5);
    float patchy = smoothstep(0.2, 0.75, noise(vec2(q.x * 0.5 - gPhase * 0.07, fi * 3.3)));
    d += core * rays * (0.3 + 0.7 * patchy) * wgt;
  }
  return d;
}

// raymarch the curtain layer along an upward ray (dir.y > 0)
vec3 aurora(vec3 dir) {
  if (dir.y < 0.004 || gStrength < 0.005) return vec3(0.0);
  float span = 1.6 + 0.8 * gStorm;
  // the ray's z over the layer, and the bands' reach: skip the march where no curtain can be
  float k = dir.z / dir.y;
  float z0 = k;
  float z1 = k * (1.0 + span);
  bool any = false;
  for (int i = 0; i < 3; i++) {
    if (bandWeight(i) < 0.01) continue;
    float c = -bandDist(i);
    if (max(z0, z1) > c - 2.4 && min(z0, z1) < c + 2.4) any = true;
  }
  if (!any) return vec3(0.0);
  vec3 top = mix(vec3(0.32, 0.12, 0.55), vec3(0.95, 0.16, 0.34), gStorm);
  vec3 fringe = vec3(1.0, 0.32, 0.62);
  vec3 acc = vec3(0.0);
  float jitter = hash12(gl_FragCoord.xy);
  for (int s = 0; s < 32; s++) {
    if (s >= gSteps) break;
    float h = (float(s) + jitter) / float(gSteps);
    float y = 1.0 + span * h;
    vec2 q = dir.xz * (y / dir.y);
    float dens = curtain(q);
    if (dens < 0.003) continue;
    float prof = smoothstep(0.0, 0.05, h) * (0.85 * exp(-h * 3.2) + 0.18 * exp(-pow((h - 0.5) / 0.28, 2.0)));
    vec3 c = mix(gGreen, top, smoothstep(0.18, 0.85, h));
    c += fringe * gStorm * (1.0 - smoothstep(0.0, 0.09, h)) * 0.8;
    c *= 1.0 + 0.3 * gAudio * (1.0 - smoothstep(0.0, 0.2, h));
    acc += c * dens * prof;
  }
  // a ray crosses a sheet face-on, so the mean density along it is small: lift it, then knee
  // it so a storm's overlapping bands glow rather than clip
  float slant = clamp(0.3 / dir.y, 0.9, 2.2);
  vec3 a = acc / float(gSteps) * gStrength * 26.0 * slant * smoothstep(0.004, 0.07, dir.y);
  return a / (1.0 + 0.6 * a);
}

vec3 stars(vec3 dir) {
  if (dir.y < 0.0) return vec3(0.0);
  float az = atan(dir.x, -dir.z);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float scale = l == 0 ? 300.0 : 95.0;
    float thresh = l == 0 ? 0.982 : 0.993;
    vec2 g = vec2(az * cos(el), el) * scale;
    vec2 cell = floor(g);
    float h = hash12(cell + float(l) * 41.0);
    if (h < thresh) continue;
    vec2 c = vec2(hash12(cell + 7.1), hash12(cell + 3.7)) * 0.6 + 0.2;
    vec2 d = fract(g) - c;
    float r = l == 0 ? 0.075 : 0.05;
    float mag = (h - thresh) / (1.0 - thresh);
    float tw = 0.8 + 0.2 * sin(gTime * (2.0 + 3.0 * h) + h * 91.0);
    vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash12(cell + 1.3));
    col += tint * exp(-dot(d, d) / (r * r)) * (0.25 + 0.75 * mag) * tw * (l == 0 ? 0.7 : 1.2);
  }
  return col * smoothstep(0.0, 0.12, dir.y);
}

// the night sky along dir: gradient, moon glow, stars and aurora
vec3 night(vec3 dir, vec3 haze, float moon) {
  float up = max(dir.y, 0.0);
  vec3 zenith = vec3(0.01, 0.016, 0.038) + moon * vec3(0.006, 0.01, 0.02);
  vec3 col = mix(haze, zenith, smoothstep(0.0, 0.42, up));
  vec3 moonDir = normalize(vec3(-0.53, 0.68, 0.5));
  col += vec3(0.05, 0.065, 0.1) * moon * pow(max(0.0, dot(dir, moonDir)), 6.0);
  vec3 aur = aurora(dir);
  float clear = 1.0 - 0.78 * gFog;
  col += stars(dir) * clear * (1.0 - min(0.8, dot(aur, vec3(1.2)))) * (1.0 - 0.6 * moon);
  col += aur * clear;
  // the aurora lights the sky glow around it
  col += gGreen * 0.03 * gStrength * clear * exp(-up * 6.0);
  return col;
}

void main() {
  // the host parents the dome to the camera: vDir is a camera-local ray (-z forward)
  vec3 ray = normalize(vDir);
  bool live = slot(0) > 0.5;
  vec3 eye = live ? vec3(slot(1), slot(2), slot(3)) : vec3(8.0, 14.0, 40.0);
  vec3 aim = live ? vec3(slot(4), slot(5), slot(6)) : vec3(0.0, 92.0, -800.0);
  float fov = live && slot(7) > 5.0 ? slot(7) : 34.0;
  gStrength = live ? slot(9) : 0.45;
  gLat = live ? slot(11) : 0.35;
  gStorm = live ? slot(12) : 0.0;
  gFog = live ? slot(13) : 0.0;
  float failed = slot(14);
  float kpLive = slot(15);
  gAudio = slot(16);
  gSteps = slot(19) > 0.5 ? 16 : 32;
  float moon = live ? slot(22) : 0.55;
  float front = live ? slot(24) : -1350.0;
  float calm = live ? slot(25) : 1.0;
  gPhase = slot(26);
  float gauge = live ? slot(27) : 0.0;
  vec3 haze = live ? vec3(slot(28), slot(29), slot(30)) : vec3(0.04, 0.055, 0.085);
  gGreen = live ? vec3(slot(31), slot(32), slot(33)) : vec3(0.26, 0.92, 0.56);
  gTime = slot(34);
  float kp = slot(8);

  vec3 fwd = normalize(aim - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 dir = normalize(right * ray.x + up * ray.y - fwd * ray.z);

  vec3 col;
  if (dir.y >= 0.0) {
    col = night(dir, haze, moon);
    // distance haze toward the horizon and the bank's height over the fjord head
    col = mix(col, haze, 0.8 * exp(-dir.y * 22.0));
    float far = 1400.0 / max(0.05, length(dir.xz));
    float hy = eye.y + dir.y * far;
    float roll = 0.75 + 0.25 * sin(dir.x * 6.0 + gTime * 0.05);
    float bank = gFog * roll * exp(-max(hy, 0.0) / (30.0 + 70.0 * gFog));
    col = mix(col, haze, clamp(bank, 0.0, 0.96));
  } else {
    // still water: the mirrored sky, broken up a little by the ripples' swell
    float t = eye.y / -dir.y;
    vec3 p = eye + dir * t;
    float amp = 0.003 + 0.018 * (1.0 - calm);
    vec2 n = vec2(noise(p.xz * 0.08 + vec2(gTime * 0.11, 0.0)), noise(p.zx * 0.08 + vec2(0.0, gTime * 0.09))) - 0.5;
    vec3 r = normalize(vec3(dir.x + n.x * amp, max(0.002, -dir.y), dir.z + n.y * amp));
    float fres = 0.04 + 0.96 * pow(1.0 - min(1.0, -dir.y), 5.0);
    vec3 refl = night(r, haze, moon) * (0.62 + 0.25 * calm);
    vec3 deep = vec3(0.006, 0.01, 0.016) + haze * 0.15;
    col = mix(deep, refl, fres);
    // the same haze and fog bank the scenery lays over the land
    float d = length(p - eye);
    float hz = 1.0 - exp(-d * (0.00022 + 0.0011 * gFog));
    float roll = 0.75 + 0.25 * sin(p.x * 0.011 + p.z * 0.004 + gTime * 0.05);
    float bank = gFog * roll * smoothstep(front + 220.0, front - 60.0, p.z);
    col = mix(col, haze, clamp(max(hz * 0.8, bank), 0.0, 0.96));
  }

  // screen frame (1 = top edge) for the chip and the gauge
  vec2 s = ray.xy / max(1e-3, -ray.z) / tan(radians(fov) * 0.5);

  if (failed > 0.5) {
    // Zoto Fail chip, upper right; lit, never blinking
    vec2 q = s - vec2(1.2, 0.8);
    float dch = rbox(q, vec2(0.085, 0.032), 0.03);
    float chip = 1.0 - smoothstep(0.0, 0.004, dch);
    col = mix(col, vec3(0.937, 0.325, 0.314) * 0.85, chip * 0.92);
    float bar = 1.0 - smoothstep(0.0, 0.003, rbox(q + vec2(0.0, -0.004), vec2(0.004, 0.014), 0.003));
    float dot0 = 1.0 - smoothstep(0.0, 0.003, length(q + vec2(0.0, 0.019)) - 0.005);
    col = mix(col, vec3(0.98, 0.94, 0.88), max(bar, dot0) * chip);
  }

  if (gauge > 0.5) {
    // Kp gauge, upper left: nine segments up to the current Kp, the last 24 h as bars beneath.
    // Hollow segments while Kp is the demo curve rather than the source.
    vec2 g = s - vec2(-1.42, 0.8);
    for (int i = 0; i < 9; i++) {
      vec2 c = g - vec2(float(i) * 0.03, 0.0);
      float dseg = rbox(c, vec2(0.011, 0.012), 0.003);
      float fill = clamp(kp - float(i), 0.0, 1.0);
      vec3 sc = float(i) < 4.0 ? vec3(0.35, 0.95, 0.55) : float(i) < 5.0 ? vec3(0.95, 0.85, 0.35) : vec3(0.95, 0.35, 0.4);
      float edge = 1.0 - smoothstep(0.0, 0.0025, abs(dseg));
      float inside = 1.0 - smoothstep(0.0, 0.0025, dseg);
      float body = kpLive > 0.5 ? inside * (0.12 + 0.75 * fill) : max(edge * 0.6, inside * 0.35 * fill);
      col = mix(col, sc, body * 0.85);
    }
    for (int i = 0; i < 8; i++) {
      float v = clamp(slot(40 + i) / 9.0, 0.0, 1.0);
      vec2 c = g - vec2(float(i) * 0.0337 + 0.002, -0.05);
      float hb = 0.003 + 0.03 * v;
      float dbar = rbox(c + vec2(0.0, hb), vec2(0.009, hb), 0.002);
      col = mix(col, vec3(0.7, 0.8, 0.9), (1.0 - smoothstep(0.0, 0.0025, dbar)) * 0.45);
    }
  }

  // fine grain so the 5120-wide gradient never bands
  float gn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gn - 0.5) / 255.0;
  fragColor = vec4(col * uBright, uOpacity);
}
