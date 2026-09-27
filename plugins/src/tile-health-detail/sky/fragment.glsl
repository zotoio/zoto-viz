void main() {
  vec3 dir = normalize(vDir);
  float n = sin(40.0 * dir.x + 37.0 * dir.y) * sin(22.0 * dir.z + uTime);
  float v = 0.08 + 0.12 * (0.5 + 0.5 * n);
  fragColor = vec4(vec3(v * 0.4, v * 0.55, v * 0.9) * uBright, uOpacity);
}
