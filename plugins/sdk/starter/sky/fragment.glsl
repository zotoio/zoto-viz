void main() {
  vec3 dir = normalize(vDir);
  float bars = 0.0;
  for (int i = 0; i < 4; i++) {
    float h = zotoVizSlots[i / 4][mod(float(i), 4.0)];
    float x = float(i) * 0.22 - 0.33;
    bars += smoothstep(0.02, 0.0, abs(dir.x - x) - 0.04) * h;
  }
  float murk = zotoVizSlots[2][0];
  vec3 col = mix(uBg, uAccent, bars + murk * 0.35);
  col *= uBright;
  fragColor = vec4(col, uOpacity);
}
