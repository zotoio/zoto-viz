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

// Planar view rotation: loop jumps rotate by arg(lambda) so the frame after a jump matches the one before.
vec2 viewRotate(vec2 q) {
  float a = fz0(52.0);
  float c = cos(a);
  float s = sin(a);
  return vec2(q.x * c - q.y * s, q.x * s + q.y * c);
}

// Colour coordinate, linear in escape count so a loop jump (which lowers every count by the cycle
// period) is cancelled exactly by the accumulated shift in slot 53. FZ_BAND_K in fractal-slot.ts.
const float FZ_BAND_K = 0.07;
// Most a ray that misses the surface can be lit by mist and the near-miss aura.
const float FZ_GLOW_CAP = 0.55;
float bandOf(float n) {
  return (n + fz0(53.0)) * FZ_BAND_K;
}

vec2 orbitAt(float i) {
  float f = 64.0 + i * 2.0;
  return vec2(fzAt(f), fzAt(f + 1.0));
}

// Gradient palettes: classic, topo, ember, ice, mono (5 stops each); 5 = neon cosine rainbow.
// Must match plugins/sdk/fractal-palette.ts.
const vec3 PAL_STOPS[25] = vec3[25](
  vec3(0.0, 0.03, 0.12), vec3(0.05, 0.25, 0.75), vec3(0.92, 0.96, 1.0), vec3(1.0, 0.75, 0.2), vec3(0.65, 0.25, 0.02),
  vec3(0.03, 0.12, 0.3), vec3(0.2, 0.45, 0.65), vec3(0.82, 0.74, 0.52), vec3(0.45, 0.32, 0.22), vec3(0.95, 0.96, 1.0),
  vec3(0.02, 0.0, 0.0), vec3(0.45, 0.02, 0.04), vec3(0.85, 0.18, 0.03), vec3(1.0, 0.55, 0.1), vec3(1.0, 0.9, 0.6),
  vec3(0.01, 0.02, 0.06), vec3(0.1, 0.2, 0.38), vec3(0.3, 0.55, 0.75), vec3(0.55, 0.88, 0.95), vec3(0.95, 0.98, 1.0),
  vec3(0.03, 0.03, 0.04), vec3(0.2, 0.2, 0.22), vec3(0.45, 0.45, 0.48), vec3(0.72, 0.72, 0.75), vec3(0.92, 0.92, 0.94)
);

// Mirrored gradient (period 2 in t, no seam), then hue rotation about the grey axis and saturation.
vec3 palette(float t, float pal, float hue, float sat) {
  int p = int(clamp(floor(pal + 0.5), 0.0, 5.0));
  vec3 col;
  if (p == 5) {
    col = 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  } else {
    float u = abs(fract(t * 0.5) * 2.0 - 1.0) * 4.0;
    int i = int(min(floor(u), 3.0));
    float f = u - float(i);
    f = f * f * (3.0 - 2.0 * f);
    col = mix(PAL_STOPS[p * 5 + i], PAL_STOPS[p * 5 + i + 1], f);
    if (p == 4) col *= mix(vec3(1.0), uAccent * 1.4, 0.25);
  }
  float h = hue * 6.28318;
  vec3 k = vec3(0.57735);
  col = col * cos(h) + cross(k, col) * sin(h) + k * dot(k, col) * (1.0 - cos(h));
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, sat);
  return clamp(col, 0.0, 1.5);
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

// Box fold limit is 0.5 + fold (default 1.05, the classic Mandelbox is 1.0). dr tracks the running scale.
// Scales between -1 and 1 collapse the set; keep |s| >= 1.2.
float boxScale(float s) {
  return s < 0.0 ? min(s, -1.2) : max(s, 1.2);
}

// Positive s: half-extent 2(s+1)/(s-1). Negative s: solid core whose towers reach ~3.65 at the corners.
// Shrink either to ~1.15 so the canyon basin (radius 1.35) flies the outer surface. Matches boxK in fractal-cruise.ts.
float boxK(float s) {
  return (s < 0.0 ? 3.65 : 2.0 * (s + 1.0) / (s - 1.0)) / 1.15;
}

float mandelboxUnit(vec3 p, float s, float f) {
  vec3 z = p;
  float dr = 1.0;
  float lim = 0.5 + f;
  for (int i = 0; i < 16; i++) {
    z = clamp(z, -lim, lim) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) {
      z *= 4.0;
      dr *= 4.0;
    } else if (r2 < 1.0) {
      z /= r2;
      dr /= r2;
    }
    z = z * s + p;
    dr = dr * abs(s) + 1.0;
    if (dot(z, z) > 1e4) break;
  }
  return length(z) / abs(dr);
}

float mandelbox(vec3 p, float s, float f) {
  float sc = boxScale(s);
  float k = boxK(sc);
  return mandelboxUnit(p * k, sc, f) / k;
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

// Sierpinski tetrahedron IFS (vertices (1,1,1) and its three sign flips): fold, scale 2 about a vertex.
float sierpinski(vec3 p) {
  vec3 z = p;
  for (int i = 0; i < 12; i++) {
    if (z.x + z.y < 0.0) z.xy = -z.yx;
    if (z.x + z.z < 0.0) z.xz = -z.zx;
    if (z.y + z.z < 0.0) z.yz = -z.zy;
    z = z * 2.0 - 1.0;
  }
  return length(z) * exp2(-12.0);
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

// Kaleidoscopic IFS: mirror into one of `sym` polar sectors, then octahedral folds and scale 3 about
// the (1,1,0) vertex — 12 copies at 1/3, a cuboctahedral fractal (dimension ~2.26, not space-filling).
float kaleido(vec3 p, float sym) {
  float sector = 6.28318 / max(sym, 3.0);
  float a = abs(mod(atan(p.y, p.x), sector) - sector * 0.5);
  p.xy = vec2(cos(a), sin(a)) * length(p.xy);
  vec3 z = p;
  for (int i = 0; i < 8; i++) {
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;
    z = z * 3.0 - vec3(2.0, 2.0, 0.0);
  }
  return length(z) * pow(3.0, -8.0);
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

vec3 shadePerturb(vec2 uv, float julia, float scale, float spin, float hue, float sat) {
  float len = fz0(48.0);
  vec2 dc = (uv - vec2(fz0(50.0), fz0(51.0))) * scale;
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
  return palette(spin + bandOf(m), fz0(20.0), hue, sat) * (0.45 + 0.9 * (1.0 - exp(-m * 0.03)));
}

vec3 color2d(vec2 uv, float typ, vec2 center, float scale, float maxIterN, float tpal, float pcyc, float hue, float sat, vec4 jc) {
  float spin = tpal + pcyc * uTime * 0.22;
  float iterCap = max(8.0, maxIterN * 96.0);
  if (fz0(48.0) > 8.0 && scale < 0.02) {
    return shadePerturb(uv, typ < 6.5 ? 0.0 : 1.0, scale, spin, hue, sat);
  }
  vec2 pix = center + uv * scale;
  vec3 m = typ < 6.5
    ? mandel2d(vec2(0.0), pix, int(iterCap))
    : mandel2d(pix, vec2(jc.x, jc.y), int(iterCap));
  if (m.z < 0.5) return palette(spin + log(m.y + 1.0) * 0.22, fz0(20.0), hue, sat) * 0.62;
  return palette(spin + bandOf(m.x), fz0(20.0), hue, sat) * (0.45 + 0.9 * (1.0 - exp(-m.x * 0.03)));
}

// Mandelbrot terrain: the plane is window-relative (q = (c - centre) / scale), so the landscape
// rescales with the dive. Height falls off with the distance estimate in window units; the
// interior is a flat mesa at TERRAIN_H and filaments rise as ridges.
const float TERRAIN_H = 0.34;

// x: smooth escape count, y: distance to the set in window units (-1 inside), z: orbit trap.
vec3 msetIterate(vec2 q, vec2 center, float scale, float cap, float useP) {
  float trap = 1e9;
  if (useP > 0.5) {
    float len = min(fz0(48.0), max(cap, 24.0));
    vec2 dc = (q - vec2(fz0(50.0), fz0(51.0))) * scale;
    vec2 dn = vec2(0.0);
    vec2 der = vec2(0.0);
    for (int i = 0; i < 160; i++) {
      if (float(i) >= len) break;
      vec2 Z = orbitAt(float(i));
      vec2 z = Z + dn;
      float m2 = dot(z, z);
      trap = min(trap, m2);
      if (m2 > 64.0 && i > 0) {
        float r = sqrt(m2);
        float de = 0.5 * r * log(r) / max(length(der), 1e-30);
        return vec3(float(i) + 1.0 - log2(log2(m2)), de / scale, trap);
      }
      der = 2.0 * cmul(z, der) + vec2(1.0, 0.0);
      dn = 2.0 * cmul(Z, dn) + cmul(dn, dn) + dc;
    }
    return vec3(len, -1.0, trap);
  }
  vec2 c = center + q * scale;
  vec2 z = vec2(0.0);
  vec2 der = vec2(0.0);
  int n = int(cap);
  for (int i = 0; i < 96; i++) {
    if (i >= n) break;
    der = 2.0 * cmul(z, der) + vec2(1.0, 0.0);
    z = cmul(z, z) + c;
    float m2 = dot(z, z);
    trap = min(trap, m2);
    if (m2 > 1024.0) {
      float r = sqrt(m2);
      float de = 0.5 * r * log(r) / max(length(der), 1e-30);
      return vec3(float(i) + 2.0 - log2(log2(m2)), de / scale, trap);
    }
  }
  return vec3(cap, -1.0, trap);
}

// As msetIterate, but `lod` < `cap` trims far samples. Running out of `lod` is not proof of the
// interior, so those points read as boundary (y = 0) rather than turning distant ground into mesa.
vec3 msetSample(vec2 q, vec2 center, float scale, float cap, float lod, float useP) {
  vec3 s = msetIterate(q, center, scale, min(cap, lod), useP);
  if (s.y < 0.0 && lod < cap) s.y = 0.0;
  return s;
}

// Exponential falloff in window units keeps ridges thin and valleys deep at every zoom; the sharp
// second term peaks the filaments themselves.
float terrainHeight(vec3 s) {
  if (s.y < 0.0) return TERRAIN_H;
  return TERRAIN_H * (0.7 * exp(-14.0 * s.y) + 0.3 * exp(-70.0 * s.y));
}


// World (x, z) to window plane; imaginary axis points away from the opening camera.
vec2 terrainQ(vec3 p) {
  return viewRotate(vec2(p.x, -p.z));
}

vec3 terrainSky(vec3 rd, vec3 bg, float spin, float pal, float hue, float sat, float glow) {
  float up = clamp(rd.y, -0.2, 1.0);
  vec3 horizon = mix(bg, palette(spin + 0.15, pal, hue, sat) * 0.35, 0.35 + glow * 0.3);
  return mix(horizon, bg * 0.6, smoothstep(0.0, 0.55, up));
}

vec3 terrainScene(vec3 rdView, vec3 bg, float tpal, float pcyc, float hue, float sat, float glow, float fogAmt, float aoAmt, float maxStepsN) {
  vec2 center = vec2(fz0(38.0), fz0(39.0));
  float scale = max(1e-30, fz0(40.0));
  float useP = (fz0(48.0) > 8.0 && scale < 0.02) ? 1.0 : 0.0;
  // Perturbation runs to the reference orbit length (up to 160), past the 96-iteration direct loop.
  float cap = useP > 0.5 ? fz0(48.0) : max(16.0, fz0(12.0) * 96.0);
  float pal = fz0(20.0);
  float spin = tpal + pcyc * uTime * 0.22;

  vec3 ro = vec3(fz0(0.0), fz0(1.0), fz0(2.0));
  vec3 fwd = normalize(vec3(fz0(44.0), fz0(45.0), fz0(46.0)) - ro);
  vec3 rt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fwd);
  vec2 uv = rdView.xy / max(-rdView.z, 0.18);
  // Wider than the host lens (about 64 degrees across) so the opening shot holds the whole set.
  vec3 rd = normalize(fwd + (rt * uv.x + up * uv.y) * 1.2);

  vec3 sky = terrainSky(rd, bg, spin, pal, hue, sat, glow);
  if (rd.y > -1e-4 && ro.y >= TERRAIN_H) return sky;

  float t = ro.y > TERRAIN_H ? (ro.y - TERRAIN_H) / -rd.y : 0.0;
  float tGround = rd.y < -1e-4 ? ro.y / -rd.y : 1e9;
  float tEnd = min(tGround, 16.0);
  float tPrev = t;
  float hit = 0.0;
  int steps = int(min(48.0, max(12.0, maxStepsN * 48.0)));
  for (int i = 0; i < 48; i++) {
    if (i >= steps || t > tEnd) break;
    vec3 p = ro + rd * t;
    // Far samples need fewer iterations; they are a few pixels wide and fogged.
    float lod = max(32.0, cap * clamp(4.5 / max(t, 0.1), 0.6, 1.0));
    float gap = p.y - terrainHeight(msetSample(terrainQ(p), center, scale, cap, lod, useP));
    if (gap < 0.0) {
      hit = 1.0;
      break;
    }
    tPrev = t;
    t += max(gap * 0.5, 0.004 + t * 0.014);
  }
  if (hit < 0.5) {
    if (tGround > 16.0) return sky;
    t = min(t, tGround);
    hit = 1.0;
  } else {
    float a = tPrev;
    float b = t;
    for (int k = 0; k < 5; k++) {
      float m = 0.5 * (a + b);
      vec3 pm = ro + rd * m;
      if (pm.y < terrainHeight(msetSample(terrainQ(pm), center, scale, cap, cap, useP))) b = m;
      else a = m;
    }
    t = b;
  }

  vec3 p = ro + rd * t;
  vec3 s0 = msetSample(terrainQ(p), center, scale, cap, cap, useP);
  float h0 = terrainHeight(s0);
  float e = max(0.0015, t * 0.003);
  float hx = terrainHeight(msetSample(terrainQ(p + vec3(e, 0.0, 0.0)), center, scale, cap, cap, useP));
  float hz = terrainHeight(msetSample(terrainQ(p + vec3(0.0, 0.0, e)), center, scale, cap, cap, useP));
  vec3 n = normalize(vec3(h0 - hx, e, h0 - hz));

  vec3 base;
  float rim = 0.0;
  if (s0.y < 0.0) {
    // The set: a dark mesa with a faint orbit-trap texture.
    base = vec3(0.025, 0.03, 0.045) + palette(spin + log(s0.z + 1.0) * 0.35, pal, hue, sat) * 0.1;
  } else {
    base = palette(spin + bandOf(s0.x), pal, hue, sat) * (0.55 + 0.6 * clamp(h0 / TERRAIN_H, 0.0, 1.0));
    rim = exp(-s0.y * 40.0);
  }
  vec3 l = normalize(vec3(-0.45, 0.8, 0.35));
  float diff = max(dot(n, l), 0.0);
  float valley = 0.35 + 0.65 * clamp(h0 / TERRAIN_H, 0.0, 1.0);
  float amb = mix(0.42, 0.42 * valley, aoAmt);
  float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 24.0) * (0.15 + glow * 0.5);
  vec3 col = base * (amb + diff * 0.9) + spec * vec3(0.8, 0.9, 1.0);
  // Glowing rim along the mesa edge, from the warm end of the gradient.
  col += palette(1.75, pal, hue, sat) * rim * (0.3 + glow * 0.9);
  // Far terrain is sampled coarser than a pixel and sparkles; fog it out before it reads as noise.
  float fog = 1.0 - exp(-t * (0.09 + fogAmt * 0.22));
  return mix(col, sky, clamp(fog, 0.0, 1.0));
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
  // 3D keeps a wide canyon. Dividing by zsc pinched the cone into a laser.
  float cone = (mark > 0.5 && typ < 6.0) ? 0.82 : (0.95 / zsc);
  vec3 rd = normalize(fwd + (rt * uv.x + upW * uv.y) * cone);
  powr = mark > 0.5 ? powr : 8.0;
  maxIterN = mark > 0.5 ? maxIterN : 0.45;
  maxStepsN = mark > 0.5 ? maxStepsN : 0.5;
  eps = mark > 0.5 ? eps : 0.0015;
  tpal = mark > 0.5 ? tpal : 0.0;
  pcyc = mark > 0.5 ? pcyc : 0.35;
  hue = mark > 0.5 ? hue : 0.0;
  sat = mark > 0.5 ? sat : 1.1;
  bg = mark > 0.5 ? bg : vec3(0.03, 0.05, 0.12);

  if (mark > 0.5 && typ > 7.5) {
    vec3 tc = terrainScene(rdView, bg, tpal, pcyc, hue, sat, glow, fogAmt, aoAmt, maxStepsN);
    tc += uAudio * fz0(35.0) * 0.12;
    fragColor = vec4(tc * uBright, uOpacity);
    return;
  }

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
    vec3 col = color2d(viewRotate(uv), useTyp, center, win, iterN, tpal, pcyc, hue, max(sat, 0.85), jc);
    col = mix(bg, col, 0.94) + glow * 0.2;
    fragColor = vec4(col * uBright, uOpacity);
    return;
  }

  int steps = int(min(48.0, max(12.0, maxStepsN * 48.0)));
  float t = 0.0;
  vec3 col = bg;
  float hit = 0.0;
  float closest = 1e9;
  float eHit = (mark > 0.5 && typ < 6.0)
    ? max(1.2e-4, eps * max(stand, 0.008) * 0.55)
    : max(1e-6, eps * max(stand, 0.02) / max(zsc, 1.0));
  for (int i = 0; i < 48; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = mapDE(p, typ, powr, sc, fold, jc, sym);
    closest = min(closest, d);
    if (d < eHit) {
      hit = 1.0;
      // A one-sided difference at the hit epsilon is below float resolution near the surface: the
      // gradient came back zero or NaN and the whole surface shaded black. Central differences at a
      // step that grows with distance, with a facing fallback when the field is flat.
      float ne = max(eHit * 4.0, 4e-4 + t * 1.5e-3);
      vec3 g = vec3(
        mapDE(p + vec3(ne, 0.0, 0.0), typ, powr, sc, fold, jc, sym) - mapDE(p - vec3(ne, 0.0, 0.0), typ, powr, sc, fold, jc, sym),
        mapDE(p + vec3(0.0, ne, 0.0), typ, powr, sc, fold, jc, sym) - mapDE(p - vec3(0.0, ne, 0.0), typ, powr, sc, fold, jc, sym),
        mapDE(p + vec3(0.0, 0.0, ne), typ, powr, sc, fold, jc, sym) - mapDE(p - vec3(0.0, 0.0, ne), typ, powr, sc, fold, jc, sym)
      );
      vec3 n = dot(g, g) > 1e-14 ? normalize(g) : -rd;
      vec3 lp = ro + vec3(2.0, 3.0, -2.0);
      vec3 l = normalize(lp - p);
      float diff = max(dot(n, l), 0.0);
      // Distance-field occlusion: how far the field falls short of the step along the normal, so crevices darken.
      float occ = 0.0;
      float w = 1.0;
      for (int k = 1; k <= 4; k++) {
        float h = 0.018 * float(k) * max(stand, 0.05) / 0.28;
        occ += w * max(0.0, h - mapDE(p + n * h, typ, powr, sc, fold, jc, sym)) / h;
        w *= 0.55;
      }
      float ao = clamp(1.0 - aoAmt * occ * 0.75, 0.05, 1.0);
      // March cost is a second crevice cue: rays that grazed many surfaces before hitting land in folds.
      float cost = float(i) / float(max(steps, 1));
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
      // A headlight along the view ray keeps faces turned from the key light readable instead of
      // the near-black 0.16 ambient they had, which hid the surface inside the dark fog.
      float head = 0.5 * max(dot(n, -rd), 0.0);
      col = mapCol(p, typ, trapOn, tpal, pcyc, hue, sat) * (0.22 + head + diff * sh) * ao * (1.0 - 0.45 * cost);
      col += glow * 0.6 * ao * pow(max(dot(reflect(-l, n), -rd), 0.0), 12.0) * vec3(0.6, 0.75, 1.0);
      break;
    }
    t += d;
    if (t > 18.0) break;
  }
  float mist = exp(-t * 0.22) * (0.45 + glow * 0.55);
  float aura = exp(-clamp(closest, 0.0, 4.0) * 5.5) * (0.55 + glow);
  col = mix(bg, col, hit);
  // Mist and the near-miss aura light empty space only; on a hit they would wash the surface out.
  // Blend toward the glow colour instead of adding it: unbounded mist + aura summed past 1 and
  // washed every miss to a flat pale fog that buried the fractal (FZ_GLOW_CAP).
  float haze = min(FZ_GLOW_CAP, 1.0 - exp(-(mist + aura) * 0.8)) * (1.0 - hit);
  col = mix(col, mapCol(ro + rd * min(t, 6.0), typ, trapOn, tpal, pcyc, hue, sat), haze);
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
