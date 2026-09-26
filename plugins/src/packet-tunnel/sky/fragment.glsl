void main() {
  vec3 dir = normalize(vDir);
  float tunnel = 0.5 + 0.5 * sin(8.0 * dir.x + uTime * 0.6);
  float depth = 0.5 + 0.5 * dir.z;
  float cost = zotoVizSlots[0].z;
  float acc = tunnel * depth;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= cost) break;
    acc += 0.0008 * sin(acc * 13.0 + float(i) * 0.17 + uTime);
  }
  vec3 col = mix(uBg, uAccent, clamp(acc, 0.0, 1.0));
  fragColor = vec4(col * uBright, uOpacity);
}
