void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(uBg * (0.5 + 0.5 * dir.y) * (1.0 + uAudio) * uRenderScale, 1.0);
}
