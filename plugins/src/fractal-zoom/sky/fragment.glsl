vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

float fzAt(float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

float fz0(float fi) {
  return fzAt(fi);
}

vec2 orbitAt(float i) {
  float f = 64.0 + i * 2.0;
  return vec2(fzAt(f), fzAt(f + 1.0));
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
  for (int i = 0; i < 32; i++) {
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
  for (int i = 0; i < 32; i++) {
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
  for (int i = 0; i < 32; i++) {
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
  float cyc = tpal + pcyc * uTime * 0.22;
  return palette(cyc + trap * 0.15 * trapOn, fz0(20.0), hue, sat);
}

vec3 mandel2d(vec2 z0, vec2 c, int maxIter) {
  vec2 z = z0;
  float trap = 1e9;
  float m = 0.0;
  float escaped = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= maxIter) break;
    float mag = dot(z, z);
    trap = min(trap, mag);
    if (mag > 64.0) {
      m = float(i) + 1.0 - log2(log2(max(mag, 1.0001)));
      escaped = 1.0;
      break;
    }
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
  }
  return vec3(m, trap, escaped);
}

vec3 shadePerturb(vec2 uv, float julia, float scale, float iterCap, float spin, float hue, float sat) {
  float len = fz0(48.0);
  vec2 dc = uv * scale;
  vec2 dn = julia > 0.5 ? dc : vec2(0.0);
  float m = 0.0;
  float trap = 1e9;
  float escaped = 0.0;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= len) break;
    vec2 Z = orbitAt(float(i));
    vec2 z = Z + dn;
    float mag = dot(z, z);
    trap = min(trap, mag);
    if (mag > 64.0 && i > 0) {
      m = float(i) + 1.0 - log2(log2(max(mag, 1.0001)));
      escaped = 1.0;
      break;
    }
    dn = 2.0 * cmul(Z, dn) + cmul(dn, dn);
    if (julia < 0.5) dn += dc;
  }
  if (escaped < 0.5) return palette(spin + log(trap + 1.0) * 0.22, fz0(20.0), hue, sat) * 0.62;
  float esc = m / max(8.0, iterCap);
  return palette(spin + esc * 2.5, fz0(20.0), hue, sat) * (0.35 + esc * 1.4);
}

vec3 color2d(vec2 uv, float typ, vec2 center, float scale, float maxIterN, float tpal, float pcyc, float hue, float sat, vec4 jc) {
  float spin = tpal + pcyc * uTime * 0.22;
  float iterCap = max(8.0, maxIterN * 96.0);
  if (fz0(48.0) > 8.0 && scale < 0.02) {
    return shadePerturb(uv, typ < 6.5 ? 0.0 : 1.0, scale, iterCap, spin, hue, sat);
  }
  vec2 pix = center + uv * scale;
  vec3 m = typ < 6.5
    ? mandel2d(vec2(0.0), pix, int(iterCap))
    : mandel2d(pix, vec2(jc.x, jc.y), int(iterCap));
  if (m.z < 0.5) return palette(spin + log(m.y + 1.0) * 0.22, fz0(20.0), hue, sat) * 0.62;
  float esc = m.x / iterCap;
  return palette(spin + esc * 2.5, fz0(20.0), hue, sat) * (0.35 + esc * 1.4);
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

  vec3 rdView = normalize(vDir);
  float rollA = mark > 0.5 ? fz0(6.0) : 0.0;
  float cr = cos(rollA);
  float sr = sin(rollA);
  rdView = normalize(vec3(rdView.x * cr + rdView.y * sr, rdView.y * cr - rdView.x * sr, rdView.z));
  vec2 uv = rdView.xy / max(-rdView.z, 0.18);
  float zlog = mark > 0.5 ? fz0(7.0) : abs(fract(uTime * 0.028) * 2.0 - 1.0) * 8.6;
  float dive = max(0.0, zlog + 0.35);
  float zsc = exp(min(dive, 28.0) * 0.78);
  vec3 focusSlot = vec3(fz0(44.0), fz0(45.0), fz0(46.0));
  vec3 focus = mark > 0.5 && dot(focusSlot, focusSlot) > 1e-4 ? focusSlot : vec3(0.42, 0.58, 0.18);
  vec3 cam = mark > 0.5
    ? vec3(fz0(0.0), fz0(1.0), fz0(2.0))
    : vec3(0.15 * sin(uTime * 0.06), 0.22, 2.4);
  vec3 fwd = normalize(focus - cam);
  vec3 upW = abs(fwd.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  vec3 rt = normalize(cross(fwd, upW));
  upW = normalize(cross(rt, fwd));
  float nearD = mark > 0.5 ? fz0(47.0) : 0.0;
  float stand = nearD > 1e-4
    ? nearD
    : mix(max(length(focus - cam), 0.35), 0.045, clamp(1.0 - 1.0 / zsc, 0.0, 1.0));
  vec3 ro = focus - fwd * stand;
  vec3 rd = normalize(fwd + (rt * uv.x + upW * uv.y) * (0.95 / zsc));
  powr = mark > 0.5 ? powr : 8.0;
  maxIterN = mark > 0.5 ? maxIterN : 0.45;
  maxStepsN = mark > 0.5 ? maxStepsN : 0.5;
  eps = mark > 0.5 ? eps : 0.0015;
  tpal = mark > 0.5 ? tpal : 0.0;
  pcyc = mark > 0.5 ? pcyc : 0.35;
  hue = mark > 0.5 ? hue : 0.0;
  sat = mark > 0.5 ? sat : 1.1;
  bg = mark > 0.5 ? bg : vec3(0.03, 0.05, 0.12);

  if (mark < 0.5 || typ >= 6.0) {
    float win;
    vec2 center;
    float iterN;
    float useTyp;
    if (mark < 0.5) {
      float zWave = abs(fract(uTime * 0.04) * 2.0 - 1.0);
      win = 2.15 * exp(-zWave * 10.0);
      center = vec2(-0.743643887, 0.131825904);
      iterN = 0.85;
      useTyp = 6.0;
    } else {
      win = max(1e-8, mandelS);
      center = mandelC;
      iterN = max(0.35, maxIterN);
      useTyp = typ;
    }
    vec3 col = color2d(uv, useTyp, center, win, iterN, tpal, pcyc, hue, max(sat, 0.85), jc);
    col = mix(bg, col, 0.94) + glow * 0.2;
    fragColor = vec4(col * uBright, uOpacity);
    return;
  }

  int steps = int(min(48.0, max(12.0, maxStepsN * 48.0)));
  float t = 0.0;
  vec3 col = bg;
  float hit = 0.0;
  float closest = 1e9;
  float eHit = max(1e-6, eps * max(stand, 0.02) / max(zsc, 1.0));
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = mapDE(p, typ, powr, sc, fold, jc, sym);
    closest = min(closest, d);
    if (d < eHit) {
      hit = 1.0;
      vec3 n = normalize(vec3(
        mapDE(p + vec3(eHit, 0.0, 0.0), typ, powr, sc, fold, jc, sym) - mapDE(p, typ, powr, sc, fold, jc, sym),
        mapDE(p + vec3(0.0, eHit, 0.0), typ, powr, sc, fold, jc, sym) - mapDE(p, typ, powr, sc, fold, jc, sym),
        mapDE(p + vec3(0.0, 0.0, eHit), typ, powr, sc, fold, jc, sym) - mapDE(p, typ, powr, sc, fold, jc, sym)
      ));
      vec3 lp = ro + vec3(2.0, 3.0, -2.0);
      vec3 l = normalize(lp - p);
      float diff = max(dot(n, l), 0.0);
      float ao = 1.0 - aoAmt * 0.35;
      float sh = 1.0;
      if (shAmt > 0.01) {
        float sd = 0.01;
        for (int s = 0; s < 2; s++) {
          float h = mapDE(p + l * sd, typ, powr, sc, fold, jc, sym);
          sh = min(sh, 10.0 * h / sd);
          sd += 0.12;
        }
        sh = mix(1.0, clamp(sh, 0.0, 1.0), shAmt);
      }
      col = mapCol(p, typ, trapOn, tpal, pcyc, hue, sat) * (0.38 + diff * sh * ao);
      col += glow * pow(max(dot(reflect(-l, n), -rd), 0.0), 6.0) * vec3(0.6, 0.75, 1.0);
      break;
    }
    t += d;
    if (t > 18.0) break;
  }
  float mist = exp(-t * 0.22) * (0.45 + glow * 0.55);
  float aura = exp(-clamp(closest, 0.0, 4.0) * 5.5) * (0.55 + glow);
  col = mix(bg, col, hit);
  col += mapCol(ro + rd * min(t, 6.0), typ, trapOn, tpal, pcyc, hue, sat) * (mist * (1.0 - hit) + aura);
  col = mix(col, bg, fogAmt * clamp(t / 14.0, 0.0, 1.0));
  if (dof > 0.5) col = mix(col, bg, 0.08);
  col += uAudio * fz0(35.0) * 0.12;
  float pClamp = mark > 0.5 ? fz0(43.0) : 0.0;
  if (pClamp > 0.5) {
    vec2 hud = gl_FragCoord.xy / vec2(1280.0, 800.0);
    float band = smoothstep(0.02, 0.0, abs(hud.y - 0.08));
    col = mix(col, vec3(1.0, 0.85, 0.35), band * 0.85);
    col += vec3(0.15, 0.12, 0.05) * band;
  }
  fragColor = vec4(col * uBright, uOpacity);
}
