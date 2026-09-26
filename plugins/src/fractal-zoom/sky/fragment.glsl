float fz0(float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

vec3 palette(float t, float pal, float hue, float sat) {
  vec3 col = vec3(0.12, 0.18, 0.42);
  if (pal > 0.5) col = mix(col, vec3(0.9, 0.25, 0.08), smoothstep(0.5, 1.5, pal));
  if (pal > 1.5) col = mix(col, vec3(0.95, 0.45, 0.12), smoothstep(1.5, 2.5, pal));
  if (pal > 2.5) col = mix(col, vec3(0.2, 0.95, 0.55), smoothstep(2.5, 3.5, pal));
  if (pal > 3.5) col = mix(col, vec3(0.95, 0.2, 0.75), smoothstep(3.5, 4.5, pal));
  if (pal > 4.5) col = mix(col, vec3(0.55, 0.85, 1.0), smoothstep(4.5, 5.5, pal));
  if (pal > 5.5) col = mix(col, vec3(1.0, 0.35, 0.15), smoothstep(5.5, 6.5, pal));
  if (pal > 6.5) col = mix(col, vec3(0.15, 0.75, 0.95), smoothstep(6.5, 7.5, pal));
  float h = hue * 6.28318;
  vec3 k = vec3(0.57735);
  col = mix(dot(col, k) * k, col, sat);
  return 0.5 + 0.5 * cos(6.28318 * (col + t + vec3(0.0, 0.33, 0.67) + h));
}

float mandelbulb(vec3 p, float power) {
  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  for (int i = 0; i < 96; i++) {
    r = length(z);
    if (r > 4.0) return 0.5 * log(r) * r / dr;
    float theta = acos(clamp(z.z / r, -1.0, 1.0));
    float phi = atan(z.y, z.x);
    float zr = pow(r, power - 1.0);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    theta *= power;
    phi *= power;
    z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta));
    z += p;
  }
  return 0.5 * log(r) * r / dr;
}

float mandelbox(vec3 p, float s, float f) {
  vec3 z = p;
  float scale = s;
  float fold = f;
  for (int i = 0; i < 64; i++) {
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) z *= 4.0;
    else if (r2 < 1.0) z /= r2;
    z = z * scale + p;
  }
  return (length(z) - 1.0) * fold;
}

float menger(vec3 p) {
  float d = abs(p.x);
  d = max(d, abs(p.y));
  d = max(d, abs(p.z)) - 1.0;
  float s = 1.0;
  for (int i = 0; i < 6; i++) {
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y);
    float db = max(r.y, r.z);
    float dc = max(r.z, r.x);
    float c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

float sierpinski(vec3 p) {
  float s = 1.0;
  float d = 1e9;
  for (int i = 0; i < 8; i++) {
    if (p.x + p.y < 0.0) p.xy = -p.yx;
    if (p.x + p.z < 0.0) p.xz = -p.zx;
    if (p.y + p.z < 0.0) p.yz = -p.zy;
    p = p * 2.0 - 1.0;
    s *= 2.0;
    d = min(d, (length(p) - 0.35) / s);
  }
  return d;
}

float julia4d(vec3 p, vec4 c) {
  vec4 z = vec4(p, 0.2);
  float dr = 1.0;
  float r = 0.0;
  for (int i = 0; i < 64; i++) {
    r = length(z);
    if (r > 4.0) break;
    dr = 2.0 * r * dr + 1.0;
    z = vec4(z.x * z.x - dot(z.yzw, z.yzw), 2.0 * z.x * z.yzw) + c;
  }
  return 0.5 * log(r) * r / dr;
}

float kaleido(vec3 p, float sym) {
  float a = atan(p.y, p.x);
  float r = length(p.xy);
  float sector = 6.28318 / max(sym, 3.0);
  a = mod(a, sector) - sector * 0.5;
  vec2 q = vec2(cos(a), sin(a)) * r;
  p.xy = q;
  p = abs(p) - vec3(0.35, 0.35, 0.2);
  return length(max(p, 0.0)) + min(max(p.x, max(p.y, p.z)), 0.0) - 0.08;
}

float mapDE(vec3 p, float typ, float powr, float sc, float fold, vec4 jc, float sym) {
  if (typ < 0.5) return mandelbulb(p, powr);
  if (typ < 1.5) return mandelbox(p, sc, fold);
  if (typ < 2.5) return menger(p);
  if (typ < 3.5) return sierpinski(p);
  if (typ < 4.5) return julia4d(p, jc);
  return kaleido(p, sym);
}

vec3 mapCol(vec3 p, float typ, float trapOn, float tpal, float pcyc, float hue, float sat) {
  float trap = length(p.xy) + abs(p.z) * 0.5;
  float cyc = tpal + pcyc * uTime * 0.05;
  return palette(cyc + trap * 0.15 * trapOn, fz0(20.0), hue, sat);
}

vec2 mandel2d(vec2 uv, vec2 c, int maxIter) {
  vec2 z = vec2(0.0);
  float m = 0.0;
  for (int i = 0; i < 128; i++) {
    if (i >= maxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float d = dot(z, z);
    if (d > 16.0) { m = float(i); break; }
  }
  return vec2(m, dot(z, z));
}

vec3 color2d(vec2 uv, float typ, vec2 center, float scale, float maxIterN, float tpal, float pcyc, float hue, float sat, vec4 jc) {
  vec2 c = center + uv * scale;
  vec2 m;
  if (typ < 6.5) {
    m = mandel2d(uv * scale + center, center, int(maxIterN * 160.0));
  } else {
    m = mandel2d(uv * scale, vec2(jc.x, jc.y), int(maxIterN * 160.0));
  }
  float esc = m.x / max(1.0, maxIterN * 160.0);
  return palette(tpal + pcyc * uTime * 0.05 + esc * 2.5, fz0(20.0), hue, sat) * (0.35 + esc * 1.4);
}

void main() {
  float mark = fz0(42.0);
  float typ = mark > 0.5 ? fz0(8.0) : 0.0;
  float maxIterN = fz0(12.0);
  float maxStepsN = fz0(13.0);
  float eps = fz0(14.0);
  float aoAmt = fz0(15.0);
  float shAmt = fz0(16.0);
  float glow = fz0(17.0);
  float fogAmt = fz0(18.0);
  float dof = fz0(19.0);
  float tpal = fz0(20.0);
  float pcyc = fz0(21.0);
  float trapOn = fz0(22.0);
  float hue = fz0(23.0);
  float sat = fz0(24.0);
  vec3 bg = vec3(fz0(25.0), fz0(26.0), fz0(27.0));
  vec4 jc = vec4(fz0(31.0), fz0(32.0), fz0(33.0), fz0(34.0));
  float sym = fz0(37.0);
  float powr = max(2.0, fz0(9.0));
  float sc = fz0(10.0);
  float fold = fz0(11.0);
  vec2 mandelC = vec2(fz0(38.0), fz0(39.0));
  float mandelS = fz0(40.0);

  vec3 rd = normalize(vDir);
  float rollA = mark > 0.5 ? fz0(6.0) : 0.0;
  float cr = cos(rollA);
  float sr = sin(rollA);
  rd = normalize(vec3(rd.x * cr + rd.y * sr, rd.y * cr - rd.x * sr, rd.z));
  vec3 ro = mark > 0.5
    ? vec3(fz0(0.0), fz0(1.0), fz0(2.0))
    : vec3(0.12 * sin(uTime * 0.11), 0.1 * cos(uTime * 0.09), -1.1 - fract(uTime * 0.05) * 0.35);
  ro += rd * fz0(7.0) * 0.15;
  powr = mark > 0.5 ? powr : 8.0;
  maxIterN = mark > 0.5 ? maxIterN : 0.45;
  maxStepsN = mark > 0.5 ? maxStepsN : 0.5;
  eps = mark > 0.5 ? eps : 0.0015;
  tpal = mark > 0.5 ? tpal : 0.0;
  pcyc = mark > 0.5 ? pcyc : 0.35;
  hue = mark > 0.5 ? hue : 0.0;
  sat = mark > 0.5 ? sat : 1.1;
  bg = mark > 0.5 ? bg : vec3(0.03, 0.05, 0.12);

  if (typ >= 6.0) {
    vec2 uv = rd.xy / max(0.35, 1.15 - abs(rd.z));
    vec3 col = color2d(uv, typ, mandelC, mandelS, maxIterN, tpal, pcyc, hue, sat, jc);
    col = mix(bg, col, 0.92) + glow * 0.25;
    fragColor = vec4(col * uBright, uOpacity);
    return;
  }

  int steps = int(min(128.0, max(24.0, maxStepsN * 128.0)));
  float t = 0.0;
  vec3 col = bg;
  float hit = 0.0;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = mapDE(p, typ, powr, sc, fold, jc, sym);
    if (d < eps) {
      hit = 1.0;
      vec3 n = normalize(vec3(
        mapDE(p + vec3(eps, 0.0, 0.0), typ, powr, sc, fold, jc, sym) - d,
        mapDE(p + vec3(0.0, eps, 0.0), typ, powr, sc, fold, jc, sym) - d,
        mapDE(p + vec3(0.0, 0.0, eps), typ, powr, sc, fold, jc, sym) - d
      ));
      vec3 lp = ro + vec3(2.0, 3.0, -2.0);
      vec3 l = normalize(lp - p);
      float diff = max(dot(n, l), 0.0);
      float ao = 1.0 - aoAmt * 0.35;
      float sh = 1.0;
      if (shAmt > 0.01) {
        float sd = 0.01;
        for (int s = 0; s < 8; s++) {
          float h = mapDE(p + l * sd, typ, powr, sc, fold, jc, sym);
          sh = min(sh, 10.0 * h / sd);
          sd += 0.12;
        }
        sh = mix(1.0, clamp(sh, 0.0, 1.0), shAmt);
      }
      col = mapCol(p, typ, trapOn, tpal, pcyc, hue, sat) * (0.25 + diff * sh * ao);
      col += glow * pow(max(dot(reflect(-l, n), -rd), 0.0), 6.0) * vec3(0.6, 0.75, 1.0);
      break;
    }
    t += d;
    if (t > 18.0) break;
  }
  float mist = exp(-t * 0.22) * (0.35 + glow * 0.5);
  col = mix(bg, col, hit);
  col += mapCol(ro + rd * min(t, 6.0), typ, trapOn, tpal, pcyc, hue, sat) * mist * (1.0 - hit);
  col = mix(col, bg, fogAmt * clamp(t / 14.0, 0.0, 1.0));
  if (dof > 0.5) col = mix(col, bg, 0.08);
  col += uAudio * fz0(35.0) * 0.12;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  if (lum < 0.14) {
    vec2 uv = vDir.xy / max(0.32, 1.1 - abs(vDir.z));
    col += color2d(uv, 6.0, vec2(-0.743643887, 0.131825904), 1.6, 0.55, 0.0, 0.4, hue, sat, jc) * 1.15;
  }
  float pClamp = mark > 0.5 ? fz0(43.0) : 0.0;
  if (pClamp > 0.5) {
    vec2 uv = gl_FragCoord.xy / vec2(1280.0, 800.0);
    float band = smoothstep(0.02, 0.0, abs(uv.y - 0.08));
    col = mix(col, vec3(1.0, 0.85, 0.35), band * 0.85);
    col += vec3(0.15, 0.12, 0.05) * band;
  }
  fragColor = vec4(col * uBright, uOpacity);
}
