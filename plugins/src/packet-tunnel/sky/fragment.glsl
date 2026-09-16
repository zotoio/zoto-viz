void main() {
  vec3 dir = normalize(vDir);
  float tunnel = 0.5 + 0.5 * sin(8.0 * dir.x + uTime * 0.6);
  float depth = 0.5 + 0.5 * dir.z;
  vec3 col = mix(uBg, uAccent, tunnel * depth);
  fragColor = vec4(col * uBright, uOpacity);
}
