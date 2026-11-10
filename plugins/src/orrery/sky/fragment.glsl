// Orrery — the study behind the desk. The desk, the machine and the planets are host meshes
// (assets/orrery-*.glb); this sky is only the room: walnut wainscot under a dado rail, dark
// striped paper above, the banker's lamp's warm pool on the wall, and a steady Zoto Fail plaque
// (no flashing) while sys.failed holds the escapement slow.

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

float rbox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  // the host parents the dome to the camera: vDir is a camera-local ray (-z forward)
  vec3 ray = normalize(vDir);
  bool live = slot(0) > 0.5;
  vec3 eye = live ? vec3(slot(1), slot(2), slot(3)) : vec3(0.0, 0.749, 1.233);
  vec3 aim = live ? vec3(slot(4), slot(5), slot(6)) : vec3(0.0, 0.2, 0.0);
  float fov = live && slot(7) > 5.0 ? slot(7) : 30.0;
  float lamp = live ? slot(23) : 0.7;
  float failed = slot(9);
  vec3 fwd = normalize(aim - eye);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 dir = normalize(right * ray.x + up * ray.y - fwd * ray.z);

  // the wall is a plane 1 m behind the orrery; intersect it so the panelling has real perspective
  float t = dir.z < -0.02 ? (-1.0 - eye.z) / dir.z : 60.0;
  vec2 w = eye.xy + dir.xy * t;
  float rail = 0.3;

  // walnut wainscot: stiles every 0.62 m, recessed fields, fine vertical grain
  float px = w.x / 0.62 + 0.5;
  float fx = fract(px);
  float cell = floor(px);
  float grain = noise(vec2(w.x * 55.0 + cell * 3.1, w.y * 2.5)) * 0.6 + noise(vec2(w.x * 160.0, w.y * 11.0)) * 0.3;
  vec3 walnut = vec3(0.19, 0.105, 0.06) * (0.78 + 0.45 * grain);
  float field = smoothstep(0.06, 0.075, fx) * smoothstep(0.94, 0.925, fx) * smoothstep(-0.25, -0.235, w.y) * smoothstep(rail - 0.05, rail - 0.065, w.y);
  vec3 col = walnut * mix(1.18, 0.82, field);
  // bevel catch-light along the top of each field
  col += vec3(0.05, 0.032, 0.018) * field * smoothstep(rail - 0.09, rail - 0.066, w.y) * (1.0 - smoothstep(rail - 0.066, rail - 0.06, w.y));
  // dado rail moulding
  float moulding = smoothstep(rail - 0.004, rail, w.y) * (1.0 - smoothstep(rail + 0.03, rail + 0.034, w.y));
  col = mix(col, walnut * 1.35 + vec3(0.03, 0.018, 0.01) * smoothstep(rail + 0.012, rail + 0.022, w.y), moulding);
  // dark oxblood paper with a quiet stripe above the rail
  float stripe = smoothstep(0.35, 0.5, abs(fract(w.x / 0.09) - 0.5));
  vec3 paper = mix(vec3(0.15, 0.062, 0.05), vec3(0.18, 0.08, 0.06), stripe) * (0.9 + 0.2 * noise(w * 40.0));
  col = mix(col, paper, smoothstep(rail + 0.032, rail + 0.036, w.y));

  // warm light: the lamp's pool to the right and a softer spill around the machine
  vec2 dl = (w - vec2(0.92, 0.5)) * vec2(0.85, 1.25);
  float pool = exp(-dot(dl, dl) / 0.2);
  vec2 dc = (w - vec2(0.0, 0.35)) * vec2(0.6, 1.0);
  float spill = exp(-dot(dc, dc) / 0.5);
  vec3 warm = vec3(1.0, 0.7, 0.4);
  col *= 0.95 + (1.6 * pool + 0.6 * spill) * (0.35 + lamp) * warm + uAudio * 0.05;

  // looking away from the wall (orbits behind it, or straight down): fall to the room's dark
  col = mix(vec3(0.035, 0.024, 0.018), col, smoothstep(-0.02, -0.12, dir.z));

  // screen frame (1 = top edge) for the vignette and the plaque
  vec2 s = ray.xy / max(1e-3, -ray.z) / tan(radians(fov) * 0.5);
  col *= 1.0 - 0.18 * smoothstep(0.6, 1.6, length(s * vec2(0.55, 1.0)));

  if (failed > 0.5) {
    // brass-rimmed enamel plaque, upper right of centre; lit, never blinking
    vec2 q = s - vec2(1.15, 0.78);
    float d = rbox(q, vec2(0.13, 0.075), 0.02);
    float rim = 1.0 - smoothstep(0.0, 0.006, d);
    float enamel = 1.0 - smoothstep(-0.016, -0.011, d);
    vec3 fail = vec3(0.937, 0.325, 0.314);
    col = mix(col, vec3(0.62, 0.46, 0.22), rim);
    col = mix(col, fail * 0.85, enamel);
    float bar = 1.0 - smoothstep(0.0, 0.004, rbox(q - vec2(0.0, 0.012), vec2(0.008, 0.032), 0.006));
    float dot0 = 1.0 - smoothstep(0.0, 0.004, length(q + vec2(0.0, 0.04)) - 0.01);
    col = mix(col, vec3(0.98, 0.93, 0.84), max(bar, dot0) * enamel);
  }

  // fine grain so the 5120-wide wall never bands
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  fragColor = vec4(col * uBright, uOpacity);
}
