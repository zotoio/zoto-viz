float slot0(float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

float hexGrid(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 h = s * 0.5;
  vec2 a = mod(p, s) - h;
  vec2 b = mod(p - h, s) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float d = min(abs(g.x), abs(g.y * 0.866 + g.x * 0.5));
  return 1.0 - smoothstep(0.03, 0.09, d);
}

float ring(float r, float at, float w) {
  return 1.0 - smoothstep(w, w * 2.4, abs(r - at));
}

void main() {
  float cpu = slot0(0.0);
  float mem = slot0(1.0);
  float disk = slot0(2.0);
  float gpu = slot0(3.0);
  float temp = slot0(4.0);
  float watts = slot0(5.0);
  float psi = slot0(6.0);
  float socks = slot0(7.0);
  float failed = slot0(8.0);
  float udev = slot0(9.0);
  float aud = max(uAudio, slot0(10.0));
  float alert = slot0(11.0);
  float sw = slot0(12.0);
  float sh = slot0(13.0);
  if (sw < 64.0) sw = 1280.0;
  if (sh < 64.0) sh = 800.0;
  float load = clamp(cpu + mem + gpu + temp, 0.0, 3.0) * 0.33;

  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * vec2(sw, sh)) / min(sw, sh);
  float r = length(uv);
  float ang = atan(uv.y, uv.x);

  vec3 hud = vec3(0.22, 0.86, 1.0);
  vec3 col = vec3(0.03, 0.10, 0.14) + hud * (0.16 + 0.10 * load);

  float stars = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float band = sin(uv.x * (18.0 + fi * 4.0) + uv.y * (12.0 + fi) + uTime * (0.16 + fi * 0.05));
    stars += smoothstep(0.90, 1.0, band);
  }
  col += hud * stars * (0.10 + 0.08 * aud);

  float sweep = fract(ang / 6.2831853 - uTime * 0.08);
  float beam = (1.0 - smoothstep(0.0, 0.10, sweep)) * (1.0 - smoothstep(0.78, 0.18, r));

  float grid = hexGrid(uv * 7.2) * (1.0 - smoothstep(0.82, 0.22, r));
  float rings = 0.0;
  rings += ring(r, 0.16, 0.012);
  rings += ring(r, 0.32, 0.011);
  rings += ring(r, 0.48, 0.010);
  rings += ring(r, 0.64, 0.009);
  rings *= 0.65 + 0.35 * aud;

  float gauges = 0.0;
  for (int i = 0; i < 8; i++) {
    float gv = i == 0 ? cpu : i == 1 ? mem : i == 2 ? disk : i == 3 ? gpu
      : i == 4 ? temp : i == 5 ? watts : i == 6 ? psi : socks;
    float a0 = float(i) * 0.78539816 - 0.36;
    float span = 0.58 * clamp(gv, 0.12, 1.0);
    float da = atan(sin(ang - a0), cos(ang - a0));
    float onArc = step(0.0, da) * step(da, span);
    gauges += onArc * ring(r, 0.56, 0.018) * (0.85 + gv);
  }

  float core = exp(-r * r * 7.5) * (0.70 + load * 0.55 + aud * 0.28);
  float spokes = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.78539816;
    vec2 arm = vec2(cos(a), sin(a));
    float along = abs(uv.x * arm.y - uv.y * arm.x);
    float radial = dot(uv, arm);
    spokes += (1.0 - smoothstep(0.008, 0.028, along)) * step(0.10, radial) * step(radial, 0.68) * 0.55;
  }

  vec2 a = abs(uv);
  float corner = (1.0 - smoothstep(0.012, 0.032, min(abs(a.x - 0.78), abs(a.y - 0.42))))
    * step(0.62, a.x) * step(0.28, a.y) * step(a.x, 0.86) * step(a.y, 0.50);
  float tick = 0.0;
  for (int i = 0; i < 8; i++) {
    float a0 = float(i) * 0.78539816;
    vec2 p = vec2(cos(a0), sin(a0)) * 0.64;
    tick += 1.0 - smoothstep(0.012, 0.028, length(uv - p));
  }

  vec3 hol = hud * (0.85 * grid + 1.55 * rings + 1.75 * gauges + 1.35 * core + spokes + 0.95 * beam + 0.9 * corner + 0.7 * tick);
  hol += vec3(1.0, 0.32, 0.16) * failed * 0.65;
  hol += vec3(1.0, 0.62, 0.18) * psi * 0.32;
  hol += vec3(0.45, 1.0, 1.0) * udev * 0.22;
  float floorW = 1.0 - smoothstep(0.88, 0.18, r);
  col = mix(col, hol + col * 0.35, clamp(0.35 + 0.65 * floorW, 0.0, 1.0));

  float scan = 0.88 + 0.12 * sin(fc.y * 1.15 + uTime * 10.0);
  col *= scan;
  col += hud * (0.08 + 0.10 * load);
  col = mix(col, vec3(1.0, 0.28, 0.14), alert * 0.18 * (0.45 + 0.55 * sin(uTime * 6.0)));
  float vig = 1.0 - 0.18 * pow(length(uv * vec2(1.15, 1.0)), 1.6);
  fragColor = vec4(col * max(uBright, 0.72) * vig, max(uOpacity, 0.88));
}
