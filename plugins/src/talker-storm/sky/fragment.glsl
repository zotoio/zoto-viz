void main() {
  vec3 dir = normalize(vDir);
  float storm = 0.5 + 0.5 * sin(10.0 * dir.x * dir.y + uTime * 1.2);
  vec3 col = mix(vec3(0.05, 0.08, 0.14), vec3(0.9, 0.5, 0.2), storm * uAudio);
  fragColor = vec4(col * uBright, uOpacity);
}
