void main() {
  vec3 dir = normalize(vDir);
  float n = sin(30.0 * dir.x) * cos(25.0 * dir.y);
  float v = 0.1 + 0.15 * (0.5 + 0.5 * n);
  fragColor = vec4(vec3(v * 0.5, v * 0.6, v) * uBright, uOpacity);
}
