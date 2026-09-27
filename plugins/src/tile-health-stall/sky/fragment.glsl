void main() {
  vec3 dir = normalize(vDir);
  float band = 0.5 + 0.5 * sin(12.0 * dir.x + uTime);
  vec3 col = mix(uBg, uAccent, band);
  fragColor = vec4(col * uBright, uOpacity);
}
