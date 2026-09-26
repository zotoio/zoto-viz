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

float box2(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float digitSeg(vec2 uv, int seg) {
  vec2 p = uv;
  if (seg == 0) return box2(p - vec2(0.0, 0.22), vec2(0.14, 0.04));
  if (seg == 1) return box2(p - vec2(0.0, 0.0), vec2(0.14, 0.04));
  if (seg == 2) return box2(p - vec2(0.0, -0.22), vec2(0.14, 0.04));
  if (seg == 3) return box2(p - vec2(-0.11, 0.11), vec2(0.04, 0.11));
  if (seg == 4) return box2(p - vec2(0.11, 0.11), vec2(0.04, 0.11));
  if (seg == 5) return box2(p - vec2(-0.11, -0.11), vec2(0.04, 0.11));
  if (seg == 6) return box2(p - vec2(0.11, -0.11), vec2(0.04, 0.11));
  return 1.0;
}

float drawDigit(vec2 uv, int d) {
  float m = 1.0;
  if (d == 0) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 2)); m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 6)); m = min(m, digitSeg(uv, 5)); }
  else if (d == 1) { m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 6)); }
  else if (d == 2) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 5)); m = min(m, digitSeg(uv, 2)); }
  else if (d == 3) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 6)); m = min(m, digitSeg(uv, 2)); }
  else if (d == 4) { m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 6)); }
  else if (d == 5) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 6)); m = min(m, digitSeg(uv, 2)); }
  else if (d == 6) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 5)); m = min(m, digitSeg(uv, 2)); m = min(m, digitSeg(uv, 6)); }
  else if (d == 7) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 6)); }
  else if (d == 8) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 2)); m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 5)); m = min(m, digitSeg(uv, 6)); }
  else if (d == 9) { m = min(m, digitSeg(uv, 0)); m = min(m, digitSeg(uv, 1)); m = min(m, digitSeg(uv, 2)); m = min(m, digitSeg(uv, 3)); m = min(m, digitSeg(uv, 4)); m = min(m, digitSeg(uv, 6)); }
  return 1.0 - smoothstep(0.0, 0.035, m);
}

float drawInt(vec2 uv, float val, float scale) {
  int n = int(clamp(val, 0.0, 99.0));
  int tens = n / 10;
  int ones = n - tens * 10;
  vec2 u0 = (uv - vec2(-0.18 * scale, 0.0)) / scale;
  vec2 u1 = (uv - vec2(0.18 * scale, 0.0)) / scale;
  float a = tens > 0 ? drawDigit(u0, tens) : 0.0;
  float b = drawDigit(u1, ones);
  return max(a, b);
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
  d = smin(d, sdSphere(bp, 1.18 * ballS), 0.15);
  for (int i = 0; i < 6; i++) {
    if (float(i) < carN) {
      float base = 6.0 + float(i) * 9.0;
      vec3 c = p - vec3(sl(1, base), sl(1, base + 1.0) + 0.35, sl(1, base + 2.0));
      if (mark < 0.5) c = p - vec3(float(i - 2) * 4.5, 0.35, float(i % 2) * 5.0 - 2.5);
      else c = rotY(sl(1, base + 3.0)) * c;
      float team = sl(1, base + 7.0);
      vec3 carCol = team > 0.5 ? vec3(0.35, 0.65, 1.0) : vec3(1.0, 0.55, 0.22);
      d = smin(d, sdBox(c, vec3(1.08, 0.38, 1.95)), 0.12);
    }
  }
  return d;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 zotoFail = vec3(0.937, 0.325, 0.314);
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
      float failAHit = sl(0, 28.0);
      if (failAHit > 0.05 && abs(p.y) > 2.0) {
        hit = mix(hit, zotoFail, clamp(failAHit, 0.0, 1.0) * 0.55);
      }
      col = mix(col, hit, 0.92);
      break;
    }
    t += h * 0.9;
    if (t > 60.0) break;
  }

  col += uAccent * 0.06 * (0.6 + 0.4 * sin(uTime * 2.0 + dir.x * 5.0));

  float mark = sl(0, 0.0);
  float failA = sl(0, 28.0);
  float demoF = sl(0, 29.0);
  float gFlash = sl(0, 13.0);
  float scoreO = sl(0, 9.0);
  float scoreB = sl(0, 10.0);
  float clockS = sl(0, 8.0);
  float rm = sl(0, 26.0);

  vec2 hud = vDir.xy;
  float bar = box2(hud - vec2(0.0, 0.78), vec2(0.42, 0.11));
  float barFill = 1.0 - smoothstep(0.0, 0.02, bar);
  vec3 barCol = vec3(0.04, 0.06, 0.1);
  if (failA > 0.2) barCol = mix(barCol, zotoFail, clamp(failA, 0.0, 1.0));
  col = mix(col, barCol, barFill * 0.92);

  float digScale = 0.55;
  vec2 scoreUvO = hud - vec2(-0.22, 0.78);
  vec2 scoreUvB = hud - vec2(0.22, 0.78);
  float dO = drawInt(scoreUvO, scoreO, digScale);
  float dB = drawInt(scoreUvB, scoreB, digScale);
  col = mix(col, vec3(1.0, 0.55, 0.2), dO * 0.95);
  col = mix(col, vec3(0.35, 0.7, 1.0), dB * 0.95);

  float clk = drawInt(hud - vec2(0.0, 0.62), floor(clockS), 0.45);
  col = mix(col, vec3(0.92), clk * 0.85);

  if (demoF > 0.5) {
    float demoBox = box2(hud - vec2(-0.34, 0.62), vec2(0.09, 0.035));
    float demoOn = 1.0 - smoothstep(0.0, 0.018, demoBox);
    col = mix(col, vec3(0.75, 0.85, 1.0), demoOn * 0.9);
  }

  if (failA > 0.05) {
    float failStrip = box2(hud - vec2(0.0, -0.72), vec2(0.5, 0.045));
    col = mix(col, zotoFail, (1.0 - smoothstep(0.0, 0.02, failStrip)) * clamp(failA, 0.0, 1.0));
  } else if (gFlash > 0.01 && mark > 0.5) {
    float pulse = rm > 0.5 ? 1.0 : (0.65 + 0.35 * sin(uTime * 1.4));
    col += uAccent * gFlash * pulse * 0.28;
  }

  float chip = box2(hud - vec2(-0.38, -0.55), vec2(0.14, 0.16));
  float chipOn = 1.0 - smoothstep(0.0, 0.022, chip);
  col = mix(col, vec3(0.05, 0.07, 0.12), chipOn * 0.88);
  float leg1 = box2(hud - vec2(-0.42, -0.48), vec2(0.11, 0.018));
  float leg2 = box2(hud - vec2(-0.42, -0.52), vec2(0.11, 0.018));
  float leg3 = box2(hud - vec2(-0.42, -0.56), vec2(0.11, 0.018));
  col = mix(col, vec3(0.85, 0.55, 0.25), (1.0 - smoothstep(0.0, 0.012, leg1)) * chipOn * 0.9);
  col = mix(col, vec3(0.75, 0.85, 1.0), (1.0 - smoothstep(0.0, 0.012, leg2)) * chipOn * 0.85);
  col = mix(col, zotoFail, (1.0 - smoothstep(0.0, 0.012, leg3)) * chipOn * 0.75);

  col *= uBright;
  col = max(col, mix(bot, top, 0.35) * 0.55);
  fragColor = vec4(col, uOpacity);
}
