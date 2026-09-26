void main() {
  vec3 dir = normalize(vDir);
  float bars = 0.0;
  for (int i = 0; i < 4; i++) {
    float h = zotoVizSlots[0][i];
    float x = float(i) * 0.22 - 0.33;
    bars += smoothstep(0.02, 0.0, abs(dir.x - x) - 0.04) * h;
  }
  float murk = zotoVizSlots[2][0];
  float pulse = 0.5 + 0.5 * sin(uTime * 1.4 + dir.y * 4.0);
  vec3 col = mix(uBg, uAccent, (bars + murk * 0.35) * (0.85 + 0.15 * pulse));
  col *= uBright;
  fragColor = vec4(col, uOpacity);
}
