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
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c); }

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

float teeth(vec3 q, vec3 head, float grin) {
  vec3 jaw = head + vec3(0.0, -0.05, 0.08);
  float w = 0.12 + 0.06 * grin;
  float d = cap(q, jaw + vec3(-w, 0.0, 0.01), jaw + vec3(w, 0.0, 0.01), 0.014 + 0.012 * grin);
  for (int i = 0; i < 9; i++) {
    float u = (float(i) - 4.0) * 0.25;
    float x = u * w;
    float len = 0.06 + 0.05 * grin + 0.018 * (1.0 - abs(u));
    d = min(d, cap(q, jaw + vec3(x, 0.014, 0.02), jaw + vec3(x * 1.06, -len, 0.055), 0.0042));
  }
  return d;
}

vec2 stepFoot(float u, float stride) {
  float st = 1.0 - step(0.5, u);
  float sw = clamp((u - 0.5) * 2.0, 0.0, 1.0);
  float z = mix(mix(-0.04, 0.48, sw), 0.48 - u, st) * stride;
  float y = 0.18 * sin(3.1416 * sw) * (1.0 - st);
  return vec2(y, z);
}

float creature(vec3 p, vec3 c, float t, float leanX, float face, float grin, float rch) {
  vec3 q = rotY(-face) * (p - c);
  float stride = 0.88;
  float along = dot(c.xz, vec2(sin(face), cos(face)));
  float phase = along / stride;
  float uL = fract(phase);
  float uR = fract(phase + 0.5);
  vec2 fL = stepFoot(uL, stride);
  vec2 fR = stepFoot(uR, stride);
  float sl = sin(6.2832 * uL);
  float sr = sin(6.2832 * uR);
  float lurch = 0.10 * sin(phase * 0.47);
  vec3 hip = vec3(0.03 * sl + lurch, 1.62 + 0.05 * max(fL.x, fR.x), 0.0);
  vec3 sh = hip + vec3(lurch * 0.30, 0.34, 0.04 + 0.03 * sl);
  vec3 head = sh + vec3(leanX, 0.22, 0.07);
  float d = cap(q, hip, sh, 0.058);
  d = smin(d, length(q - mix(hip, sh, 0.42)) - 0.078, 0.055);
  d = smin(d, length(q - hip) - 0.062, 0.04);
  d = smin(d, cap(q, sh, head, 0.038), 0.028);
  d = smin(d, length(q - (head + vec3(leanX * 0.06, 0.06, 0.03))) - 0.074, 0.032);
  d = min(d, teeth(q, head, max(grin, 0.72)));
  d = min(d, length(q - (head + vec3(0.048, 0.05, 0.056))) - 0.015);
  d = min(d, length(q - (head + vec3(-0.048, 0.05, 0.056))) - 0.015);
  vec3 elL = sh + vec3(mix(0.16, 0.09, rch), mix(-0.04, 0.07, rch) + 0.04 * sl, mix(0.44, 0.80, rch));
  vec3 wrL = elL + vec3(mix(0.06, 0.03, rch), 0.01 * sl, mix(0.50, 0.86, rch));
  vec3 elR = sh + vec3(mix(-0.15, -0.09, rch), mix(-0.07, 0.06, rch) + 0.04 * sr, mix(0.42, 0.78, rch));
  vec3 wrR = elR + vec3(mix(-0.06, -0.03, rch), -0.02 + 0.03 * sr, mix(0.52, 0.88, rch));
  d = smin(d, cap(q, sh, elL, 0.036), 0.028);
  d = smin(d, cap(q, elL, wrL, 0.028), 0.022);
  d = smin(d, length(q - elL) - 0.048, 0.03);
  d = smin(d, length(q - wrL) - 0.032, 0.02);
  d = smin(d, cap(q, sh, elR, 0.036), 0.028);
  d = smin(d, cap(q, elR, wrR, 0.028), 0.022);
  d = smin(d, length(q - elR) - 0.046, 0.03);
  d = smin(d, length(q - wrR) - 0.032, 0.02);
  float tw = sin(t * 13.2);
  float fl = mix(0.62, 1.02, rch);
  float spr = mix(1.0, 1.7, rch);
  d = min(d, cap(q, wrL, wrL + vec3(0.06 * spr, 0.04, fl + 0.07 * tw), 0.007));
  d = min(d, cap(q, wrL, wrL + vec3(0.01, 0.06, mix(0.70, 1.10, rch) + 0.05 * sin(t * 11.0)), 0.008));
  d = min(d, cap(q, wrL, wrL + vec3(-0.05 * spr, 0.03, mix(0.58, 0.96, rch) + 0.06 * sin(t * 9.4)), 0.006));
  d = min(d, cap(q, wrR, wrR + vec3(-0.06 * spr, 0.02, mix(0.64, 1.04, rch) + 0.07 * sin(t * 12.1)), 0.007));
  d = min(d, cap(q, wrR, wrR + vec3(-0.01, 0.05, mix(0.72, 1.12, rch) + 0.05 * tw), 0.008));
  d = min(d, cap(q, wrR, wrR + vec3(0.05 * spr, 0.01, mix(0.56, 0.94, rch) + 0.06 * sin(t * 10.2)), 0.006));
  float knLft = 0.28 + 0.52 * step(0.5, uL);
  float knRgt = 0.28 + 0.52 * step(0.5, uR);
  vec3 ftL = vec3(0.055, fL.x, fL.y);
  vec3 knL = vec3(0.05, 0.78 + 0.12 * step(0.5, uL), mix(0.0, fL.y, 0.42) + knLft);
  vec3 ftR = vec3(-0.055, fR.x, fR.y);
  vec3 knR = vec3(-0.05, 0.78 + 0.12 * step(0.5, uR), mix(0.0, fR.y, 0.42) + knRgt);
  d = smin(d, cap(q, hip, knL, 0.032), 0.026);
  d = smin(d, cap(q, knL, ftL, 0.022), 0.018);
  d = smin(d, length(q - knL) - 0.052, 0.03);
  d = smin(d, cap(q, hip, knR, 0.032), 0.026);
  d = smin(d, cap(q, knR, ftR, 0.022), 0.018);
  d = smin(d, length(q - knR) - 0.050, 0.03);
  d = min(d, cap(q, ftL, ftL + vec3(0.0, 0.0, 0.035), 0.009));
  d = min(d, cap(q, ftR, ftR + vec3(0.0, 0.0, 0.035), 0.009));
  d += (n2(q.xz * 4.4 + q.y * 3.1) - 0.48) * 0.024;
  d += (n2(q.xy * 6.2 + t * 0.11) - 0.5) * 0.010;
  return max(d, 0.02 - room(vec3(p.x, 1.2, p.z)));
}

void keepHall(inout vec3 p, float keep) {
  for (int k = 0; k < 5; k++) {
    float hd = room(p);
    if (hd < keep) {
      vec2 g = vec2(
        room(p + vec3(0.035, 0.0, 0.0)) - room(p - vec3(0.035, 0.0, 0.0)),
        room(p + vec3(0.0, 0.0, 0.035)) - room(p - vec3(0.0, 0.0, 0.035))
      );
      p.xz += (g / max(length(g), 1e-4)) * (keep - hd);
    }
  }
}

float map(vec3 p, vec3 c, float t, float leanX, float face, float grin, float rch) {
  return min(room(p), creature(p, c, t, leanX, face, grin, rch));
}

float tube(vec3 p, float t, float aud, float near) {
  vec2 id = floor(p.xz * 0.5);
  vec2 f = fract(p.xz * 0.5) - 0.5;
  float panel = (1.0 - smoothstep(0.14, 0.26, abs(f.x))) * (1.0 - smoothstep(0.07, 0.14, abs(f.y)));
  float dead = step(h22(id), 0.14);
  float seed = h22(id);
  float buzz = 0.97 + 0.03 * sin(t * 63.0 + seed * 33.0);
  float period = 5.5 + seed * 14.0;
  float localT = t + seed * 47.0;
  float slot = floor(localT / period);
  float ph = fract(localT / period);
  float willFlick = step(0.86, h11(slot + seed * 17.0));
  float flick = 1.0 - 0.58 * willFlick * smoothstep(0.0, 0.018, ph) * smoothstep(0.09, 0.03, ph);
  float tick = floor(t * (10.0 + aud * 14.0));
  float sync = mix(0.16, 1.0, step(0.22, h11(tick)));
  float black = step(0.91, h11(floor(t * 2.4)));
  float scare = mix(1.0, sync * (1.0 - black * 0.80), near);
  return panel * (1.0 - dead) * buzz * flick * scare;
}

void main() {
  float t = uTime;
  float aud = clamp(uAudio, 0.0, 1.0);
  vec3 vd = normalize(vDir);
  vec2 uv = vd.xy;

  float phA = fract(t * 0.040);
  float cycle = floor(t * 0.040);
  float seed = h11(cycle + 17.0);
  float beat = floor(seed * 4.0);
  float peekOn = step(1.0, beat);
  float isPeek = 1.0 - step(0.5, abs(beat - 1.0));
  float isRake = 1.0 - step(0.5, abs(beat - 3.0));
  float peekPh = 0.22 + 0.12 * h11(cycle + 9.0);
  float peek = peekOn * smoothstep(peekPh, peekPh + 0.07, phA) * smoothstep(peekPh + 0.18, peekPh + 0.08, phA);
  float freeze = peekOn * smoothstep(peekPh, peekPh + 0.015, phA) * smoothstep(peekPh + 0.12, peekPh + 0.085, phA);
  float fleePh = peekPh + 0.12;
  float flee = peekOn * smoothstep(fleePh, fleePh + 0.06, phA);
  float sprint = peekOn * smoothstep(fleePh, fleePh + 0.04, phA) * smoothstep(0.86, 0.70, phA);
  float phRun = phA - peekOn * clamp(phA - peekPh, 0.0, 0.10);
  float threat = max(max(peek * 0.95, sprint * 0.75), freeze * 0.8);
  float charge = (1.0 - step(0.5, abs(beat - 2.0))) * (1.0 - freeze) * smoothstep(peekPh + 0.06, peekPh + 0.16, phA);
  float camRate = 75.0;
  float minGap = 8.0;
  float lead = 24.0 + 20.0 * h11(cycle + 3.0);
  float close = peekOn * (1.0 - freeze) * max(max(flee, sprint), charge);
  float s = (cycle + phRun) * camRate + sprint * 7.5 + close * 18.0;
  float sTurn = 4.0 * ceil(((cycle + peekPh) * camRate - 2.0) * 0.25) + 2.0;
  float sLock = mix(1.0e5, sTurn, peekOn);
  float gone = peekOn * max(s - sTurn, 0.0);
  float hide = mix(-1.0, 1.0, step(0.5, h11(cycle + 8.0)));
  float turnDir = -hide;
  float z = -min(s, sLock);
  float x = gone * turnDir;
  float gait = s * mix(2.15, 2.85, close);
  float bob = mix(0.010, 0.036, max(max(threat, flee), close)) * abs(sin(gait)) * (1.0 - freeze);
  vec3 ro = vec3(x, 1.46 + bob, z);
  keepHall(ro, 0.36);
  x = ro.x;
  z = ro.z;
  float atTurn = peekOn * smoothstep(0.0, 0.7, gone);
  float grin = peek * max(isPeek, isRake * 0.55);
  float spotted = peekOn * smoothstep(peekPh - 0.01, peekPh + 0.03, phA);
  float approach = (1.0 - atTurn) * max(charge, spotted * (1.0 - freeze) * max(max(flee, sprint), peek));
  float hands = clamp(max(approach, spotted * (0.72 + 0.28 * close)), 0.0, 1.0);
  float leanX = (isPeek * peek + isRake * peek) * (-hide) * (0.42 + 0.05 * sin(t * 3.1));
  float gap = max(minGap, mix(lead, minGap, approach));
  vec3 cpos = vec3(hide * mix(1.32, 0.10, approach), 0.0, z - gap);
  cpos = mix(cpos, vec3(hide * 1.16, 0.0, -sTurn - minGap), atTurn);
  cpos.z -= (1.0 - peekOn) * mix(22.0, 14.0, step(0.86, h11(cycle + 21.0)));
  vec3 cKeep = vec3(cpos.x, 1.2, cpos.z);
  keepHall(cKeep, 0.40);
  cpos.xz = cKeep.xz;
  float face = atan(x - cpos.x, z - cpos.z) - hide * 0.12 * peek;
  float seeYaw = atan(-(cpos.x - x), -(cpos.z - z));
  float faceTravel = peekOn * smoothstep(peekPh + 0.12, peekPh + 0.24, phA);
  float glance = peekOn * smoothstep(peekPh - 0.02, peekPh + 0.08, phA) * (1.0 - faceTravel);
  float travelYaw = 1.5708 * turnDir * smoothstep(0.0, 0.38, gone);
  float walkCam = (1.0 - glance) * (1.0 - faceTravel);
  float drift = 0.04 * sin(t * 0.37) + 0.018 * sin(t * 0.91 + 1.7);
  float yaw = mix(walkCam * (seeYaw * 0.16 + drift), seeYaw, glance);
  yaw = mix(yaw, travelYaw, smoothstep(0.0, 1.0, max(faceTravel, atTurn * 0.85)));
  float shake = mix(0.006, 0.011, 1.0 - walkCam);
  yaw += shake * (sin(t * 22.3) + 0.55 * sin(t * 37.1)) * (1.0 - freeze);
  yaw += 0.003 * walkCam * sin(gait * 0.9);
  ro.x += 0.0025 * walkCam * sin(t * 15.1);
  ro.y += 0.0016 * walkCam * sin(t * 21.4 + 0.7);
  keepHall(ro, 0.36);
  x = ro.x; z = ro.z;

  // Yaw-only aim (no pitch). Dome is camera-locked so vd is local (-Z forward).
  vec3 rd = normalize(rotY(yaw) * vd);
  float far = mix(56.0, 48.0, threat);
  float hit = 0.02;
  vec3 p = ro;
  for (int i = 0; i < 52; i++) {
    float d = map(p, cpos, t, leanX, face, grin, hands);
    hit += d;
    p = ro + rd * hit;
    if (d < 0.002 * (1.0 + hit) || hit > far) break;
  }

  vec3 e = vec3(0.014, 0.0, 0.0);
  vec3 n = normalize(vec3(
    map(p + e.xyy, cpos, t, leanX, face, grin, hands) - map(p - e.xyy, cpos, t, leanX, face, grin, hands),
    map(p + e.yxy, cpos, t, leanX, face, grin, hands) - map(p - e.yxy, cpos, t, leanX, face, grin, hands),
    map(p + e.yyx, cpos, t, leanX, face, grin, hands) - map(p - e.yyx, cpos, t, leanX, face, grin, hands)
  ));

  float isC = 1.0 - smoothstep(0.02, 0.08, creature(p, cpos, t, leanX, face, grin, hands));
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

  float hush = max(close, max(peek, freeze));
  float L = tube(p, t, aud, hush);
  float Lceil = tube(vec3(p.x, 2.5, p.z), t, aud, hush);
  L *= 1.0 - 0.62 * hush;
  Lceil *= 1.0 - 0.58 * hush;
  float fill = 0.96 + 0.32 * Lceil + 0.06 * aud + 0.07 * threat;
  fill *= mix(1.0, 0.90 + 0.10 * (0.72 + 0.28 * sin(t * 58.0)), hush);
  fill *= 1.0 - 0.22 * hush;
  col += vec3(1.08, 1.06, 0.82) * Lceil * (0.35 + 0.9 * isCe + 0.45 * isFl);
  float dif = 0.35 + 0.65 * max(0.0, n.y);
  col *= vec3(1.04, 1.02, 0.80) * (fill * dif);
  col += vec3(1.02, 1.0, 0.72) * L * isCe * 1.8;

  vec3 lgt = normalize(vec3(0.12, 0.92, 0.18));
  float ndl = max(0.0, dot(n, lgt));
  float wrap = clamp(dot(n, lgt) * 0.55 + 0.45, 0.0, 1.0);
  float rim = pow(1.0 - max(0.0, dot(n, -rd)), 2.4);
  vec3 skin = vec3(0.14, 0.11, 0.10);
  vec3 flesh = vec3(0.26, 0.16, 0.13);
  vec3 ccol = mix(skin, flesh, wrap);
  ccol *= (0.22 + 0.68 * wrap) * (0.4 + 0.55 * fill);
  ccol *= 0.82 + 0.22 * n2(p.xz * 7.5 + p.y * 4.0);
  ccol += vec3(0.55, 0.55, 0.5) * Lceil * ndl * 0.18;
  ccol += vec3(0.28, 0.28, 0.3) * rim * 0.14;
  vec3 qTooth = rotY(-face) * (p - cpos);
  vec3 hd = vec3(leanX, 2.18, 0.10);
  float isTooth = 1.0 - smoothstep(0.003, 0.012, teeth(qTooth, hd, max(grin, 0.72)));
  ccol = mix(ccol, vec3(0.97, 0.96, 0.92), isTooth);
  float isEye = 1.0 - smoothstep(0.006, 0.018, min(
    length(qTooth - (hd + vec3(0.048, 0.05, 0.056))),
    length(qTooth - (hd + vec3(-0.048, 0.05, 0.056)))
  ));
  ccol = mix(ccol, vec3(0.98, 0.98, 0.97), isEye);
  float cAlpha = 0.72 + 0.22 * wrap;
  col = mix(col, ccol, isC * cAlpha);

  float sh = 0.0;
  float foot = length(p.xz - cpos.xz);
  if (foot < 1.6 && p.y < 0.55) {
    float oc = creature(vec3(p.x, 0.42, p.z), cpos, t, leanX, face, grin, hands);
    sh = (1.0 - smoothstep(0.12, 1.25, foot)) * (1.0 - smoothstep(0.08, 0.9, oc));
    sh *= 0.62 * (1.0 - smoothstep(0.02, 0.5, p.y));
  }
  col *= 1.0 - sh * vec3(0.5, 0.42, 0.28);

  float fogK = mix(0.022, 0.016, threat);
  float fog = 1.0 - exp(-max(hit - 8.0, 0.0) * fogK);
  vec3 fogc = vec3(0.95, 0.92, 0.68) * (0.62 + 0.38 * fill);
  col *= mix(1.0, 0.78, smoothstep(22.0, 50.0, hit));
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
