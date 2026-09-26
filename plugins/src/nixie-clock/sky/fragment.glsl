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

const uvec2 DIGIT[10] = uvec2[](
  uvec2(2736309806u, 3u), uvec2(2286031236u, 3u), uvec2(3493922350u, 7u),
  uvec2(2719155758u, 3u), uvec2(2247698626u, 0u), uvec2(2719021599u, 3u),
  uvec2(2736323086u, 3u), uvec2(276957247u, 2u), uvec2(2736211502u, 3u),
  uvec2(2197341742u, 3u)
);

float fontBit(int n, int fx, int fy) {
  if (fx < 0 || fy < 0 || fx > 4 || fy > 6) return 0.0;
  n = clamp(n, 0, 9);
  uint bit = uint(fy * 5 + fx);
  uvec2 g = DIGIT[n];
  uint on = bit < 32u ? ((g.x >> bit) & 1u) : ((g.y >> (bit - 32u)) & 1u);
  return float(on);
}

float glyph(int n, vec2 uv) {
  if (uv.x < -0.15 || uv.y < -0.15 || uv.x > 1.15 || uv.y > 1.15) return 0.0;
  vec2 p = vec2(uv.x * 5.0, (1.0 - uv.y) * 7.0);
  vec2 i = floor(p);
  vec2 f = fract(p);
  float s00 = fontBit(n, int(i.x), int(i.y));
  float s10 = fontBit(n, int(i.x) + 1, int(i.y));
  float s01 = fontBit(n, int(i.x), int(i.y) + 1);
  float s11 = fontBit(n, int(i.x) + 1, int(i.y) + 1);
  vec2 w = smoothstep(0.12, 0.88, f);
  return mix(mix(s00, s10, w.x), mix(s01, s11, w.x), w.y);
}

void main() {
  float packed = slot0(11.0);
  float showSec = packed > 64.0 ? slot0(7.0) : 1.0;
  float glow = packed > 64.0 ? max(0.35, slot0(8.0)) : 1.0;
  float flicker = packed > 64.0 ? clamp(slot0(9.0), 0.0, 1.0) : 0.2;
  float aud = max(uAudio, slot0(10.0));
  float pulse = slot0(14.0);
  float blink = packed > 64.0 ? slot0(6.0) : step(0.5, fract(uTime * 2.0));
  vec2 res = vec2(max(slot0(11.0), 8.0), max(slot0(12.0), 8.0));
  vec3 dir = normalize(vDir);
  vec2 uv;
  if (packed > 64.0) {
    uv = gl_FragCoord.xy / res;
  } else {
    uv = vec2(dir.x * 0.95 + 0.5, dir.y * 0.85 + 0.46);
  }

  float cells = showSec > 0.5 ? 6.0 : 4.0;
  float tubeW = 0.11;
  float gap = 0.016;
  float pairGap = 0.04;
  float span = cells * tubeW + (cells - 1.0) * gap + 2.0 * pairGap;
  float x0 = 0.5 - span * 0.5;
  float y0 = 0.34;
  float tubeH = 0.34;

  vec3 wood = vec3(0.05, 0.025, 0.015);
  float grain = 0.62 + 0.38 * sin(uv.x * 28.0 + sin(uv.y * 12.0) * 1.6);
  vec3 col = mix(uBg, wood, 0.9) * (0.28 + 0.4 * grain);
  col += vec3(0.22, 0.08, 0.02) * pow(1.0 - abs(uv.y - 0.5), 2.4) * 0.55;
  vec2 plate = (uv - vec2(0.5, 0.51)) / vec2(0.48, 0.22);
  float shelf = 1.0 - smoothstep(0.92, 1.15, length(plate * vec2(1.0, 1.15)));
  col = mix(col, vec3(0.09, 0.045, 0.02), shelf * 0.85);

  vec3 neon = mix(vec3(1.0, 0.32, 0.04), uAccent, 0.45);
  float shim = 1.0 - flicker * (0.08 + 0.14 * aud + 0.1 * pulse) * (0.5 + 0.5 * sin(uTime * 37.0 + gl_FragCoord.x * 0.04));

  float lit = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= cells) break;
    float pair = floor(float(i) * 0.5);
    float x = x0 + float(i) * (tubeW + gap) + pair * pairGap;
    vec2 local = vec2((uv.x - x) / tubeW, (uv.y - y0) / tubeH);
    vec2 q = local * 2.0 - 1.0;
    float capsule = length(vec2(q.x * 1.15, max(abs(q.y) - 0.72, 0.0))) - 0.28;
    float glass = 1.0 - smoothstep(-0.02, 0.08, capsule);
    if (glass < 0.01) continue;

    float digit = slot0(float(i));
    float hour12 = packed > 64.0 ? step(0.5, slot0(13.0)) : 0.0;
    if (packed < 64.0) {
      float sec = floor(mod(uTime, 86400.0));
      float hh = floor(sec / 3600.0);
      float mm = floor(mod(sec, 3600.0) / 60.0);
      float ss = mod(sec, 60.0);
      if (i == 0) digit = floor(hh / 10.0);
      else if (i == 1) digit = mod(hh, 10.0);
      else if (i == 2) digit = floor(mm / 10.0);
      else if (i == 3) digit = mod(mm, 10.0);
      else if (i == 4) digit = floor(ss / 10.0);
      else digit = mod(ss, 10.0);
      if (hour12 > 0.5 && i == 0 && digit < 1.0) digit = -1.0;
    }
    float ghosts = 0.0;
    float live = 0.0;
    if (digit >= 0.0) {
      for (int d = 0; d < 10; d++) {
        vec2 duv = (local - vec2(0.18, 0.16)) / vec2(0.64, 0.70);
        duv += vec2(float(d % 3) - 1.0, float(d / 3) - 1.5) * 0.012;
        float g = glyph(d, duv);
        ghosts += g * 0.07;
        if (abs(float(d) - digit) < 0.5) live = g;
      }
    }

    float mesh = 0.0;
    mesh += 0.12 * (1.0 - smoothstep(0.0, 0.03, abs(fract(local.x * 7.0) - 0.5)));
    mesh += 0.08 * (1.0 - smoothstep(0.0, 0.03, abs(fract(local.y * 11.0) - 0.5)));
    float rim = exp(-8.0 * abs(capsule + 0.02));
    float cap = smoothstep(0.08, 0.0, abs(abs(q.y) - 0.92)) * (1.0 - smoothstep(0.42, 0.62, abs(q.x)));
    vec3 brass = vec3(0.55, 0.32, 0.12);
    vec3 tube = mix(vec3(0.04, 0.02, 0.015), neon * 0.18, ghosts + mesh);
    tube += neon * live * (1.8 + glow * 1.4) * shim;
    tube += neon * live * glow * 1.1 * exp(-8.0 * length(q));
    tube += brass * cap * 1.35;
    tube += neon * (0.12 + live * 0.55) * rim * glow;
    float highlight = pow(max(0.0, 0.55 - q.x - 0.4 * q.y), 4.0) * glass;
    tube += vec3(0.9, 0.75, 0.45) * highlight * 0.35;
    col = mix(col, tube, glass * 0.96);
    lit += live * glass;
  }

  float colonX1 = x0 + 2.0 * (tubeW + gap) + 0.5 * pairGap - 0.008;
  float colonX2 = x0 + 4.0 * (tubeW + gap) + 1.5 * pairGap - 0.008;
  for (int c = 0; c < 2; c++) {
    if (c == 1 && showSec < 0.5) break;
    float cx = c == 0 ? colonX1 : colonX2;
    for (int k = 0; k < 2; k++) {
      vec2 dlt = (uv - vec2(cx, y0 + (k == 0 ? 0.10 : 0.18))) / vec2(0.01, 0.014);
      float dot = exp(-dot(dlt, dlt) * 3.2);
      col += neon * dot * (0.25 + 0.85 * blink) * glow * shim;
      lit += dot * blink;
    }
  }

  col += neon * lit * 0.08;
  col *= 0.55 + 0.45 * pow(1.0 - length((uv - vec2(0.5, 0.48)) * vec2(1.1, 1.3)), 1.4);
  fragColor = vec4(col * uBright, uOpacity);
}
