// Reads only host-preamble uniforms (plus a redundant preamble declaration the host strips).
uniform float uTime;
float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}
void main() {
  vec3 dir = normalize(vDir);
  vec2 px = gl_FragCoord.xy / uResolution;
  float uLocal = slot(0) * uRenderScale; // local, not a uniform
  fragColor = vec4(mix(uBg, uAccent, px.y + uLocal * 0.0 + uAudio * 0.0 + sin(uTime) * 0.0) * uBright, uOpacity);
}
