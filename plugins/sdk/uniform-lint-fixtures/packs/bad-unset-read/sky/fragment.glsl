// Declares and reads uExtra, but the host only ever sets its preamble uniforms.
uniform float uExtra;
void main() {
  vec3 dir = normalize(vDir);
  fragColor = vec4(uAccent * (0.5 + 0.5 * dir.y) * uExtra, uOpacity);
}
