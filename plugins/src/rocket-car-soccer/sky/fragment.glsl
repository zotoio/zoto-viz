// Rocket Car Soccer — readable stylised arena (raymarch + guaranteed sky/floor base).

float sl(int s, float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[s * 16 + int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float scene(vec3 p) {
  float mark = sl(0, 0.0);
  float carN = mark > 0.5 ? sl(0, 27.0) : 4.0;
  float ballS = max(0.75, sl(0, 23.0));
  vec3 q = p;
  q.y -= 0.8;
  float floor = q.y + 0.018 * dot(q.xz, q.xz);
  float shell = sdBox(q, vec3(23.0, 7.5, 13.5));
  float inner = sdBox(q, vec3(21.5, 7.0, 12.5));
  float d = smin(floor, max(shell, -inner), 0.55);
  vec3 bp = p - vec3(sl(1, 0.0), sl(1, 1.0), sl(1, 2.0));
  if (mark < 0.5) bp = vec3(0.0, 1.1, 0.0);
  d = smin(d, sdSphere(bp, 1.05 * ballS), 0.15);
  for (int i = 0; i < 6; i++) {
    if (float(i) < carN) {
      float base = 6.0 + float(i) * 9.0;
      vec3 c = p - vec3(sl(1, base), sl(1, base + 1.0) + 0.35, sl(1, base + 2.0));
      if (mark < 0.5) c = p - vec3(float(i - 2) * 4.5, 0.35, float(i % 2) * 5.0 - 2.5);
      else c = rotY(sl(1, base + 3.0)) * c;
      d = smin(d, sdBox(c, vec3(1.0, 0.35, 1.85)), 0.12);
    }
  }
  return d;
}

void main() {
  vec3 dir = normalize(vDir);
  float theme = sl(0, 15.0);
  vec3 top = theme > 1.5 ? vec3(0.12, 0.04, 0.22) : (theme > 0.5 ? vec3(0.07, 0.1, 0.2) : vec3(0.45, 0.65, 0.92));
  vec3 bot = mix(uBg, uAccent, 0.45);
  vec3 col = mix(bot, top, smoothstep(-0.15, 0.7, dir.y));

  vec3 ro = vec3(sl(0, 1.0), sl(0, 2.0), sl(0, 3.0));
  float yaw = sl(0, 4.0);
  float pitch = sl(0, 5.0);
  if (sl(0, 0.0) < 0.5) {
    ro = vec3(0.0, 11.0, 26.0);
    yaw = uTime * 0.05;
    pitch = -0.32;
  }
  vec3 fwd = vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(dir.x * right + dir.y * up + dir.z * fwd);

  float t = 0.2;
  for (int i = 0; i < 64; i++) {
    float h = scene(ro + rd * t);
    if (h < 0.002) {
      vec3 p = ro + rd * t;
      vec3 n = normalize(vec3(
        scene(p + vec3(0.002, 0.0, 0.0)) - scene(p - vec3(0.002, 0.0, 0.0)),
        scene(p + vec3(0.0, 0.002, 0.0)) - scene(p - vec3(0.0, 0.002, 0.0)),
        scene(p + vec3(0.0, 0.0, 0.002)) - scene(p - vec3(0.0, 0.0, 0.002))
      ));
      vec3 turf = mix(vec3(0.12, 0.38, 0.2), vec3(0.08, 0.14, 0.26), step(0.5, theme));
      vec3 hit = mix(turf, uAccent, 0.25) * (0.35 + 0.65 * clamp(dot(n, normalize(vec3(0.3, 0.95, 0.2))), 0.0, 1.0));
      col = mix(col, hit, 0.92);
      break;
    }
    t += h * 0.9;
    if (t > 60.0) break;
  }

  col += uAccent * 0.06 * (0.6 + 0.4 * sin(uTime * 2.0 + dir.x * 5.0));
  col *= uBright;
  col = max(col, mix(bot, top, 0.35) * 0.55);
  fragColor = vec4(col, uOpacity);
}
