// Magic Eye autostereogram. The host builds each frame's scene once on the CPU
// (frontend/frame.ts: the eight shipped objects, the audio rack, AI scenes) and
// passes it here as world-space parts. This shader only finds depth along each
// row and draws the pattern; building parts per pixel cost about 8 ms of GPU a
// frame and an 8 s compile on an RTX 4090.
//
// Parts are analytic capsules, spheres, dents and blocks seen by an orthographic
// eye. The room's stereo phase is integrated along the row, so the background
// needs no chain; only pixels on a part walk their stereo link. That keeps a
// moving object from copying itself into every strip to its right.
//
// Units are view-tangent coordinates from vDir, so the picture scales with the
// pane and stays locked to the screen.

const float NEAR_RATIO = .54; // how far the nearest surface sits in front of the far wall, as a fraction of one repeat
const float BG_NEAR = .4;   // the room's nearest walls, in depth units
const float Z_RANGE = .6;   // part z per depth unit; frame.ts uses the same
const float RELIEF = 1.4;   // stereograms read flat; push surfaces out toward the eye (frame.ts too)
const float X0 = -1.6;      // left end of the room phase integral
const int PARTS = 48;
// Buffer slots 1–6: part i is A = vec4 16 + 2i, B = vec4 17 + 2i.
//   capsule, ball or dent  A = (a, radius)                    B = (b, bulge; < 0 is a dent)
//   block                  A = (centre, screen half-width)     B = (half size, 4)
const int PART0 = 16;
// Buffer slot 7: (parts, room A, room B, room mix), (fine, palette A, palette B,
// palette mix), (repeat in view units, bands per repeat, band multiplier, 0).
const int HEAD = 112;

int NP;
float ROWY;
float XMIN;
float XMAX;
uint ROW_LO;  // parts 0–31 that cross this row
uint ROW_HI;  // parts 32–47
int ROOM_A;
int ROOM_B;
float ROOM_MIX;
float SFAR;   // pattern repeat: separation at the far wall, view units
float SNEAR;  // separation at depth 1
float BANDS;  // colour bands per repeat
float FINE_X; // band multiplier around bursts of motion
mat3 ISO;     // the one three-quarter view every block is seen from (frame.ts matches)
vec3 ISO_D;   // the eye ray in block space

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }

vec4 partA(int i) { return zotoVizSlots[PART0 + 2 * i]; }
vec4 partB(int i) { return zotoVizSlots[PART0 + 2 * i + 1]; }

bool onRow(int i) {
  return i < 32 ? (ROW_LO & (1u << uint(i))) != 0u : (ROW_HI & (1u << uint(i - 32))) != 0u;
}

// Mark the parts this row crosses and the x span of the solid ones.
void cullRow() {
  ROW_LO = 0u;
  ROW_HI = 0u;
  XMIN = 1e4;
  XMAX = -1e4;
  vec3 isoY = abs(vec3(ISO[0].y, ISO[1].y, ISO[2].y));
  for (int i = 0; i < PARTS; i++) {
    if (i >= NP) break;
    vec4 A = partA(i);
    vec4 B = partB(i);
    bool block = B.w > 3.;
    float ey = block ? dot(isoY, B.xyz) : 0.;
    float lo = block ? A.y - ey : min(A.y, B.y) - A.w;
    float hi = block ? A.y + ey : max(A.y, B.y) + A.w;
    if (ROWY < lo || ROWY > hi) continue;
    if (i < 32) ROW_LO |= 1u << uint(i);
    else ROW_HI |= 1u << uint(i - 32);
    if (B.w < 0.) continue;
    XMIN = min(XMIN, block ? A.x - A.w : min(A.x, B.x) - A.w);
    XMAX = max(XMAX, block ? A.x + A.w : max(A.x, B.x) + A.w);
  }
}

// A thin rim fades into the room so a hard depth step does not tear an outline.
// A wide rim shears the pattern into a soft halo beside the form.
float depthAt(float x) {
  vec2 p = vec2(x, ROWY);
  float z = 0.;
  for (int i = 0; i < PARTS; i++) {
    if (i >= NP) break;
    if (!onRow(i)) continue;
    vec4 A = partA(i);
    vec4 B = partB(i);
    // Block: the eye ray meets it in block space; the near face is the far end
    // of the slab overlap.
    if (B.w > 3.) {
      vec3 o = vec3(p - A.xy, 0.) * ISO;
      vec3 t1 = (-B.xyz - o) / ISO_D;
      vec3 t2 = (B.xyz - o) / ISO_D;
      vec3 tn = min(t1, t2);
      vec3 tf = max(t1, t2);
      float t0 = max(max(tn.x, tn.y), tn.z);
      float t3 = min(min(tf.x, tf.y), tf.z);
      if (t3 > t0) z = max(z, (A.z + t3) * smoothstep(0., .02, t3 - t0));
      continue;
    }
    vec2 pa = p - A.xy;
    vec2 ba = B.xy - A.xy;
    float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.);
    vec2 d = pa - ba * k;
    float h = A.w * A.w - dot(d, d);
    if (h <= 0.) continue;
    float s = sqrt(h);
    float c = mix(A.z, B.z, k);
    if (B.w >= 0.) z = max(z, (c + s * B.w * RELIEF) * smoothstep(0., .22 * A.w, s));
    else if (z > c - s && z < c + s) z = c - s;
  }
  return z;
}

// Exact x range of part i on this row (x > y when it misses): the end disks
// plus the band between them. The chain seam sits on the true silhouette, not
// on a bounding box to its right.
vec2 partRow(int i) {
  vec4 A = partA(i);
  vec4 B = partB(i);
  if (B.w > 3.) return vec2(A.x - A.w, A.x + A.w);
  float r = A.w;
  vec2 lr = vec2(1e4, -1e4);
  float ya = ROWY - A.y;
  float yb = ROWY - B.y;
  if (abs(ya) < r) { float h = sqrt(r * r - ya * ya); lr = vec2(min(lr.x, A.x - h), max(lr.y, A.x + h)); }
  if (abs(yb) < r) { float h = sqrt(r * r - yb * yb); lr = vec2(min(lr.x, B.x - h), max(lr.y, B.x + h)); }
  vec2 d = B.xy - A.xy;
  float L = length(d);
  if (L < 1e-5) return lr;
  vec2 n = vec2(-d.y, d.x) / L;
  if (abs(n.y) < 1e-4) {
    if (ya * yb <= 0.) lr = vec2(min(lr.x, min(A.x, B.x) - r), max(lr.y, max(A.x, B.x) + r));
  } else if (abs(d.y) < 1e-6) {
    if (abs(ya) <= r) lr = vec2(min(lr.x, min(A.x, B.x)), max(lr.y, max(A.x, B.x)));
  } else {
    // Along the band the row fixes the offset t = (ya - k d.y) / n.y, |t| <= r.
    float ka = (ya - r * abs(n.y)) / d.y;
    float kb = (ya + r * abs(n.y)) / d.y;
    if (max(ka, kb) >= 0. && min(ka, kb) <= 1.) {
      float k0 = clamp(min(ka, kb), 0., 1.);
      float k1 = clamp(max(ka, kb), 0., 1.);
      float x0 = A.x + k0 * d.x + (ya - k0 * d.y) / n.y * n.x;
      float x1 = A.x + k1 * d.x + (ya - k1 * d.y) / n.y * n.x;
      lr = vec2(min(lr.x, min(x0, x1)), max(lr.y, max(x0, x1)));
    }
  }
  return lr;
}

// Left end of the run of parts under x on this row, or 1e4 off every part.
// Gaps under one repeat join the run so they stay in stereo; a wider gap is
// plain room, so it holds still while the parts either side of it move.
float runStart(float x) {
  float lo = 1e4;
  for (int i = 0; i < PARTS; i++) {
    if (i >= NP) break;
    if (!onRow(i) || partB(i).w < 0.) continue;
    vec2 s = partRow(i);
    if (s.x <= x && x <= s.y) lo = min(lo, s.x);
  }
  if (lo > x) return 1e4;
  for (int k = 0; k < 4; k++) {
    float next = lo;
    for (int i = 0; i < PARTS; i++) {
      if (i >= NP) break;
      if (!onRow(i) || partB(i).w < 0.) continue;
      vec2 s = partRow(i);
      if (s.x <= s.y && s.x < next && s.y >= lo - SFAR) next = s.x;
    }
    if (next >= lo) break;
    lo = next;
  }
  return lo;
}

// Concave room seen from inside, depth 0 (far centre) to 1 (walls at the edge
// of view): a sphere, a box, a cylinder, a tunnel; 4 is a flat wall. Kept smooth
// so the phase integral stays accurate.
float roomShape(vec2 q, int k) {
  if (k == 4) return 0.;
  if (k == 0) return 1. - sqrt(max(.05, 1. - dot(q, q) / 1.1));
  if (k == 1) {
    vec2 e = max(abs(q) - vec2(.35, .2), 0.);
    vec2 e2 = e * e;
    return smoothstep(0., .4, sqrt(sqrt(dot(e2, e2))));
  }
  if (k == 2) return 1. - sqrt(max(.05, 1. - q.x * q.x));
  return smoothstep(.05, 1., length(q * vec2(.8, 1.2)));
}

float roomAt(vec2 q) {
  float z = roomShape(q, ROOM_A);
  if (ROOM_MIX > 0.) z = mix(z, roomShape(q, ROOM_B), ROOM_MIX);
  return BG_NEAR * z;
}

// Far wall (z = 0) is one repeat, SFAR. Closer surfaces are a wider repeat.
// A tighter repeat comes forward for some eyes and reads as a hole for these;
// widening it brings the form out of the screen.
float sepAt(float z) { return mix(SFAR, 2. * SFAR - SNEAR, clamp(z, 0., 1.)); }

// Repeats counted from X0 along this row (Simpson's rule). Any two points one
// separation apart differ by one whole repeat, which is the stereo constraint.
float roomPhase(float x) {
  float h = (x - X0) / 16.;
  float acc = 0.;
  for (int i = 0; i <= 16; i++) {
    float w = i == 0 || i == 16 ? 1. : (i % 2 == 1 ? 4. : 2.);
    acc += w / sepAt(roomAt(vec2(X0 + h * float(i), ROWY)));
  }
  return acc * h / 3.;
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * .1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float loopNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1., period);
  return mix(mix(hash12(vec2(x0, i.y)), hash12(vec2(x1, i.y)), f.x),
    mix(hash12(vec2(x0, i.y + 1.)), hash12(vec2(x1, i.y + 1.)), f.x), f.y);
}

// Cosine palettes a + b cos(2pi (c h + d)); the first is the original rainbow.
const vec3 PAL[28] = vec3[28](
  vec3(.5), vec3(.5), vec3(1.), vec3(0., .33, .67),
  vec3(.5), vec3(.5), vec3(1.), vec3(0., .1, .2),
  vec3(.5), vec3(.5), vec3(1.), vec3(.3, .2, .2),
  vec3(.5), vec3(.5), vec3(1., 1., .5), vec3(.8, .9, .3),
  vec3(.5), vec3(.5), vec3(1., .7, .4), vec3(0., .15, .2),
  vec3(.5), vec3(.5), vec3(2., 1., 0.), vec3(.5, .2, .25),
  vec3(.8, .5, .4), vec3(.2, .4, .2), vec3(2., 1., 1.), vec3(0., .25, .25)
);

vec3 pal(int i, float h) {
  return PAL[i * 4] + PAL[i * 4 + 1] * cos(6.2831 * (PAL[i * 4 + 2] * h + PAL[i * 4 + 3]));
}

// w is 0..1 across one repeat and must wrap cleanly at 1, so band counts are whole.
vec3 pattern(float w, float y, float px, int pa, int pb, float ps, float bands) {
  float cell = 2. * px;
  float grain = hash12(vec2(floor(w * max(8., floor(SFAR / cell))), floor(y / cell)));
  float b2 = floor(bands * 2.3);
  float hue = loopNoise(vec2(w * bands, y * 1.6 * bands), bands)
    + .4 * loopNoise(vec2(w * b2, y * 3.8 * bands + 11.), b2);
  return mix(mix(pal(pa, hue), pal(pb, hue), ps), uAccent, .2) * (.25 + .6 * grain);
}

// Whole band counts cannot sweep, so finer bands cross-fade in.
vec3 field(float w, float y, float px, int pa, int pb, float ps, float fine) {
  vec3 col = pattern(w, y, px, pa, pb, ps, BANDS);
  if (fine > 0.) col = mix(col, pattern(w, y, px, pa, pb, ps, floor(BANDS * FINE_X)), fine);
  return col;
}

void main() {
  vec3 d = normalize(vDir);
  vec2 p = d.xy / max(-d.z, 1e-3);
  float px = max(abs(dFdx(p.x)), 1e-5);
  vec4 h0 = zotoVizSlots[HEAD];
  vec4 h1 = zotoVizSlots[HEAD + 1];
  vec4 h2 = zotoVizSlots[HEAD + 2];
  // Until the host writes a frame: an empty sphere room at the default pattern.
  bool live = h2.x > 0.;
  SFAR = live ? h2.x : .0832;
  SNEAR = SFAR * NEAR_RATIO;
  BANDS = live ? h2.y : 14.;
  FINE_X = live ? h2.z : 2.;
  NP = live ? min(int(h0.x + .5), PARTS) : 0;
  ROOM_A = int(h0.y + .5);
  ROOM_B = int(h0.z + .5);
  ROOM_MIX = h0.w;
  ISO = rotX(.35) * rotY(-.6);
  ISO_D = vec3(0., 0., 1.) * ISO;
  ROWY = p.y;
  cullRow();

  // Chain only across the run of parts under this pixel. A closer part takes
  // a wider step than the wall, so the fused form sits in front of the room.
  float x = p.x;
  float lo = x >= XMIN && x <= XMAX ? runStart(x) : 1e4;
  for (int k = 0; k < 64; k++) {
    if (x < lo) break;
    x -= sepAt(max(roomAt(vec2(x, ROWY)), depthAt(x) / Z_RANGE));
  }

  int pa = int(clamp(h1.y + .5, 0., 6.));
  int pb = int(clamp(h1.z + .5, 0., 6.));
  vec3 col = field(fract(roomPhase(x)), p.y, px, pa, pb, h1.w, h1.x);
  float r = length(vec2(abs(p.x) - .5 * SFAR, p.y - .43));
  col = mix(col, vec3(1., .97, .9), 1. - smoothstep(3.5 * px, 5.5 * px, r));
  fragColor = vec4(col * clamp(uBright, .7, 1.35), 1.);
}
