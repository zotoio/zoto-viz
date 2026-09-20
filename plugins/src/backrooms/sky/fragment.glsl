float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float clamp01(float x) {
  return clamp(x, 0.0, 1.0);
}

float ss(float e0, float e1, float x) {
  float t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}

float holdPh(float ph, float a, float b) {
  return ss(0.0, a, ph) * ss(b + 0.12, b, ph);
}

float bandPh(float ph, float a, float b) {
  return ss(a, a + 0.07, ph) * ss(b + 0.10, b, ph);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCorridor(vec3 p) {
  vec2 wall = abs(p.xy) - vec2(1.05, 0.42);
  float room = max(wall.x, wall.y);
  float trim = abs(p.y + 0.34) - 0.025;
  return min(room, trim);
}

float carpet(vec3 p) {
  vec2 tile = fract(p.xz * 0.55);
  float seam = min(min(tile.x, 1.0 - tile.x), min(tile.y, 1.0 - tile.y));
  float weave = 0.5 + 0.5 * sin(p.x * 18.0) * sin(p.z * 16.0);
  return mix(0.55, 0.92, weave) * (1.0 - smoothstep(0.0, 0.04, seam));
}

vec3 wallpaper(vec3 p) {
  vec2 uv = p.xz * 0.35;
  float stripe = 0.5 + 0.5 * sin(uv.y * 6.283 + hash21(floor(uv)) * 0.4);
  vec3 base = mix(vec3(0.72, 0.68, 0.34), vec3(0.78, 0.74, 0.40), stripe);
  float stain = hash21(floor(uv * 2.7)) * 0.08;
  return base * (0.92 + stain);
}

float lightPanel(vec3 p) {
  float row = mod(floor(p.z * 0.22), 3.0);
  vec3 c = vec3(0.0, 0.36 + row * 0.02, p.z);
  vec3 q = abs(p - c) - vec3(0.95, 0.04, 0.18);
  float box = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  return 1.0 - smoothstep(0.0, 0.035, box);
}

float entitySilhouette(vec3 p, float phA, float seen, float turned) {
  float up = holdPh(phA, 0.04, 0.10) * (1.0 - seen);
  vec3 e = p - vec3(0.0, 0.05 + up * 0.18, mod(p.z + uTime * 0.9, 6.0) - 3.0);
  e.xy *= mat2(0.92, -0.08, 0.08, 0.92);
  float body = sdBox(e, vec3(0.14, 0.34 + seen * 0.08, 0.08));
  float lean = ss(0.16, 0.22, phA);
  e.x += lean * 0.22;
  body = min(body, sdBox(e + vec3(lean * 0.12, -0.05, 0.0), vec3(0.11, 0.28, 0.07)));
  float shade = 1.0 - smoothstep(0.0, 0.05, body);
  return shade * mix(up * 0.85 + seen * 0.55, turned * 0.95, turned);
}

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

vec3 march(vec3 ro, vec3 rd, float phA, float seen, float turned, float flee) {
  float t = 0.0;
  vec3 col = vec3(0.05, 0.04, 0.03);
  float glow = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = sdCorridor(p);
    if (d < 0.0015) {
      if (p.y < -0.18) {
        col = mix(vec3(0.48, 0.42, 0.22), vec3(0.62, 0.55, 0.28), carpet(p));
      } else if (p.y > 0.18) {
        float panel = lightPanel(p);
        col = mix(wallpaper(p), vec3(0.95, 0.98, 0.86), panel * (0.65 + 0.25 * sin(uTime * 9.0 + p.z)));
        glow += panel * 0.35;
      } else {
        col = wallpaper(p);
      }
      float ent = entitySilhouette(p, phA, seen, turned);
      col = mix(col, vec3(0.02, 0.015, 0.01), ent);
      break;
    }
    t += d * 0.85;
    if (t > 24.0) break;
  }
  col += uAccent * glow * 0.18;
  col *= 1.0 + flee * 0.08 * sin(uTime * 42.0 + rd.x * 20.0);
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  float phA = fract(uTime * 0.040);
  float seen = ss(0.11, 0.145, phA);
  float turned = ss(0.16, 0.22, phA);
  float flee = max(bandPh(phA, 0.16, 0.88), turned);

  float lookUp = holdPh(phA, 0.04, 0.10) * (1.0 - seen);
  float pitch = mix(0.0, -0.62, lookUp);
  float yaw = mix(0.0, 3.14159, turned);
  float speed = mix(1.0, 3.2, flee);
  float camZ = uTime * speed * 0.85;
  vec3 ro = vec3(sin(uTime * 0.17) * 0.04, mix(-0.05, 0.08, lookUp), camZ);
  vec3 rd = rotY(yaw) * rotX(pitch) * dir;

  vec3 col = march(ro, rd, phA, seen, turned, flee);
  float fog = 1.0 - exp(-0.08 * max(0.0, dir.z + 0.15));
  col = mix(col, uBg, fog * 0.35);
  col = mix(col, uAccent * 0.35, seen * 0.12);
  col *= uBright;
  fragColor = vec4(col, uOpacity);
}
