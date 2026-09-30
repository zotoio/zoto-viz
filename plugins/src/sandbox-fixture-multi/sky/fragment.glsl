// Sandbox Fixture Multi: a tiny test sky so the board is not empty (#180).
// Visible brightness comes only from uBright, which frontend/module.js writes from fixture.js.
// The stripes below only shape it (0..1, no brightness of their own); slot 0 x is helper.js's
// pulse, which only sways the stripes.
void main() {
  vec3 dir = normalize(vDir);
  float stripes = 0.5 + 0.5 * sin(90.0 * dir.x + 70.0 * dir.y + uTime + 6.28318 * zotoVizSlots[0].x);
  vec3 tint = 0.5 + 0.5 * cos(6.28318 * (0.5 * dir.y + vec3(0.0, 0.33, 0.67)));
  fragColor = vec4(uBright * stripes * tint, uOpacity);
}
