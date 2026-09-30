// #193: compact metaball falloff. Each blob's field is r^2/d^2 shifted and rescaled so it is
// exactly 1 at the blob's radius and exactly 0 at rad + 0.5 * BLOB_GAP, so two blobs whose centres
// are at least r1 + r2 + BLOB_GAP apart never touch (their merge distance). The iso threshold
// below is unchanged. 0.12 is UX Pro's pick, still provisional (must stay > 0: 0 divides by zero).
const float BLOB_GAP = 0.12;
// #174: the empty sky between and around blobs is a dim share of the accent (not black), so a
// sparse or quiet tile keeps a brightness step at every blob edge without dark patches. Revert
// check: 0.15 turns the dark-patch rows red (they go red from 0.17 down; 0.18 still passes).
const float SKY_FLOOR = 0.3;

void main() {
  // vDir is the camera-local ray (the host parents plugin skies to the camera),
  // so the view looks down -z and dir.xz/|dir.y| would sit far outside the blob
  // field. Tilt the ray by the host camera's default 45 degree pitch so the dome
  // projection frames the metaballs the way this sky was authored.
  vec3 cam = normalize(vDir);
  vec3 dir = normalize(vec3(cam.x, 0.70710678 * (cam.y + cam.z), 0.70710678 * (cam.z - cam.y)));
  vec2 uv = vec2(dir.x, dir.z) / (0.35 + abs(dir.y));
  float field = 0.0;
  vec3 tint = uAccent;
  // #174: once any device is written (radius > 0), empty slots draw nothing; the idle blobs
  // only fill a tile that has no device data yet.
  float live = 0.0;
  for (int i = 0; i < 8; i++) live = max(live, step(0.001, zotoVizSlots[i].z));
  for (int i = 0; i < 8; i++) {
    vec4 b = zotoVizSlots[i];
    float fi = float(i);
    vec2 idle = vec2(sin(uTime * 0.35 + fi * 1.1), cos(uTime * 0.28 + fi * 0.7)) * 0.55;
    vec2 pos = mix(idle, b.xy * 1.7, step(0.02, length(b.xy)));
    float drawn = max(step(0.001, b.z), 1.0 - live);
    float rad = max(0.12, b.z) * drawn;
    vec2 d = uv - pos;
    float reach = rad + 0.5 * BLOB_GAP;
    float edge = rad * rad / (reach * reach);
    float contrib = max(0.0, (rad * rad / max(0.0012, dot(d, d)) - edge) / (1.0 - edge));
    field += contrib;
    tint = mix(tint, mix(uAccent, vec3(0.15, 1.0, 0.72), max(b.w, fi / 8.0)), clamp(contrib * 0.12, 0.0, 0.4));
  }
  float iso = smoothstep(0.55, 1.25, field + 0.45 + uAudio * 0.3);
  vec3 col = mix(mix(uBg * 0.12, uAccent, SKY_FLOOR), tint, iso);
  col += tint * pow(clamp(field * 0.18, 0.0, 1.0), 2.4) * 0.7;
  col += vec3(0.2, 0.9, 1.0) * pow(max(0.0, 0.2 - abs(dir.y)), 2.0) * 0.5;
  fragColor = vec4(col * uBright, uOpacity);
}
