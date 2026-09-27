void main() {
  vec3 dir = normalize(vDir);
  float g = 0.5 + 0.5 * dir.y;
  vec3 col = mix(uBg, uAccent, g);
  fragColor = vec4(col * uBright, uOpacity);
}
