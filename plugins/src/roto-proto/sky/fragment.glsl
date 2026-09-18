void main() {
  vec3 dir = normalize(vDir);
  vec2 uv = vec2(dir.x, dir.z) / max(0.22, abs(dir.y));
  float lead = max(0.35, zotoVizSlots[0].x);
  float mixv = max(0.25, zotoVizSlots[0].y);
  float ang = uTime * (0.42 + lead * 0.7) + mixv * 1.1;
  float c = cos(ang), s = sin(ang);
  uv = mat2(c, -s, s, c) * uv;
  float zoom = 2.6 + 2.1 * sin(uTime * 0.28 + mixv) + uAudio * 1.2;
  uv *= zoom;
  vec2 cell = floor(uv);
  float checker = mod(cell.x + cell.y, 2.0);
  float n = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec3 a = mix(uBg, vec3(0.12, 0.95, 0.28), 0.55);
  vec3 b = mix(uAccent, vec3(0.95, 0.12, 0.78), 0.65);
  vec3 col = mix(a, b, checker);
  col = mix(col, vec3(1.0, 0.95, 0.2), n * 0.18);
  float scan = 0.88 + 0.12 * sin(uv.y * 40.0 + uTime * 8.0);
  float vign = smoothstep(2.6, 0.35, length(uv / max(zoom, 0.2)));
  fragColor = vec4(col * uBright * scan * (0.65 + 0.4 * vign), uOpacity);
}
