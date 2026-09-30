// Reads uWobble, which neither this sky nor the host preamble declares: the GPU compile fails.
void main() {
  vec3 dir = normalize(vDir);
  float w = sin(dir.y * 8.0 + uTime) * uWobble;
  fragColor = vec4(uAccent * (0.5 + w) * uBright, uOpacity);
}
