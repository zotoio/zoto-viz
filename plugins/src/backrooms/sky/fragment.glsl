float h11(float n) { return fract(sin(n) * 43758.5453123); }
float h22(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h22(i), h22(i + vec2(1.0, 0.0)), f.x), mix(h22(i + vec2(0.0, 1.0)), h22(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}
mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

float room(vec3 p) {
  vec2 q = abs(mod(p.xz + 2.0, 4.0) - 2.0);
  vec2 cell = floor((p.xz + 2.0) * 0.25);
  float hall = mix(1.06, 1.42, step(0.72, h22(cell)));
  float w = hall - min(q.x, q.y);
  vec2 rc = floor((p.xz + 6.0) * 0.083333);
  float open = step(0.72, h22(rc + 3.7));
  vec2 loc = abs(mod(p.xz + 6.0, 12.0) - 6.0);
  float span = mix(4.6, 5.6, step(0.45, h22(rc + 1.1)));
  float chamber = span - max(loc.x, loc.y);
  w = mix(w, max(w, chamber), open);
  float ceilH = mix(2.52, 2.72, open);
  return min(p.y, min(ceilH - p.y, w));
}

float creature(vec3 p, vec3 c, float t, float leanX, float face) {
  vec3 q = rotY(-face) * (p - c);
  float gait = t * 3.25;
  float step = sin(gait);
  float liftL = max(step, 0.0);
  float liftR = max(-step, 0.0);
  vec3 hip = vec3(0.0, 0.90 + 0.018 * abs(step), 0.0);
  vec3 sh = hip + vec3(0.0, 1.04, 0.02);
  vec3 head = sh + vec3(leanX, 0.38, 0.04);
  float d = cap(q, hip, sh, 0.062);
  d = smin(d, cap(q, sh, head, 0.036), 0.022);
  d = smin(d, cap(q, head, head + vec3(leanX * 0.08, 0.14, 0.02), 0.054), 0.018);
  vec3 elL = sh + vec3(0.11 + 0.05 * step, -0.26, 0.08 * step);
  vec3 wrL = elL + vec3(0.03, -0.34 - 0.05 * step, 0.10 * step);
  vec3 elR = sh + vec3(-0.11 - 0.05 * step, -0.26, -0.08 * step);
  vec3 wrR = elR + vec3(-0.03, -0.34 + 0.05 * step, -0.10 * step);
  d = smin(d, cap(q, sh, elL, 0.020), 0.014);
  d = smin(d, cap(q, elL, wrL, 0.016), 0.012);
  d = smin(d, cap(q, sh, elR, 0.020), 0.014);
  d = smin(d, cap(q, elR, wrR, 0.016), 0.012);
  vec3 knL = hip + vec3(0.058, -0.46 + 0.11 * liftL, 0.18 * step);
  vec3 ftL = knL + vec3(0.0, -0.44, 0.12 * step);
  vec3 knR = hip + vec3(-0.058, -0.46 + 0.11 * liftR, -0.18 * step);
  vec3 ftR = knR + vec3(0.0, -0.44, -0.12 * step);
  d = smin(d, cap(q, hip, knL, 0.026), 0.014);
  d = smin(d, cap(q, knL, ftL, 0.022), 0.012);
  d = smin(d, cap(q, hip, knR, 0.026), 0.014);
  d = smin(d, cap(q, knR, ftR, 0.022), 0.012);
  return d;
}

float map(vec3 p, vec3 c, float t, float leanX, float face) {
  return min(room(p), creature(p, c, t, leanX, face));
}

float tube(vec3 p, float t, float aud) {
  vec2 id = floor(p.xz * 0.5);
  vec2 f = fract(p.xz * 0.5) - 0.5;
  float panel = (1.0 - smoothstep(0.14, 0.26, abs(f.x))) * (1.0 - smoothstep(0.07, 0.14, abs(f.y)));
  float dead = step(h22(id), 0.14);
  float buzz = 0.72 + 0.28 * sin(t * 63.0 + h22(id) * 33.0);
  float tick = floor(t * (8.0 + aud * 18.0));
  float strobe = mix(0.1, 1.0, step(0.09, h11(tick + h22(id) * 19.0)));
  float black = step(0.97, h11(floor(t * 1.8)));
  return panel * (1.0 - dead) * buzz * strobe * (1.0 - black * 0.85);
}

float band(float ph, float a, float b) {
  return smoothstep(a, a + 0.07, ph) * smoothstep(b + 0.10, b, ph);
}

void main() {
  float t = uTime;
  float aud = clamp(uAudio, 0.0, 1.0);
  vec3 vd = normalize(vDir);
  vec2 uv = vd.xy;

  float phA = fract(t * 0.040);
  float cycle = floor(t * 0.040);
  float peekOn = step(0.68, h11(cycle + 17.0));
  float peekPh = 0.34 + 0.05 * h11(cycle + 9.0);
  float peek = peekOn * band(phA, peekPh, peekPh + 0.07);
  float fleePh = 0.40;
  float flee = smoothstep(fleePh, fleePh + 0.06, phA);
  float sprint = smoothstep(fleePh, fleePh + 0.04, phA) * smoothstep(0.86, 0.70, phA);
  float lead = max(1.48, 4.85 - phA * 7.4);
  float near = 1.0 - smoothstep(1.6, 4.4, lead);
  float threat = max(max(peek * 0.9, sprint * 0.75), near * 0.6);
  float s = t * 2.48 + sprint * 5.1;
  float sFlee = (cycle + fleePh) * 62.0;
  float gone = max(s - sFlee, 0.0);
  float turnDir = mix(-1.0, 1.0, step(0.5, h11(cycle + 2.0)));
  float z = -min(s, sFlee);
  float x = gone * turnDir;
  float gait = s * 2.15;
  float bobAmp = mix(0.010, 0.028, max(threat, flee));
  float bob = bobAmp * abs(sin(gait));
  vec3 ro = vec3(x, 1.46 + bob, z);
  float yaw = 1.5708 * turnDir * flee;
  yaw += 0.012 * sin(gait * 0.35) * (1.0 - flee * 0.35);
  float pitch = 0.10 + 0.022 * threat + 0.010 * sin(gait) * (0.55 + 0.45 * threat);

  float hide = mix(-1.0, 1.0, step(0.5, h11(cycle + 8.0)));
  float leanX = peek * hide * (0.22 + 0.04 * sin(t * 2.4)) * (1.0 - flee);
  vec3 cpos = mix(vec3(0.0, 0.0, z - lead), vec3(0.0, 0.0, -sFlee - 2.1), flee);
  float face = atan(x - cpos.x, z - cpos.z);

  vec3 rd = normalize(rotY(yaw) * rotX(-pitch) * vd);
  float far = mix(44.0, 38.0, threat);
  float hit = 0.02;
  vec3 p = ro;
  for (int i = 0; i < 52; i++) {
    float d = map(p, cpos, t, leanX, face);
    hit += d;
    p = ro + rd * hit;
    if (d < 0.002 * (1.0 + hit) || hit > far) break;
  }

  vec3 e = vec3(0.014, 0.0, 0.0);
  vec3 n = normalize(vec3(
    map(p + e.xyy, cpos, t, leanX, face) - map(p - e.xyy, cpos, t, leanX, face),
    map(p + e.yxy, cpos, t, leanX, face) - map(p - e.yxy, cpos, t, leanX, face),
    map(p + e.yyx, cpos, t, leanX, face) - map(p - e.yyx, cpos, t, leanX, face)
  ));

  float isC = 1.0 - smoothstep(0.02, 0.08, creature(p, cpos, t, leanX, face));
  float isFl = 1.0 - smoothstep(0.05, 0.16, p.y);
  float isCe = smoothstep(2.28, 2.62, p.y);

  float motif = abs(sin(p.x * 6.2) * 0.14 + sin(p.y * 5.1 + p.x * 0.8) * 0.1);
  motif += 0.12 * n2(vec2(p.x, p.y) * 4.0);
  float stain = pow(n2(p.xz * 0.55 + p.y), 1.8);
  vec3 paper = vec3(0.97, 0.94, 0.70) * (0.92 + motif * 0.42) * (0.90 + 0.10 * (1.0 - stain));
  paper = mix(paper, vec3(0.91, 0.87, 0.55), stain * 0.18);
  vec3 carpet = vec3(0.90, 0.86, 0.55) * (0.82 + 0.18 * n2(p.xz * 18.0));
  float tile = max(step(0.93, fract(p.x * 0.5)), step(0.93, fract(p.z * 0.5)));
  vec3 ceilc = mix(vec3(0.99, 0.97, 0.86), vec3(0.94, 0.91, 0.72), tile);

  vec3 col = mix(paper, carpet, isFl);
  col = mix(col, ceilc, isCe);

  float L = tube(p, t, aud);
  float Lceil = tube(vec3(p.x, 2.5, p.z), t, aud);
  float fill = 0.96 + 0.32 * Lceil + 0.06 * aud + 0.07 * threat;
  fill *= 0.90 + 0.10 * (0.72 + 0.28 * sin(t * 58.0));
  col += vec3(1.08, 1.06, 0.82) * Lceil * (0.35 + 0.9 * isCe + 0.45 * isFl);
  float dif = 0.35 + 0.65 * max(0.0, n.y);
  col *= vec3(1.04, 1.02, 0.80) * (fill * dif);
  col += vec3(1.02, 1.0, 0.72) * L * isCe * 1.8;

  vec3 lgt = normalize(vec3(0.12, 0.92, 0.18));
  float ndl = max(0.0, dot(n, lgt));
  float wrap = clamp(dot(n, lgt) * 0.55 + 0.45, 0.0, 1.0);
  float rim = pow(1.0 - max(0.0, dot(n, -rd)), 2.4);
  vec3 skin = vec3(0.11, 0.11, 0.12);
  vec3 flesh = vec3(0.2, 0.2, 0.21);
  vec3 ccol = mix(skin, flesh, wrap);
  ccol *= (0.2 + 0.7 * wrap) * (0.4 + 0.55 * fill);
  ccol += vec3(0.55, 0.55, 0.5) * Lceil * ndl * 0.18;
  ccol += vec3(0.28, 0.28, 0.3) * rim * 0.14;
  vec3 hd = cpos + rotY(face) * vec3(leanX, 2.22, 0.10);
  vec3 toEye = p - hd;
  float eyes = exp(-dot(toEye - vec3(0.04, -0.02, 0.06), toEye - vec3(0.04, -0.02, 0.06)) * 90.0);
  eyes += exp(-dot(toEye - vec3(-0.04, -0.02, 0.06), toEye - vec3(-0.04, -0.02, 0.06)) * 90.0);
  ccol += vec3(0.55, 0.52, 0.42) * eyes * 0.28;
  float cAlpha = 0.72 + 0.22 * wrap;
  col = mix(col, ccol, isC * cAlpha);

  float sh = 0.0;
  float foot = length(p.xz - cpos.xz);
  if (foot < 1.6 && p.y < 0.55) {
    float oc = creature(vec3(p.x, 0.42, p.z), cpos, t, leanX, face);
    sh = (1.0 - smoothstep(0.12, 1.25, foot)) * (1.0 - smoothstep(0.08, 0.9, oc));
    sh *= 0.62 * (1.0 - smoothstep(0.02, 0.5, p.y));
  }
  col *= 1.0 - sh * vec3(0.5, 0.42, 0.28);

  float fogK = mix(0.046, 0.030, threat);
  float fog = 1.0 - exp(-hit * fogK);
  vec3 fogc = vec3(0.95, 0.92, 0.68) * (0.58 + 0.42 * fill);
  col = mix(col, fogc, fog);
  if (hit > far - 1.0) col = fogc;

  float grain = n2(uv * 90.0 + fract(t) * 6.0);
  float lineN = uv.y * 520.0 + t * 22.0 + grain * 2.4;
  float scan = pow(abs(sin(lineN)), 14.0);
  float scanGate = step(0.74, h11(floor(t * 11.0) + floor(uv.y * 160.0 + grain * 8.0)));
  col *= 1.0 - scan * scanGate * (0.10 + 0.06 * grain);
  col += (h22(uv * 130.0 + fract(t) * 17.0) - 0.5) * 0.022;
  col *= 0.90 + 0.10 * smoothstep(1.55, 0.2, length(uv * vec2(1.05, 0.95)));
  col.r += 0.015 * length(uv);
  col.b -= 0.01 * length(uv);
  float row = uv.y * 210.0 + n2(vec2(uv.x * 22.0, t * 3.1)) * 3.0;
  float tear = pow(1.0 - abs(fract(row) - 0.5) * 2.0, 22.0);
  float burst = step(0.91, h11(floor(t * 6.5) + floor(row * 0.22)));
  float gaps = step(0.28, h22(vec2(floor(uv.x * 36.0 + t * 5.0), floor(row))));
  float chroma = tear * burst * gaps * (0.5 + 0.5 * grain);
  col = mix(col, col.gbr * 0.68, chroma * 0.8);
  col = mix(col, col.brg * 0.72, chroma * 0.28 * step(0.6, h11(floor(t * 9.0))));
  float cut = smoothstep(0.90, 0.96, phA);
  col *= 1.0 - 0.35 * cut;
  col = max(col, vec3(0.0));
  float br = max(uBright, 1.05);
  fragColor = vec4(col * br, 1.0);
}
