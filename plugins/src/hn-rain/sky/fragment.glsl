float slot0(float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

const uvec2 FONT[59] = uvec2[](
  uvec2(0u,0u), uvec2(135300u,1u), uvec2(10570u,0u), uvec2(11512810u,0u),
  uvec2(524752836u,1u), uvec2(27070835u,0u), uvec2(2471564582u,5u), uvec2(2180u,0u),
  uvec2(136382600u,2u), uvec2(2290360450u,0u), uvec2(719469220u,1u), uvec2(139432064u,0u),
  uvec2(2285895680u,0u), uvec2(1015808u,0u), uvec2(0u,1u), uvec2(1118480u,0u),
  uvec2(2738546222u,3u), uvec2(2286031044u,3u), uvec2(3292807726u,7u), uvec2(3775349263u,3u),
  uvec2(301246856u,2u), uvec2(2735225919u,3u), uvec2(2736227404u,3u), uvec2(2216829471u,0u),
  uvec2(2736211502u,3u), uvec2(2433697326u,1u), uvec2(4194432u,0u), uvec2(2285895808u,0u),
  uvec2(136349832u,2u), uvec2(32537600u,0u), uvec2(2290622594u,0u), uvec2(4473390u,1u),
  uvec2(2212165166u,3u), uvec2(1663026734u,4u), uvec2(3809986095u,3u), uvec2(2718991918u,3u),
  uvec2(3810051631u,3u), uvec2(3256321087u,7u), uvec2(1108837439u,0u), uvec2(2736686638u,3u),
  uvec2(1663026737u,4u), uvec2(2286030990u,3u), uvec2(2458132764u,1u), uvec2(1381078321u,4u),
  uvec2(3255862305u,7u), uvec2(1662703473u,4u), uvec2(1662834289u,4u), uvec2(2736309806u,3u),
  uvec2(1108854319u,0u), uvec2(2472068654u,5u), uvec2(1381484079u,4u), uvec2(2735146542u,3u),
  uvec2(138547359u,1u), uvec2(2736309809u,3u), uvec2(353945137u,1u), uvec2(2874852913u,2u),
  uvec2(1654794801u,4u), uvec2(138553905u,1u), uvec2(3257016863u,7u)
);

float fontBit(int code, int fx, int fy) {
  if (fx < 0 || fy < 0 || fx > 4 || fy > 6) return 0.0;
  int i = clamp(code - 32, 0, 58);
  uint bit = uint(fy * 5 + fx);
  uvec2 g = FONT[i];
  uint on = bit < 32u ? ((g.x >> bit) & 1u) : ((g.y >> (bit - 32u)) & 1u);
  return float(on);
}

float glyph(int code, vec2 uv) {
  if (uv.x < -0.08 || uv.y < -0.08 || uv.x > 1.08 || uv.y > 1.08) return 0.0;
  vec2 p = vec2(uv.x * 5.0, (1.0 - uv.y) * 7.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float s00 = fontBit(code, int(i.x), int(i.y));
  float s10 = fontBit(code, int(i.x) + 1, int(i.y));
  float s01 = fontBit(code, int(i.x), int(i.y) + 1);
  float s11 = fontBit(code, int(i.x) + 1, int(i.y) + 1);
  vec2 w = smoothstep(0.12, 0.88, f);
  return mix(mix(s00, s10, w.x), mix(s01, s11, w.x), w.y);
}

int packedChar(float idx, int n) {
  if (n < 1) return 32;
  float fi = mod(idx, float(n));
  int code = int(slot0(4.0 + fi) * 95.0 + 0.5) + 32;
  if (code < 32 || code > 90) return 32;
  return code;
}

void main() {
  float n = max(1.0, slot0(1.0) * 60.0);
  int nChars = int(n + 0.5);
  float seed = slot0(0.0);
  float energy = slot0(2.0);
  float aud = max(uAudio, slot0(3.0));

  vec2 fc = gl_FragCoord.xy;
  float cw = 16.0;
  float rh = 22.0;
  float colId = floor(fc.x / cw);
  float rowId = floor(fc.y / rh);
  vec2 cell = vec2(fract(fc.x / cw), fract(fc.y / rh));
  float speed = 1.05 + energy * 1.1 + aud * 1.2 + fract(seed * 0.17 + colId * 0.13) * 0.7;
  float shift = uTime * speed + colId * 2.7 + seed * 3.0;
  float idx = colId * 5.0 + rowId - shift;
  int code = packedChar(idx, nChars);
  float bit = glyph(code, (cell - vec2(0.1, 0.08)) / vec2(0.8, 0.84));
  float fall = fract((rowId + shift) / 22.0);
  float head = smoothstep(0.28, 0.0, fall);
  float trail = pow(1.0 - fall, 1.55);
  vec3 phosphor = mix(vec3(0.02, 0.22, 0.06), vec3(0.28, 0.62, 0.28), head);
  vec3 col = vec3(0.0, 0.012, 0.006);
  col += phosphor * bit * (0.16 + trail * 0.42 + head * 0.85);

  col *= clamp(uBright, 0.45, 0.85);

  float crawlH = 44.0;
  float crawlY = 228.0;
  float crawlBand = smoothstep(crawlH * 0.62, crawlH * 0.22, abs(fc.y - crawlY));
  if (crawlBand > 0.0) {
    col *= 1.0 - crawlBand * 0.72;
    float cw2 = 26.0;
    float x = fc.x / cw2 + uTime * (2.4 + aud * 1.4);
    vec2 uv2 = vec2(fract(fc.x / cw2), (fc.y - (crawlY - crawlH * 0.5)) / crawlH);
    int big = packedChar(x, nChars);
    float g2 = glyph(big, (uv2 - vec2(0.06, 0.1)) / vec2(0.88, 0.8));
    float ink = smoothstep(0.18, 0.72, g2);
    col += mix(vec3(0.55, 0.95, 0.58), vec3(0.88, 1.0, 0.82), ink) * ink * 1.35 * crawlBand;
  }

  fragColor = vec4(col, max(uOpacity, 0.94));
}
