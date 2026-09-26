float slotF(int s, float fi) {
  float i = floor(fi) + float(s * 64);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
}

float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.02 + vec3(1.7, 2.3, 0.4);
    a *= 0.5;
  }
  return v;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

vec3 fishColor(float sp, float vig) {
  float s = floor(sp * 6.0 + 0.01);
  vec3 c = mix(vec3(0.9, 0.2, 0.15), vec3(0.1, 0.55, 0.95), 0.35);
  if (s < 0.5) c = vec3(0.15, 0.85, 0.75);
  else if (s < 1.5) c = vec3(0.95, 0.85, 0.25);
  else if (s < 2.5) c = vec3(0.95, 0.35, 0.55);
  else if (s < 3.5) c = vec3(0.55, 0.55, 0.6);
  else if (s < 4.5) c = vec3(0.85, 0.25, 0.15);
  else c = vec3(0.75, 0.45, 0.15);
  return mix(c, c * 1.35, vig);
}

float mapFish(vec3 p, out vec3 col, out float glow) {
  float d = 1e3;
  col = vec3(0.0);
  glow = 0.0;
  int n = int(clamp(slotF(0, 17.0), 0.0, 16.0));
  for (int i = 0; i < 16; i++) {
    if (i >= n) break;
    float fi = float(i * 4);
    vec3 c = vec3(slotF(1, fi), slotF(1, fi + 1.0), slotF(1, fi + 2.0));
    float pack = slotF(1, fi + 3.0);
    float sp = fract(pack * 6.0);
    float vig = clamp(pack * 2.0, 0.0, 1.0);
    vec3 rad = vec3(0.14 + vig * 0.12, 0.06 + vig * 0.05, 0.22 + vig * 0.1);
    vec3 lp = p - c;
    float yaw = atan(lp.x, lp.z);
    float cy = cos(yaw);
    float sy = sin(yaw);
    lp = vec3(cy * lp.x + sy * lp.z, lp.y, -sy * lp.x + cy * lp.z);
    float df = sdEllipsoid(lp, rad);
    if (df < d) {
      d = df;
      col = fishColor(sp / 6.0, vig);
      glow = 0.15 + vig * 0.25;
    }
  }
  return d;
}

float mapDecor(vec3 p, float reef, float dens) {
  float floorH = -0.72 + fbm(p * vec3(1.2, 0.4, 1.1) + vec3(0.0, uTime * 0.02, 0.0)) * 0.08;
  float sand = p.y - floorH;
  float rock = sdRoundBox(p - vec3(0.35, -0.55, -0.25), vec3(0.22, 0.18, 0.2), 0.08);
  rock = min(rock, sdRoundBox(p - vec3(-0.42, -0.58, 0.35), vec3(0.18, 0.14, 0.16), 0.06));
  float stems = 1e3;
  if (reef < 0.5) {
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 base = vec2(sin(fi * 1.7 + slotF(0, 16.0) * 6.0), cos(fi * 2.1)) * 0.75;
      vec3 q = p - vec3(base.x, -0.65, base.y);
      float sway = sin(uTime * 0.6 + fi + q.x * 3.0) * 0.08 * dens;
      q.x += sway;
      float h = 0.35 + 0.25 * hash11(fi + 2.0);
      float t = clamp((q.y + 0.05) / h, 0.0, 1.0);
      float r = mix(0.02, 0.005, t) * dens;
      float stem = length(q.xz) - r;
      float cap = length(vec3(q.x, q.y - h, q.z)) - 0.04;
      stems = min(stems, min(stem, cap));
    }
  } else {
    float coral = fbm(p * 2.5 + vec3(0.0, uTime * 0.03, 0.0));
    stems = p.y - (-0.62 + coral * 0.25 * dens);
  }
  return min(sand, min(rock, stems));
}

float mapScene(vec3 p, out vec3 col, out float glow) {
  float reef = slotF(0, 0.0);
  float dens = slotF(0, 4.0);
  float decor = mapDecor(p, reef, dens);
  vec3 fcol;
  float fg;
  float fish = mapFish(p, fcol, fg);
  float d = min(decor, fish);
  if (fish < decor) {
    col = fcol;
    glow = fg;
  } else {
    col = reef > 0.5
      ? mix(vec3(0.55, 0.35, 0.25), vec3(0.2, 0.55, 0.65), 0.45)
      : mix(vec3(0.72, 0.62, 0.38), vec3(0.15, 0.45, 0.2), 0.35);
    glow = 0.0;
  }
  return d;
}

vec3 getCam(float mode, float phase) {
  vec3 ro = vec3(0.0, 0.05, 2.35);
  if (mode > 1.5) ro.z = 2.15;
  else if (mode < 0.5) ro = vec3(0.0, 0.0, 2.55);
  else ro.x += sin(phase) * 0.12;
  ro.y += sin(phase * 0.7) * 0.04;
  return ro;
}

void main() {
  float reef = slotF(0, 0.0);
  float lightMode = slotF(0, 1.0);
  float day = slotF(0, 2.0);
  float murk = slotF(0, 5.0);
  float fail = slotF(0, 6.0);
  float bubblesOn = slotF(0, 7.0);
  float camMode = slotF(0, 8.0);
  float camPhase = slotF(0, 9.0);
  float feed = slotF(0, 10.0);
  float feedY = slotF(0, 11.0);
  float sw = max(slotF(0, 12.0), 640.0);
  float sh = max(slotF(0, 13.0), 360.0);
  float labelOn = slotF(0, 14.0);
  float presetNorm = slotF(0, 15.0);
  float timeScale = max(slotF(0, 21.0), 0.05);
  float metricPeak = slotF(0, 22.0);
  float simTime = uTime * timeScale;

  vec3 ro = getCam(camMode, camPhase);
  vec3 dir = normalize(vDir);
  vec2 fc = gl_FragCoord.xy;
  vec2 uv = (fc - 0.5 * vec2(sw, sh)) / min(sw, sh);
  dir = normalize(dir + vec3(uv.x * 0.08, uv.y * 0.06, 0.0));

  vec3 sun = normalize(vec3(0.25, 0.85, -0.35));
  if (lightMode > 1.5) sun = normalize(vec3(-0.15, 0.35, -0.9));
  else if (lightMode > 0.5) sun = normalize(vec3(0.1, 0.55, -0.82));

  float tank = sdRoundBox(ro + dir * 0.5, vec3(1.25, 0.85, 1.05), 0.06);
  float t = 0.05;
  vec3 col = uBg * 0.15;
  float trans = 1.0;
  float dist = 0.0;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + dir * t;
    vec3 mcol;
    float glow;
    float d = mapScene(p, mcol, glow);
    float dens = exp(-d * 18.0);
    float fog = exp(-t * (0.35 + murk * 1.2));
    col += mcol * dens * fog * trans * (0.55 + glow);
    trans *= 1.0 - dens * 0.22;
    t += max(d, 0.012);
    dist = t;
    if (trans < 0.02 || t > 4.5) break;
  }

  vec3 pFloor = ro + dir * 2.1;
  float caust = fbm(pFloor * vec3(2.0, 0.2, 2.0) + sun.xy * simTime * 0.4);
  col += vec3(0.35, 0.75, 0.95) * caust * 0.12 * day * (1.0 - murk);

  float beam = pow(max(0.0, dot(dir, sun)), 6.0) * (0.25 + day * 0.35);
  col += mix(uAccent, vec3(0.2, 0.6, 1.0), reef) * beam * (1.0 - murk * 0.6);

  if (bubblesOn > 0.5) {
    for (int j = 0; j < 8; j++) {
      float fj = float(j);
      vec3 bp = vec3(sin(fj * 2.4 + simTime * 0.5) * 0.7, -0.7 + fract(simTime * 0.15 + fj * 0.13), cos(fj * 1.9) * 0.6);
      float db = length(ro + dir * dist * 0.5 - bp) - 0.02;
      col += vec3(0.85, 0.95, 1.0) * exp(-db * 90.0) * 0.35;
    }
  }

  int pc = int(slotF(0, 18.0));
  for (int k = 0; k < 16; k++) {
    if (k >= pc) break;
    float fk = float(k * 4);
    vec3 pp = vec3(slotF(2, fk), slotF(2, fk + 1.0), slotF(2, fk + 2.0));
    float kind = slotF(2, fk + 3.0);
    float dp = length(ro + dir * min(dist, 2.8) - pp) - mix(0.01, 0.035, kind);
    col += mix(vec3(0.7, 0.95, 1.0), uAccent, kind) * exp(-dp * 120.0) * 0.5;
  }

  if (feed > 0.05) {
    vec3 crumb = vec3(0.0, feedY, 0.15);
    float df = length(ro + dir * 1.6 - crumb) - 0.04;
    col += vec3(0.55, 0.35, 0.12) * exp(-df * 80.0) * feed;
  }

  float glass = smoothstep(0.02, 0.0, abs(sdRoundBox(ro + dir * 2.4, vec3(1.28, 0.88, 1.08), 0.04)));
  col = mix(col, vec3(0.85, 0.95, 1.0), glass * 0.12);
  col = mix(col, vec3(0.55, 0.08, 0.12), murk * 0.55);
  if (fail > 0.5) {
    float band = smoothstep(0.35, 0.0, abs(uv.y - 0.38));
    col = mix(col, vec3(0.95, 0.15, 0.2), band * 0.65);
  }

  col *= uBright * (0.65 + uAudio * 0.25 + day * 0.2);
  col = mix(col, uBg, 0.08);
  if (labelOn > 0.5) {
    float band = smoothstep(0.08, 0.0, abs(uv.y + 0.42));
    vec3 ink = mix(vec3(0.1, 0.85, 0.75), vec3(0.95, 0.2, 0.25), fail);
    col = mix(col, ink * (0.35 + presetNorm * 0.35 + metricPeak * 0.3), band * 0.85);
  }
  col = min(col, vec3(0.98));
  fragColor = vec4(col, uOpacity);
}
