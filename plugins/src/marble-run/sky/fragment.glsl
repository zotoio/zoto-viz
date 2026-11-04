// Marble Run — the workshop behind the run. The track and marbles are host meshes
// (assets/marble-track.glb + instanced glass); this sky is only the room: a warm
// walnut-dark wall with a soft overhead pool of light that breathes with the bell.

float slot(int i) {
  vec4 v = zotoVizSlots[i >> 2];
  int c = i & 3;
  return c == 0 ? v.x : c == 1 ? v.y : c == 2 ? v.z : v.w;
}

void main() {
  vec3 dir = normalize(vDir);
  float bell = slot(9);
  // vertical falloff: a lit wall fading to a dark floor and ceiling
  float h = dir.y;
  vec3 wall = mix(vec3(0.045, 0.038, 0.034), uBg * 0.55 + vec3(0.045, 0.036, 0.028), smoothstep(-0.35, 0.25, h));
  wall = mix(wall, vec3(0.02, 0.02, 0.025), smoothstep(0.35, 0.9, h));
  // overhead lamp pool
  float pool = exp(-pow(length(vec2(dir.x * 0.9, h - 0.12)) * 2.2, 2.0));
  wall += pool * (0.06 + bell * 0.05 + uAudio * 0.03) * vec3(1.0, 0.82, 0.6);
  // teal accent wash low on the left (Munsell complement of the 7.5YR walnut)
  wall += exp(-pow(length(vec2(dir.x + 0.7, h + 0.25)) * 2.5, 2.0)) * 0.012 * vec3(0.2, 0.55, 0.58);
  // fine grain so the 5120-wide wall never bands
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  wall += (n - 0.5) / 255.0;
  fragColor = vec4(wall * uBright, uOpacity);
}
