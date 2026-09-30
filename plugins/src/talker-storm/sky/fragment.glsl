// Talker Storm: one storm cell per top talker, drawn from zotoVizSlots (#180, not a particle lane).
// slot 0 = [count, audio, t mod 1] (same layout the host pack mirror writes), slot 1 = up to 16
// talkers x [cx, cy, hue, rate 0..1] on the camera-relative screen plane (frontend/storm.ts).
// The sky is parented to the camera and looks down -z. Pack uniform writes are not relied on.
// CPU mirror for tests: frontend/storm-sky.ts (keep the two in step).

float tsF(int f) {
  vec4 v = zotoVizSlots[f / 4];
  int r = f - (f / 4) * 4;
  if (r == 0) return v.x;
  if (r == 1) return v.y;
  if (r == 2) return v.z;
  return v.w;
}

vec3 tsHue(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec3 dir = normalize(vDir);
  float fwd = max(-dir.z, 0.05);
  vec2 p = dir.xy / fwd;
  float audio = clamp(zotoVizSlots[0].y, 0.0, 1.0);
  vec3 col = mix(vec3(0.02, 0.025, 0.05), vec3(0.07, 0.06, 0.12), clamp(0.5 + p.y, 0.0, 1.0));
  for (int i = 0; i < 16; i++) {
    float rate = clamp(tsF(64 + i * 4 + 3), 0.0, 1.0);
    if (rate <= 0.001) continue;
    vec2 c = vec2(tsF(64 + i * 4), tsF(64 + i * 4 + 1));
    float hue = tsF(64 + i * 4 + 2);
    vec2 q = p - c;
    float r = length(q);
    float rad = 0.08 + 0.22 * rate;
    float spin = atan(q.y, q.x) + 2.2 * log(r + 0.02) - uTime * (0.8 + 2.0 * rate) + float(i) * 1.3;
    float arms = pow(0.5 + 0.5 * cos(3.0 * spin), 3.0);
    float body = exp(-r / rad);
    float eye = smoothstep(0.0, rad * 0.25, r);
    col += tsHue(hue) * (arms * body * eye * (0.5 + rate + 0.5 * audio) + 0.18 * body);
  }
  fragColor = vec4(col * uBright, uOpacity);
}
