void main() {
  vec3 dir = normalize(vDir);
  float lon = atan(dir.z, dir.x);
  float y = dir.y;
  vec3 col = uBg * 0.06;
  for (int i = 0; i < 8; i++) {
    float amp = max(0.42, zotoVizSlots[i].x);
    float phase = zotoVizSlots[i].y + float(i) * 0.73;
    float wave = sin(y * 11.0 + float(i) * 0.9 + uTime * (1.15 + amp * 0.55));
    float x = lon + wave * (0.18 + amp * 0.32);
    float cell = abs(fract((x * 0.15915 + 0.5 + phase * 0.12) * 14.0) - 0.5);
    float bar = (1.0 - smoothstep(0.0, 0.14, cell)) * (0.7 + amp * 0.55);
    vec3 copper = mix(vec3(0.42, 0.05, 0.02), vec3(1.0, 0.82, 0.28), 0.4 + 0.6 * sin(y * 3.2 + uTime * 0.45 + float(i)));
    col += mix(uAccent, copper, 0.72) * bar;
  }
  col += vec3(1.0, 0.52, 0.12) * pow(max(0.0, 0.28 - abs(y)), 1.6) * (0.75 + uAudio);
  fragColor = vec4(col * uBright, uOpacity);
}
