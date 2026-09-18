float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 tileCol(float n) {
  if (n < 0.25) return vec3(0.95, 0.18, 0.52);
  if (n < 0.5) return vec3(0.12, 0.82, 0.95);
  if (n < 0.75) return vec3(0.98, 0.82, 0.16);
  return vec3(0.28, 0.95, 0.42);
}

vec3 stereoPattern(float x, float y) {
  float tile = 13.0;
  vec2 id = floor(vec2(x, y) / tile);
  vec2 f = fract(vec2(x, y) / tile);
  float n = hash21(id);
  vec3 col = tileCol(n);
  float grain = hash21(vec2(x, y) * 0.31 + id);
  float rim = smoothstep(0.04, 0.18, min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y)));
  return col * (0.42 + 0.4 * grain + 0.28 * rim);
}

float sceneZ(vec2 p) {
  vec2 uv = (p - vec2(220.0, 200.0)) * vec2(0.00082, 0.00105);
  float t = uTime * 0.22;
  vec2 c = uv - vec2(0.18, 0.06);
  float ring = abs(length(c * vec2(1.2, 1.0)) - 0.3);
  float torus = 1.0 - smoothstep(0.0, 0.13, ring);
  float dome = pow(max(0.0, 1.0 - length(c) * 1.7), 1.7) * 0.5;
  float z = max(torus * 0.88, dome);
  z += 0.07 * sin(c.x * 7.0 + t) * sin(c.y * 6.0 - t * 0.8);
  for (int i = 0; i < 8; i++) {
    vec4 b = zotoVizSlots[i];
    float fi = float(i);
    vec2 idle = vec2(sin(t * 0.45 + fi * 1.2), cos(t * 0.34 + fi * 0.9)) * 0.26;
    vec2 pos = mix(idle, b.xy * 0.42, step(0.02, length(b.xy)));
    float rad = max(0.11, b.z);
    float bump = 1.0 - smoothstep(0.0, rad * 1.9, length(c - pos));
    z = max(z, bump * (0.52 + rad * 0.9));
  }
  return clamp(z + uAudio * 0.1, 0.0, 1.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  float x = fc.x;
  float y = fc.y;
  for (int i = 0; i < 22; i++) {
    float z = sceneZ(vec2(x, y));
    float sep = mix(108.0, 54.0, z);
    x -= sep;
    if (x < 0.0) break;
  }
  vec3 col = stereoPattern(x, y);
  vec2 hintA = vec2(640.0, 1040.0);
  vec2 hintB = hintA + vec2(108.0, 0.0);
  float dots = max(
    1.0 - smoothstep(4.5, 7.5, length(fc - hintA)),
    1.0 - smoothstep(4.5, 7.5, length(fc - hintB))
  );
  col = mix(col, vec3(1.0, 0.98, 0.9), dots);
  col *= max(uBright, 0.9);
  fragColor = vec4(col, 1.0);
}
