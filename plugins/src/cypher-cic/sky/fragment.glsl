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

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float hexGrid(vec2 p) {
  vec2 s = vec2(1.0, 1.73205);
  vec2 h = s * 0.5;
  vec2 a = mod(p, s) - h;
  vec2 b = mod(p - h, s) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  float d = min(abs(g.x), abs(g.y * 0.866 + g.x * 0.5));
  return 1.0 - smoothstep(0.02, 0.07, d);
}

float ring(float r, float at, float w) {
  return 1.0 - smoothstep(w, w * 2.6, abs(r - at));
}

float panel(vec2 p, vec2 c, vec2 b) {
  float d = sdBox(p - c, b);
  float frame = 1.0 - smoothstep(0.0, 0.012, abs(d));
  float fill = 1.0 - smoothstep(-0.004, 0.018, d);
  vec2 e = abs(p - c) - b + 0.028;
  float corner = (1.0 - smoothstep(0.0, 0.01, min(abs(e.x), abs(e.y))))
    * step(0.0, e.x) * step(0.0, e.y) * step(e.x, 0.055) * step(e.y, 0.055);
  return frame * 0.85 + fill * 0.12 + corner;
}

float bar(vec2 p, vec2 o, vec2 sz, float v) {
  float h = sz.y * clamp(v, 0.04, 1.0);
  float d = sdBox(p - (o + vec2(0.0, h - sz.y)), vec2(sz.x, h));
  return 1.0 - smoothstep(0.0, 0.008, d);
}

float spark(vec2 p, float n, float t) {
  float x = p.x * n;
  float i = floor(x);
  float f = fract(x);
  float y = 0.5 + 0.5 * sin(i * 1.7 + t * 2.4);
  return (1.0 - smoothstep(0.0, 0.08, abs(p.y - y))) * (1.0 - smoothstep(0.35, 0.5, abs(f - 0.5)));
}

float glyphC(vec2 p) {
  float d = abs(length(p) - 0.34) - 0.07;
  d = max(d, -sdBox(p - vec2(0.28, 0.0), vec2(0.22, 0.12)));
  return 1.0 - smoothstep(0.0, 0.03, d);
}

float glyphI(vec2 p) {
  return 1.0 - smoothstep(0.0, 0.03, sdBox(p, vec2(0.07, 0.38)));
}

void main() {
  float cpu = sl(0, 0.0);
  float mem = sl(0, 1.0);
  float disk = sl(0, 2.0);
  float gpu = sl(0, 3.0);
  float temp = sl(0, 4.0);
  float watts = sl(0, 5.0);
  float psi = sl(0, 6.0);
  float socks = sl(0, 7.0);
  float failed = sl(0, 8.0);
  float udev = sl(0, 9.0);
  float aud = max(uAudio, sl(0, 10.0));
  float alert = sl(0, 11.0);
  float sw = sl(0, 12.0);
  float sh = sl(0, 13.0);
  if (sw < 64.0) sw = 1280.0;
  if (sh < 64.0) sh = 800.0;
  float netL = sl(0, 14.0);
  float rfL = sl(0, 15.0);
  float rainAmt = sl(0, 16.0);
  if (rainAmt < 0.01) rainAmt = 1.0;
  float glitch = sl(0, 17.0);
  float hudW = sl(0, 18.0);
  if (hudW < 0.2) hudW = 0.92;
  float load = clamp((cpu + mem + gpu + temp) * 0.25, 0.0, 1.0);

  vec3 dir = normalize(vDir);
  float lon = atan(dir.z, dir.x);
  float lat = dir.y;

  vec3 deep = mix(vec3(0.012, 0.004, 0.04), uBg, 0.45);
  vec3 cyan = mix(vec3(0.0, 0.92, 1.0), uAccent, 0.55);
  vec3 mag = vec3(1.0, 0.18, 0.72);
  vec3 gold = vec3(1.0, 0.82, 0.22);
  vec3 col = deep + cyan * (0.06 + 0.08 * load);

  float fog = exp(-abs(lat) * 2.4);
  vec3 haze = mix(vec3(0.18, 0.02, 0.28), cyan, 0.35 + 0.4 * aud);
  col += haze * fog * (0.22 + 0.18 * load);

  float city = 0.0;
  float win = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float dens = 18.0 + fi * 7.0;
    float id = floor((lon + fi * 0.17) * dens);
    float h = 0.04 + 0.20 * hash21(vec2(id, fi + 2.1)) * (1.0 + load * 0.4);
    float w = 0.18 + 0.16 * hash21(vec2(id, fi + 8.4));
    float cell = fract((lon + fi * 0.17) * dens);
    float base = -0.02 - fi * 0.045;
    float on = step(lat, base) * step(base - h, lat) * step(abs(cell - 0.5), w);
    city += on * (0.35 + 0.12 * fi);
    float wy = fract((base - lat) * 28.0 + uTime * 0.15);
    float wx = fract(cell * 9.0 + id * 0.2);
    win += on * step(0.62, hash21(vec2(id + wx, floor((base - lat) * 28.0))))
      * (1.0 - smoothstep(0.18, 0.45, abs(wy - 0.5))) * (1.0 - smoothstep(0.2, 0.42, abs(wx - 0.5)));
  }
  col += mix(cyan, mag, 0.35) * city * 0.22;
  col += gold * win * (0.18 + 0.22 * aud);

  float horizon = 1.0 - smoothstep(0.02, 0.12, abs(lat + 0.04));
  col += cyan * horizon * (0.16 + 0.2 * aud);

  float floorY = lat + 0.12;
  if (floorY < 0.0) {
    vec2 gp = dir.xz / max(0.04, -floorY);
    vec2 gf = abs(fract(gp * 2.4) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.04, min(gf.x, gf.y));
    float fade = exp(floorY * 3.2);
    col += cyan * line * fade * (0.18 + 0.16 * aud);
    float road = 1.0 - smoothstep(0.0, 0.08, abs(gp.x));
    col += mag * road * fade * 0.08;
  }

  float tun = 0.0;
  vec3 td = dir;
  float tz = fract(td.z * 1.4 + uTime * 0.22);
  vec2 tp = td.xy / max(0.12, abs(td.z));
  tun += (1.0 - smoothstep(0.18, 0.42, length(tp))) * (1.0 - smoothstep(0.0, 0.18, abs(tz - 0.5)));
  tun += (1.0 - smoothstep(0.0, 0.03, abs(length(tp) - 0.28 - 0.08 * sin(uTime + lon * 4.0)))) * 0.55;
  col += mix(cyan, mag, netL) * tun * (0.12 + 0.18 * netL);

  float rain = 0.0;
  vec2 rp = vec2(lon * 1.4, lat * 2.6 - uTime * (0.9 + rainAmt * 0.5));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = rp * (14.0 + fi * 9.0) + vec2(fi * 3.1, fi * 1.7);
    vec2 id = floor(q);
    vec2 f = fract(q);
    float drop = hash21(id + 19.0);
    rain += step(0.82 - rainAmt * 0.12, drop) * (1.0 - smoothstep(0.0, 0.07, abs(f.x - 0.5)))
      * (1.0 - smoothstep(0.0, 0.55, f.y)) * (0.18 + 0.12 * fi);
  }
  col += cyan * rain * (0.22 + 0.25 * rainAmt) * (0.55 + 0.45 * (1.0 - fog));

  vec2 traces = dir.xz / (0.22 + abs(dir.y));
  float grid = hexGrid(traces * (5.5 + load)) * (1.0 - smoothstep(0.55, 1.4, length(traces)));
  float pulse = 0.55 + 0.45 * sin(length(traces) * 6.0 - uTime * 1.6);
  col += cyan * grid * pulse * 0.22;

  vec2 fc = gl_FragCoord.xy;
  vec2 res = vec2(sw, sh);
  vec2 uv = (fc - 0.5 * res) / min(sw, sh);
  vec2 suv = fc / res;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);

  float tear = 0.0;
  if (glitch + alert > 0.04) {
    float band = step(0.92, hash21(vec2(floor(fc.y * 0.08 + uTime * 9.0), floor(uTime * 7.0))));
    tear = band * (glitch * 0.55 + alert * 0.65);
    uv.x += tear * (hash21(vec2(fc.y, uTime)) - 0.5) * 0.08;
  }

  float hud = 0.0;
  hud += panel(uv, vec2(-0.62, 0.18), vec2(0.28, 0.38));
  hud += panel(uv, vec2(0.62, 0.18), vec2(0.28, 0.38));
  hud += panel(uv, vec2(0.0, -0.42), vec2(0.72, 0.14));
  hud += panel(uv, vec2(0.0, 0.46), vec2(0.42, 0.08));

  float left = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float rate = sl(1, fi * 4.0);
    float hue = sl(1, fi * 4.0 + 2.0);
    vec2 o = vec2(-0.82 + fi * 0.055, -0.12);
    left += bar(uv, o, vec2(0.018, 0.32), max(rate, 0.05 + 0.04 * sin(uTime * 2.0 + fi)));
    left += (1.0 - smoothstep(0.0, 0.01, abs(uv.x - o.x))) * step(abs(uv.y + 0.12), 0.34) * 0.15;
    col += mix(cyan, mag, hue) * bar(uv, o, vec2(0.018, 0.32), max(rate, 0.04)) * 0.85;
  }

  float right = 0.0;
  float gvs[8];
  gvs[0] = cpu; gvs[1] = mem; gvs[2] = disk; gvs[3] = gpu;
  gvs[4] = temp; gvs[5] = watts; gvs[6] = psi; gvs[7] = socks;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 o = vec2(0.42 + fi * 0.055, -0.12);
    float v = max(gvs[i], 0.05);
    right += bar(uv, o, vec2(0.018, 0.32), v);
    col += mix(cyan, gold, fi * 0.12) * bar(uv, o, vec2(0.018, 0.32), v) * (0.7 + v);
  }

  float proto = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float fld = sl(2, fi * 4.0);
    float ph = sl(2, fi * 4.0 + 2.0);
    vec2 o = vec2(-0.62 + fi * 0.155, -0.48);
    float w = 0.05 + fld * 0.04;
    float d = sdBox(uv - o, vec2(w, 0.035 + fld * 0.05));
    proto += 1.0 - smoothstep(0.0, 0.01, d);
    col += mix(cyan, mag, ph) * (1.0 - smoothstep(0.0, 0.012, d)) * (0.55 + fld);
  }

  float rf = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float rssi = sl(3, fi * 4.0);
    float ch = sl(3, fi * 4.0 + 1.0);
    float hh = sl(3, fi * 4.0 + 2.0);
    vec2 o = vec2(0.18 + fi * 0.09, -0.42 + rssi * 0.08);
    float d = length(uv - o);
    rf += (1.0 - smoothstep(0.012, 0.032, d)) * (0.4 + rssi);
    rf += ring(d, 0.028 + ch * 0.02, 0.004) * rssi;
    col += mix(cyan, gold, hh) * (1.0 - smoothstep(0.01, 0.03, d)) * (0.5 + rssi);
  }

  float gauges = 0.0;
  for (int i = 0; i < 8; i++) {
    float gv = gvs[i];
    float a0 = float(i) * 0.785398 - 0.38;
    float span = 0.62 * clamp(gv, 0.1, 1.0);
    float da = atan(sin(ang - a0), cos(ang - a0));
    float onArc = step(0.0, da) * step(da, span);
    gauges += onArc * ring(r, 0.22, 0.016) * (0.75 + gv);
  }
  float cube = 0.0;
  float ct = uTime * 0.35;
  float cs = sin(ct), cc = cos(ct);
  vec3 cq = vec3(uv.x, uv.y, 0.18);
  vec3 cr = vec3(cq.x * cc - cq.z * cs, cq.y, cq.x * cs + cq.z * cc);
  vec3 ad = abs(cr);
  float boxd = max(ad.x, max(ad.y, ad.z)) - 0.09;
  cube += 1.0 - smoothstep(0.0, 0.012, abs(boxd));
  cube *= 1.0 - smoothstep(0.16, 0.28, r);

  float core = exp(-r * r * 18.0) * (0.55 + load * 0.7 + aud * 0.3);
  float sweep = fract(ang / 6.28318 - uTime * 0.11);
  float beam = (1.0 - smoothstep(0.0, 0.08, sweep)) * (1.0 - smoothstep(0.32, 0.08, r));
  float rings = ring(r, 0.12, 0.008) + ring(r, 0.22, 0.007) + ring(r, 0.32, 0.006);
  rings *= 0.55 + 0.45 * aud;

  float spokes = 0.0;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + uTime * 0.04;
    vec2 arm = vec2(cos(a), sin(a));
    float along = abs(uv.x * arm.y - uv.y * arm.x);
    float radial = dot(uv, arm);
    spokes += (1.0 - smoothstep(0.004, 0.016, along)) * step(0.04, radial) * step(radial, 0.30);
  }

  vec2 title = uv - vec2(0.0, 0.46);
  float word = glyphC(title * 5.4 - vec2(-1.15, 0.0))
    + glyphI(title * 5.4)
    + glyphC(title * 5.4 - vec2(1.15, 0.0));
  float under = 1.0 - smoothstep(0.0, 0.01, abs(title.y + 0.07)) * step(abs(title.x), 0.28);

  float sparkL = spark((uv - vec2(-0.62, 0.48)) * vec2(4.2, 8.0) + vec2(0.5), 8.0, uTime) * step(abs(uv.x + 0.62), 0.26) * step(abs(uv.y - 0.48), 0.05);
  float sparkR = spark((uv - vec2(0.62, 0.48)) * vec2(4.2, 8.0) + vec2(0.5), 8.0, uTime * 1.1 + 1.3) * step(abs(uv.x - 0.62), 0.26) * step(abs(uv.y - 0.48), 0.05);

  vec2 a = abs(suv * 2.0 - 1.0);
  float bracket = (1.0 - smoothstep(0.0, 0.01, min(abs(a.x - 0.93), abs(a.y - 0.90))))
    * step(0.78, max(a.x, a.y));

  float tick = 0.0;
  for (int i = 0; i < 8; i++) {
    float a0 = float(i) * 0.785398;
    tick += 1.0 - smoothstep(0.008, 0.02, length(uv - vec2(cos(a0), sin(a0)) * 0.22));
  }

  vec3 hol = cyan * (0.55 * hud + 1.4 * gauges + 1.1 * core + 0.9 * beam + 0.7 * rings + 0.45 * spokes + 0.55 * tick + 0.85 * cube);
  hol += mag * (0.55 * left + 0.4 * proto + failed * 0.7);
  hol += gold * (0.45 * right + 0.35 * rf + psi * 0.35 + udev * 0.2);
  hol += cyan * (word * 1.4 + under * 0.5 + sparkL * 0.8 + sparkR * 0.8 + bracket * 0.7);
  hol += vec3(1.0, 0.28, 0.14) * alert * (0.35 + 0.35 * sin(uTime * 7.0));

  float plate = 1.0 - smoothstep(0.95, 0.15, r);
  col = mix(col, hol + col * 0.28, clamp(hudW * (0.42 + 0.58 * plate), 0.0, 1.0));
  col += hol * hudW * 0.22;

  float scan = 0.86 + 0.14 * sin(fc.y * 1.35 + uTime * 12.0);
  col *= scan;
  col.r += tear * 0.18;
  col.b -= tear * 0.08;
  float vig = 1.0 - 0.22 * pow(length(uv * vec2(1.15, 1.05)), 1.55);
  col += cyan * (0.04 + 0.06 * load + 0.05 * netL + 0.04 * rfL);
  fragColor = vec4(col * max(uBright, 0.78) * vig, max(uOpacity, 0.9));
}
