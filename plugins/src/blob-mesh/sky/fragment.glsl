// Lumen Reef. Devices are bioluminescent cells in a deep-water tank; traffic grows membrane
// bridges that merge the cells (smooth-union SDF) and carry light pulses. 2D SDF per pixel: at most
// 8 cells and 16 bridges, no raymarch, no textures.
//
// Palette (Munsell, "analogous + complement" template): water 5B 2/4, wired cells 10BG 7/8,
// Wi-Fi cells 5PB 6/8, Bluetooth cells 5P 6/8, nuclei and traffic pulses the complement 5YR 8/6.
//
// Slots: 0 = host anchors (x, y, r, hue), always present; 1 = reef cells (x, y, r, kind) then
// (alive, glow, seed, stretch); 2 = bridges (a, b, strength, kind); 3 = meta (sim live, demo, n).
// With no sim (no sandbox) the sky animates the slot 0 anchors itself; with nothing at all it
// draws a demo reef.

// #193: the writers keep lattice neighbours r1 + r2 + BLOB_GAP apart (plugins/sdk BLOB_MESH_GAP);
// membranes only merge inside this reach, or through a traffic bridge.
const float BLOB_GAP = 0.12;

const vec3 WATER = vec3(0.055, 0.180, 0.235);   // 5B 2/4
const vec3 NETWORK = vec3(0.300, 0.780, 0.715); // 10BG 7/8
const vec3 WIFI = vec3(0.455, 0.600, 0.920);    // 5PB 6/8
const vec3 BLUE_T = vec3(0.660, 0.520, 0.860);  // 5P 6/8
const vec3 GLOWC = vec3(1.000, 0.760, 0.560);   // 5YR 8/6

vec3 kindColor(float k) {
  return k < 0.5 ? NETWORK : (k < 1.5 ? WIFI : BLUE_T);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Cell i in screen units (y spans -1..1, x spans the pane's aspect).
void cellAt(int i, float aspect, bool sim, float live, float t, out vec2 c, out float r, out float kind, out float alive, out float glow, out float seed, out float stretch) {
  if (sim) {
    vec4 a = zotoVizSlots[16 + i];
    vec4 b = zotoVizSlots[24 + i];
    c = a.xy; r = a.z; kind = a.w; alive = b.x; glow = b.y; seed = b.z; stretch = b.w;
  } else {
    vec4 b = zotoVizSlots[i];
    seed = fract(float(i) * 0.618 + 0.13);
    if (live > 0.5) {
      // #174: once any device is written, empty slots draw nothing (idle cells only fill a tile with no data).
      float drawn = max(step(0.001, b.z), 1.0 - live);
      float rad = max(0.12, b.z) * drawn;
      c = clamp(b.xy * 1.79, -1.0, 1.0); r = rad; alive = drawn;
    } else {
      // Demo reef: seven cells on an ellipse, mixed connection types.
      float a = float(i) * 0.897 + 0.4;
      c = vec2(cos(a) * 0.8, sin(a) * 0.55) * step(0.5, float(i)); r = i == 0 ? 0.3 : 0.15 + 0.03 * float(i % 3);
      alive = step(float(i), 6.5);
    }
    kind = mod(float(i), 3.0);
    glow = 0.5;
    // Stateless drift: the same slow wander the sim's springs follow.
    float w = t * (0.6 - 0.12 * kind) + seed * 6.283;
    c += vec2(sin(w), cos(w * 0.83)) * (0.08 + 0.05 * kind);
    stretch = 0.0;
  }
  c *= vec2(max(0.6, aspect - 0.3), 0.74);
  r = (0.10 + r * 0.95) * alive;
}

void main() {
  // vDir is the camera-local ray (the host gives the sky the camera's pose, so the view looks along z).
  // Project it onto the image plane and normalise by the per-pixel step, so the reef fills the
  // pane at any aspect (5120x1440 down to a small mosaic tile) and ignores camera orbit.
  vec3 ray = normalize(vDir);
  vec2 s = ray.xy / max(1e-3, abs(ray.z));
  // Without a host resolution (offline probes) assume the app lens: ~0.42 half-height, 16:10.
  bool hasRes = uResolution.x > 2.0 && uResolution.y > 2.0;
  float halfY = hasRes ? abs(dFdy(s.y)) * uResolution.y * 0.5 : 0.42;
  float halfX = hasRes ? abs(dFdx(s.x)) * uResolution.x * 0.5 : 0.672;
  halfY = halfY > 1e-4 ? halfY : 0.42;
  float aspect = halfX > 1e-4 ? clamp(halfX / halfY, 0.3, 6.0) : 1.6;
  vec2 p = s / halfY;
  float t = uTime;
  bool sim = zotoVizSlots[48].x > 0.5;
  float live = 0.0;
  for (int i = 0; i < 8; i++) live = max(live, step(0.001, zotoVizSlots[i].z));

  // Water: depth gradient, slow caustics and drifting marine snow.
  vec3 col = WATER * (0.85 + 0.35 * clamp(0.5 + 0.5 * p.y, 0.0, 1.0));
  float ca = sin(p.x * 3.1 + t * 0.21 + sin(p.y * 2.3 - t * 0.17)) * sin(p.y * 2.7 - t * 0.19 + sin(p.x * 1.9 + t * 0.13));
  col += vec3(0.05, 0.11, 0.12) * smoothstep(0.35, 1.0, ca);
  vec2 g = p * 9.0 + vec2(t * 0.05, t * 0.11);
  vec2 gi = floor(g);
  float h = hash21(gi);
  vec2 gf = fract(g) - 0.5 - 0.3 * vec2(sin(t * 0.3 + h * 6.0), cos(t * 0.25 + h * 5.0));
  col += vec3(0.35, 0.55, 0.6) * smoothstep(0.06, 0.0, length(gf)) * step(0.82, h) * 0.5;

  // Membrane field: smooth union of cells and bridges.
  float d = 1e3;
  float inner = 0.0;
  vec3 body = vec3(0.0);
  float wsum = 0.0;
  float nuclei = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 c; float r; float kind; float alive; float glow; float seed; float stretch;
    cellAt(i, aspect, sim, live, t, c, r, kind, alive, glow, seed, stretch);
    if (r < 0.105 || alive < 0.01) continue;
    vec2 q = p - c;
    float ang = atan(q.y, q.x);
    // Living membrane: slow travelling ripples, softer for Bluetooth, tighter for wired.
    float amp = 0.035 + 0.02 * kind;
    float wob = amp * sin(3.0 * ang + t * (0.9 - 0.15 * kind) + seed * 9.0)
              + 0.6 * amp * sin(5.0 * ang - t * (1.25 - 0.2 * kind) + seed * 4.0)
              + 0.4 * amp * sin(2.0 * ang + t * 0.45 + seed * 2.0);
    float breathe = 1.0 + 0.05 * sin(t * (0.7 + 0.2 * seed) + seed * 6.283) + 0.06 * uAudio;
    float rr = r * breathe * (1.0 + wob) * (1.0 + stretch * cos(2.0 * ang));
    float dc = length(q) - rr;
    d = smin(d, dc, BLOB_GAP + 0.04);
    float w = exp(-max(dc, 0.0) * 9.0);
    body += kindColor(kind) * w;
    wsum += w;
    // Nucleus and two organelles orbiting inside the cell.
    float sp = 0.35 + 0.25 * glow;
    vec2 n0 = vec2(cos(t * sp * 0.6 + seed * 6.283), sin(t * sp * 0.5 + seed * 4.0)) * r * 0.28;
    nuclei += (0.55 + 0.6 * glow) * exp(-dot(q - n0, q - n0) / (r * r * 0.045)) * alive;
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      vec2 o = vec2(cos(t * (0.8 + fk * 0.3) + seed * 11.0 + fk * 2.4), sin(t * (0.7 + fk * 0.4) + seed * 7.0 + fk)) * r * 0.55;
      nuclei += 0.35 * exp(-dot(q - o, q - o) / (r * r * 0.008)) * alive;
    }
    inner = max(inner, alive * smoothstep(0.0, -r * 0.8, dc));
  }
  float pulses = 0.0;
  if (sim) {
    int nb = int(zotoVizSlots[48].z + 0.5);
    for (int j = 0; j < 16; j++) {
      if (j >= nb) break;
      vec4 b = zotoVizSlots[32 + j];
      if (b.z < 0.01) continue;
      vec2 ca2; float ra; float ka; float aa; float ga; float sa; float sta;
      vec2 cb; float rb; float kb; float ab; float gb; float sb; float stb;
      cellAt(int(b.x + 0.5), aspect, sim, live, t, ca2, ra, ka, aa, ga, sa, sta);
      cellAt(int(b.y + 0.5), aspect, sim, live, t, cb, rb, kb, ab, gb, sb, stb);
      vec2 ab2 = cb - ca2;
      float hh = clamp(dot(p - ca2, ab2) / max(1e-4, dot(ab2, ab2)), 0.0, 1.0);
      // A bridge sags gently and sways at its type's pace.
      vec2 nrm = normalize(vec2(-ab2.y, ab2.x) + 1e-5);
      vec2 on = ca2 + ab2 * hh + nrm * sin(hh * 3.14159) * 0.06 * sin(t * (0.5 - 0.1 * b.w) + b.x * 1.3 + b.y);
      float thick = (0.025 + 0.06 * b.z) * (0.75 + 0.25 * cos((hh - 0.5) * 6.283)) * min(ra, rb) * 3.0;
      float db = length(p - on) - thick;
      d = smin(d, db, 0.12 * b.z + 0.02);
      body += kindColor(b.w) * exp(-max(db, 0.0) * 9.0) * b.z;
      wsum += exp(-max(db, 0.0) * 9.0) * b.z;
      // Light pulses travel along the bridge, faster with more traffic.
      float ph = fract(hh * 2.0 - t * (0.15 + 0.35 * b.z) + b.x * 0.37);
      pulses += b.z * exp(-pow((ph - 0.5) * 9.0, 2.0)) * exp(-max(db + thick, 0.0) * 40.0);
    }
  }
  vec3 tint = wsum > 1e-4 ? body / wsum : NETWORK;
  float edge = exp(-abs(d) * 34.0);       // bright bioluminescent membrane
  float halo = exp(-max(d, 0.0) * 6.0);   // soft glow into the water
  float fill = smoothstep(0.02, -0.06, d); // translucent cytoplasm
  col = mix(col, tint * 0.42 + WATER * 0.3, fill * 0.85);
  col += tint * (0.22 * halo + 0.85 * edge);
  col += tint * 0.18 * inner;
  col += GLOWC * (0.55 * nuclei * fill + 0.9 * pulses);
  col *= 0.92 + 0.08 * sin(t * 0.3);
  fragColor = vec4(min(col, vec3(0.96)) * uBright, uOpacity);
}
