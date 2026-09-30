// Reads host-preamble uniforms only: the GLSL side is clean.
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(uAccent * (0.5 + 0.5 * sin(dir.y * 4.0 + uTime)) * uBright, 1.0);
}
