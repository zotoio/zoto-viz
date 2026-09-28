// Room behind the tank. The glass, gravel, plants, and fish are host meshes.

float slotF(int s, float fi) {
  float i = floor(fi) + float(s * 64);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

float hash31(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 roomWash(vec3 dir, float reef, float lightMode, float day, float murk, float fail) {
  float up = dir.y * 0.5 + 0.5;
  vec3 floorCol = mix(vec3(0.09, 0.08, 0.07), vec3(0.07, 0.09, 0.08), reef);
  vec3 ceilCol = vec3(0.62, 0.70, 0.76);
  if (lightMode > 1.5) ceilCol = vec3(0.16, 0.22, 0.38);
  else if (lightMode > 0.5) ceilCol = vec3(0.22, 0.32, 0.48);
  ceilCol = mix(ceilCol * 0.35, ceilCol, clamp(day, 0.0, 1.0));
  vec3 wall = mix(uBg, uAccent, 0.22);
  float wallMix = smoothstep(0.05, 0.42, up);
  vec3 col = mix(floorCol, mix(wall, ceilCol, smoothstep(0.38, 0.82, up)), wallMix);
  float grain = noise3(dir * 6.0 + vec3(0.0, uTime * 0.02, 0.0));
  col += (grain - 0.5) * 0.03;
  float window = exp(-pow((dir.x - 0.55) * 2.8, 2.0)) * smoothstep(-0.15, 0.35, dir.y);
  window *= 1.0 - smoothstep(0.15, 0.8, dir.z);
  vec3 lamp = lightMode > 0.5 ? vec3(0.55, 0.68, 0.95) : vec3(1.0, 0.93, 0.78);
  col += lamp * window * (0.42 + 0.08 * sin(uTime * 0.2));
  col = mix(col, vec3(0.04, 0.05, 0.05), clamp(murk, 0.0, 1.0) * 0.8);
  if (fail > 0.5) col = mix(col, vec3(0.32, 0.07, 0.05), 0.28);
  return col;
}

void main() {
  vec3 dir = normalize(vDir);
  float reef = slotF(0, 0.0);
  float lightMode = slotF(0, 1.0);
  float day = max(slotF(0, 2.0), 0.35);
  float murk = slotF(0, 5.0);
  float fail = slotF(0, 6.0);
  vec3 col = roomWash(dir, reef, lightMode, day, murk, fail) * uBright;
  fragColor = vec4(col, uOpacity);
}
