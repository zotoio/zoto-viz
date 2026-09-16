void main() {
  vec3 dir = normalize(vDir);
  float stars = 0.0;
  for (float i = 0.0; i < 6.0; i += 1.0) {
    float band = sin(dir.y * 12.0 + i * 1.7 + uTime * 0.3);
    stars += smoothstep(0.92, 1.0, band) * (0.6 + uAudio);
  }
  vec3 bloom = uAccent * stars;
  vec3 col = mix(uBg, bloom, 0.35 + uAudio * 0.4);
  fragColor = vec4(col, uOpacity);
}
