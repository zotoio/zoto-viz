void main() {
  vec3 dir = normalize(vDir);
  float v = 0.5 + 0.5 * sin(10.0 * dir.y + uTime * 0.8);
  fragColor = vec4(mix(uBg, uAccent, v) * uBright, uOpacity);
}
