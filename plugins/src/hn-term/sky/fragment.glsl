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
  if (uv.x < -0.12 || uv.y < -0.12 || uv.x > 1.12 || uv.y > 1.12) return 0.0;
  vec2 p = vec2(uv.x * 5.0, (1.0 - uv.y) * 7.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float s00 = fontBit(code, int(i.x), int(i.y));
  float s10 = fontBit(code, int(i.x) + 1, int(i.y));
  float s01 = fontBit(code, int(i.x), int(i.y) + 1);
  float s11 = fontBit(code, int(i.x) + 1, int(i.y) + 1);
  vec2 w = smoothstep(0.08, 0.92, f);
  return mix(mix(s00, s10, w.x), mix(s01, s11, w.x), w.y);
}

int cellCode(int col, int row, int cols, int rows) {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return 32;
  float idx = 8.0 + float(row * cols + col);
  int code = int(slot0(idx) * 95.0 + 0.5) + 32;
  if (code < 32 || code > 126) return 32;
  return code;
}

void main() {
  float cols = max(8.0, slot0(0.0));
  float rows = max(4.0, slot0(1.0));
  float curX = slot0(2.0);
  float curY = slot0(3.0);
  float blink = slot0(4.0);
  float aud = max(uAudio, slot0(5.0));

  vec2 fc = gl_FragCoord.xy;
  float cw = 100.0;
  float rh = 190.0;
  float ox = 56.0;
  float oy = 80.0;
  float colF = (fc.x - ox) / cw;
  float rowF = (fc.y - oy) / rh;
  int col = int(floor(colF));
  int rowFromBottom = int(floor(rowF));
  int row = int(rows) - 1 - rowFromBottom;
  vec2 cell = vec2(fract(colF), fract(rowF));

  vec3 green = vec3(0.22, 0.95, 0.38);
  vec3 dim = vec3(0.02, 0.09, 0.03);
  vec3 colr = mix(vec3(0.0, 0.012, 0.004), dim, 0.55);
  float scan = 0.88 + 0.12 * sin(fc.y * 3.14159);
  float flicker = 0.97 + 0.03 * sin(uTime * 62.0 + fc.y * 0.15);
  float vignette = smoothstep(1.15, 0.35, length((fc - vec2(ox + cols * cw * 0.5, oy + rows * rh * 0.5)) / vec2(cols * cw, rows * rh)));

  bool inside = colF >= 0.0 && rowF >= 0.0 && colF < cols && rowF < rows;
  if (inside) {
    int code = cellCode(col, row, int(cols + 0.5), int(rows + 0.5));
    float bit = glyph(code, (cell - vec2(0.06, 0.1)) / vec2(0.88, 0.78));
    float ink = smoothstep(0.15, 0.72, bit);
    colr += green * ink * (1.55 + aud * 0.35);
    colr += green * 0.12 * (1.0 - ink);
    bool cursor = blink > 0.5 && col == int(curX + 0.5) && row == int(curY + 0.5);
    if (cursor) colr = mix(colr, green * 1.35, 0.85 * step(cell.x, 0.72) * step(cell.y, 0.82));
  }

  colr *= scan * flicker * (0.55 + 0.45 * vignette);
  colr *= max(uBright, 0.92);
  fragColor = vec4(colr, 1.0);
}
