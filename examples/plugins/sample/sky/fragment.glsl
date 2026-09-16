void main() {
  vec3 dir = normalize(vDir);
  vec3 col = mix(uBg, uAccent, 0.5 + 0.5 * dir.y);
  fragColor = vec4(col * uBright, uOpacity);
}
