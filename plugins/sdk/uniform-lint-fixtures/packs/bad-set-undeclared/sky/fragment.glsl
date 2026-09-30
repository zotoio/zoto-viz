void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(mix(uBg, uAccent, 0.5 + 0.5 * dir.y) * uBright, uOpacity);
}
