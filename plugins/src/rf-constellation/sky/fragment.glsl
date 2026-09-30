// RF Constellation: one star per Wi-Fi beacon, read from zotoVizSlots slot 0 as three floats per
// beacon [rssi 0..1, channel / 165, index / 8] (frontend/beacons.ts; the host's pack mirror writes
// the same layout). Pack uniform writes are not relied on (#180).
// The sky is camera-relative and looks down -z, so stars sit on the screen plane dir.xy / -dir.z.
// CPU mirror for tests: frontend/constellation-sky.ts (keep the two in step).

float rfF(int f) {
  vec4 v = zotoVizSlots[f / 4];
  int r = f - (f / 4) * 4;
  if (r == 0) return v.x;
  if (r == 1) return v.y;
  if (r == 2) return v.z;
  return v.w;
}

vec2 rfPos(float ch, float idx, float t) {
  float ang = idx * 2.39996 + ch * 3.14159 + 0.6 + t * 0.04;
  float rr = 0.18 + 0.22 * fract(ch * 5.1 + idx * 0.31);
  return vec2(cos(ang) * rr * 1.45, sin(ang) * rr);
}

vec3 rfHue(float ch) {
  return ch < 0.1 ? vec3(1.0, 0.62, 0.3) : vec3(0.42, 0.78, 1.0);
}

float rfSeg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
  return length(p - a - ab * h);
}

void main() {
  vec3 dir = normalize(vDir);
  float fwd = max(-dir.z, 0.05);
  vec2 p = dir.xy / fwd;
  vec3 col = uBg + mix(vec3(0.01, 0.012, 0.03), vec3(0.05, 0.06, 0.14), clamp(0.5 + p.y, 0.0, 1.0));
  float bands = 0.0;
  for (float i = 0.0; i < 6.0; i += 1.0) {
    bands += smoothstep(0.92, 1.0, sin(dir.y * 12.0 + i * 1.7 + uTime * 0.3));
  }
  col += vec3(0.03, 0.035, 0.06) * bands;
  vec2 prev = vec2(0.0);
  float prevRssi = 0.0;
  for (int i = 0; i < 8; i++) {
    float rssi = clamp(rfF(i * 3), 0.0, 1.0);
    float ch = rfF(i * 3 + 1);
    if (rssi <= 0.001) continue;
    vec2 c = rfPos(ch, float(i), uTime);
    vec2 q = p - c;
    float size = 0.03 + 0.08 * rssi;
    float twinkle = 0.85 + 0.15 * sin(uTime * 2.3 + float(i) * 1.9);
    float glow = rssi * twinkle * (1.6 * exp(-dot(q, q) / (size * size)) + 0.35 * exp(-length(q) / (size * 3.0)));
    float spikes = rssi * (exp(-abs(q.y) * 160.0) + exp(-abs(q.x) * 160.0)) * exp(-length(q) * 9.0);
    col += rfHue(ch) * (glow + spikes);
    if (prevRssi > 0.0) col += rfHue(ch) * 0.5 * min(rssi, prevRssi) * exp(-rfSeg(p, prev, c) * 260.0);
    prev = c;
    prevRssi = rssi;
  }
  fragColor = vec4(col * uBright, uOpacity);
}
