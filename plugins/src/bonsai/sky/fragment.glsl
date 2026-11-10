// Bonsai — the garden behind the bench. The bench, board, slab and tree are host meshes
// (assets/bonsai-*.glb); this sky is only the soft-focus garden: a clipped hedge, a far canopy
// and the sky above, with still bokeh where the sun comes through. Time of day sets the warmth
// and level of the light, autumn shifts the garden's mood a little, and a steady Zoto Fail chip
// (no flashing) shows while sys.failed holds the tree in autumn.

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  return noise(p) * 0.55 + noise(p * 2.03 + 7.1) * 0.3 + noise(p * 4.1 + 3.7) * 0.15;
}

float rbox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  // the host parents the dome to the camera: vDir is a camera-local ray (-z forward)
  vec3 ray = normalize(vDir);
  bool live = slot(0) > 0.5;
  vec3 eye = live ? vec3(slot(1), slot(2), slot(3)) : vec3(0.0, 0.582, 1.467);
  vec3 aim = live ? vec3(slot(4), slot(5), slot(6)) : vec3(0.0, 0.27, 0.0);
  float fov = live && slot(7) > 5.0 ? slot(7) : 30.0;
  float autumn = live ? slot(10) : 0.0;
  float warmth = live ? slot(11) : 0.45;
  float sunElev = live ? slot(12) : 0.6;
  float light = live ? slot(13) : 0.85;
  float night = live ? slot(25) : 0.0;
  float failed = slot(9);
  vec3 fwd = normalize(aim - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 dir = normalize(right * ray.x + up * ray.y - fwd * ray.z);

  // the hedge stands 2.6 m behind the tree; intersect it so the garden has real perspective
  float t = dir.z < -0.02 ? (-2.6 - eye.z) / dir.z : 80.0;
  vec2 w = eye.xy + dir.xy * t;

  // sky: pale and high by day, peach at golden hour, deep blue at night
  float h = clamp(dir.y * 1.6 + 0.15, 0.0, 1.0);
  vec3 dayTop = vec3(0.55, 0.7, 0.86);
  vec3 dayLow = vec3(0.86, 0.9, 0.9);
  vec3 goldLow = vec3(1.0, 0.78, 0.55);
  vec3 goldTop = vec3(0.62, 0.62, 0.72);
  vec3 sky = mix(mix(dayLow, goldLow, warmth), mix(dayTop, goldTop, warmth), h);
  sky = mix(sky, mix(vec3(0.1, 0.13, 0.23), vec3(0.04, 0.06, 0.13), h), night);

  // far canopy: soft rounded crowns above the hedge, blurred by depth of field
  float crowns = 1.45 + 0.42 * fbm(vec2(w.x * 0.55, 1.3)) + 0.18 * sin(w.x * 1.7 + 1.3);
  float canopyMask = smoothstep(crowns + 0.08, crowns - 0.1, w.y);
  vec3 canopy = mix(vec3(0.16, 0.24, 0.16), vec3(0.3, 0.38, 0.22), fbm(w * 1.4));
  canopy = mix(canopy, vec3(0.42, 0.3, 0.16), autumn * 0.35 * fbm(w * 0.9 + 4.0));

  // clipped hedge: a long soft-edged band of deep green with lit clumps
  float top = 0.86 + 0.07 * fbm(vec2(w.x * 0.9, 4.2));
  float hedgeMask = smoothstep(top + 0.06, top - 0.05, w.y);
  float clump = fbm(w * vec2(2.2, 2.6));
  vec3 hedge = mix(vec3(0.07, 0.13, 0.07), vec3(0.22, 0.33, 0.14), smoothstep(0.3, 0.8, clump));
  hedge = mix(hedge, vec3(0.3, 0.24, 0.1), autumn * 0.25);
  // gravel and moss at the hedge foot, mostly hidden by the bench
  float foot = smoothstep(-0.25, -0.45, w.y);
  hedge = mix(hedge, mix(vec3(0.34, 0.32, 0.28), vec3(0.2, 0.24, 0.16), fbm(w * 3.0)), foot);

  vec3 col = mix(sky, canopy, canopyMask);
  col = mix(col, hedge, hedgeMask);

  // sun: warm by morning and evening, neutral at noon, gone at night
  vec3 tint = mix(vec3(0.92, 0.98, 1.05), vec3(1.18, 0.96, 0.72), warmth);
  vec3 sunLit = col * tint * (0.55 + 0.7 * light);
  vec3 moonLit = col * vec3(0.42, 0.5, 0.72) * 0.8;
  col = mix(sunLit, moonLit, night);

  // still bokeh where light comes through the canopy and hedge (no motion: calm)
  vec2 cellUv = w / 0.24;
  vec2 cell = floor(cellUv);
  float bokeh = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float r = hash(c);
      if (r < 0.62) continue;
      vec2 o = (c + vec2(hash(c + 3.1), hash(c + 7.7))) * 0.24;
      float rad = 0.045 + 0.05 * hash(c + 1.3);
      float d = length(w - o);
      float disc = smoothstep(rad, rad * 0.82, d);
      float rim = smoothstep(rad * 0.7, rad * 0.95, d) * disc;
      bokeh += (disc * 0.55 + rim * 0.45) * (0.5 + 0.5 * hash(c + 9.2));
    }
  }
  float inGarden = clamp(hedgeMask + canopyMask * 0.8, 0.0, 1.0) * (1.0 - foot);
  vec3 bokehCol = mix(vec3(0.95, 1.0, 0.85), vec3(1.0, 0.82, 0.5), warmth);
  bokehCol = mix(bokehCol, vec3(1.0, 0.62, 0.3), night);
  float sunUp = smoothstep(-0.05, 0.25, sunElev);
  // at night only a few lantern glows remain
  float lantern = night * step(0.9, hash(cell + 21.0));
  col += bokehCol * bokeh * inGarden * (0.16 * sunUp * light + 0.28 * lantern);

  // looking away from the garden (straight down at the bench): fall to shade
  col = mix(col * 0.6, col, smoothstep(-0.02, -0.12, dir.z));

  // screen frame (1 = top edge) for the vignette and the chip
  vec2 s = ray.xy / max(1e-3, -ray.z) / tan(radians(fov) * 0.5);
  col *= 1.0 - 0.2 * smoothstep(0.6, 1.7, length(s * vec2(0.55, 1.0)));

  if (failed > 0.5) {
    // slate chip with a fail-red face, upper right of centre; lit, never blinking
    vec2 q = s - vec2(1.15, 0.78);
    float d = rbox(q, vec2(0.13, 0.075), 0.03);
    float rim = 1.0 - smoothstep(0.0, 0.006, d);
    float face = 1.0 - smoothstep(-0.016, -0.011, d);
    vec3 fail = vec3(0.937, 0.325, 0.314);
    col = mix(col, vec3(0.2, 0.2, 0.19), rim);
    col = mix(col, fail * 0.85, face);
    float bar = 1.0 - smoothstep(0.0, 0.004, rbox(q - vec2(0.0, 0.012), vec2(0.008, 0.032), 0.006));
    float dot0 = 1.0 - smoothstep(0.0, 0.004, length(q + vec2(0.0, 0.04)) - 0.01);
    col = mix(col, vec3(0.98, 0.95, 0.9), max(bar, dot0) * face);
  }

  // fine grain so the 5120-wide garden never bands
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  fragColor = vec4(col * uBright, uOpacity);
}
