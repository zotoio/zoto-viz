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

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
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

vec3 koiPatternCol(float sp, float vig) {
  float s = floor(sp + 0.01);
  vec3 c = vec3(0.95, 0.35, 0.28);
  if (s < 0.5) c = vec3(0.98, 0.92, 0.88);
  else if (s < 1.5) c = vec3(0.95, 0.55, 0.45);
  else if (s < 2.5) c = vec3(0.15, 0.12, 0.18);
  else if (s < 3.5) c = vec3(0.95, 0.78, 0.22);
  else if (s < 4.5) c = vec3(0.92, 0.2, 0.18);
  else c = vec3(0.45, 0.62, 0.78);
  return mix(c, c * 1.15, vig);
}

vec3 pondWater(vec2 xz, float clarity, float murk, float tint, float simTime) {
  float rip = noise3(vec3(xz * 3.5, simTime * 0.35));
  float rip2 = noise3(vec3(xz * 7.0 + 2.0, simTime * 0.55));
  vec3 deep = mix(vec3(0.02, 0.18, 0.22), vec3(0.05, 0.28, 0.32), tint);
  vec3 shallow = mix(vec3(0.08, 0.42, 0.38), vec3(0.12, 0.55, 0.48), tint);
  vec3 base = mix(deep, shallow, clarity * 0.85 + rip * 0.15);
  base = mix(base, vec3(0.12, 0.14, 0.1), murk * 0.75);
  base += vec3(0.02, 0.04, 0.03) * (rip2 - 0.5) * clarity;
  return base;
}

vec3 pondNormal(vec2 xz, float simTime) {
  float e = 0.015;
  float h = noise3(vec3(xz * 4.2, simTime * 0.4));
  float hx = noise3(vec3((xz + vec2(e, 0.0)) * 4.2, simTime * 0.4)) - h;
  float hz = noise3(vec3((xz + vec2(0.0, e)) * 4.2, simTime * 0.4)) - h;
  return normalize(vec3(-hx * 2.5, 1.0, -hz * 2.5));
}

float sdEllipse(vec2 p, vec2 r) {
  p /= r;
  return (length(p) - 1.0) * min(r.x, r.y);
}

void main() {
  float waterTint = slotF(0, 0.0);
  float clarity = slotF(0, 1.0);
  float murk = slotF(0, 2.0);
  float fail = slotF(0, 3.0);
  float lilyDens = slotF(0, 6.0);
  float lotusN = slotF(0, 7.0);
  float lotusCol = slotF(0, 8.0);
  float ripple = slotF(0, 10.0);
  float caustOn = slotF(0, 11.0);
  float caustStr = slotF(0, 12.0);
  float petalsOn = slotF(0, 13.0);
  float dragonOn = slotF(0, 14.0);
  float tod = slotF(0, 15.0);
  float rainOn = slotF(0, 16.0);
  float camAng = slotF(0, 17.0);
  float camPhase = slotF(0, 18.0);
  float sw = max(slotF(0, 19.0), 640.0);
  float sh = max(slotF(0, 20.0), 360.0);
  float labelOn = slotF(0, 21.0);
  float legendOn = slotF(0, 22.0);
  float timeScale = max(slotF(0, 27.0), 0.05);
  float metricPeak = slotF(0, 28.0);
  float tileScale = max(slotF(0, 30.0), 1.0);
  float labelMetric = slotF(0, 31.0);
  float sizeScale = slotF(0, 32.0);
  float simTime = uTime * timeScale;

  vec2 fc = gl_FragCoord.xy;
  vec2 fcSnap = floor(fc / tileScale) * tileScale + tileScale * 0.5;
  vec2 uv = (fcSnap - 0.5 * vec2(sw, sh)) / min(sw, sh);

  float tilt = camAng < 0.5 ? 0.02 : 0.22;
  vec3 ro = vec3(sin(camPhase) * 0.08, 1.35 + tilt, 1.05 + camAng * 0.35);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(vec3(0.0, 1.0, 0.0), ww));
  vec3 vv = cross(ww, uu);
  vec3 dir = normalize(uv.x * uu + uv.y * vv + 1.2 * ww);

  float tPlane = -ro.y / dir.y;
  vec3 hit = ro + dir * max(tPlane, 0.01);
  vec2 xz = hit.xz;

  float skyMix = smoothstep(0.25, 0.85, tod);
  vec3 skyTop = mix(vec3(0.55, 0.72, 0.95), vec3(0.02, 0.04, 0.12), skyMix);
  vec3 skyHor = mix(vec3(0.95, 0.75, 0.55), vec3(0.08, 0.1, 0.18), skyMix);
  vec3 col = mix(skyHor, skyTop, clamp(dir.y * 0.5 + 0.5, 0.0, 1.0));

  vec3 water = pondWater(xz, clarity, murk, waterTint, simTime);
  vec3 wn = pondNormal(xz, simTime);
  float fres = pow(1.0 - clamp(dot(wn, normalize(vec3(-dir.x, 0.65, -dir.z))), 0.0, 1.0), 4.0);
  water = mix(water, mix(skyTop, skyHor, 0.45), fres * 0.28 * clarity * (1.0 - murk));
  water = mix(water, water * 1.08, max(0.0, dot(wn, normalize(vec3(-0.2, 0.85, 0.35)))) * 0.35);
  float caust = noise3(vec3(xz * 4.0 + wn.xz * 0.5, simTime * 0.5 + 1.0));
  float caust2 = noise3(vec3(xz * 9.0 - wn.xz, simTime * 0.85));
  if (caustOn > 0.5) water += vec3(0.35, 0.75, 0.65) * (caust * 0.65 + caust2 * 0.35) * caustStr * 0.22 * (1.0 - murk);

  int nKoi = int(clamp(slotF(0, 24.0), 0.0, 16.0));
  for (int i = 0; i < 16; i++) {
    if (i >= nKoi) break;
    float fi = float(i * 4);
    vec2 kp = vec2(slotF(1, fi), slotF(1, fi + 2.0));
    float swimW = slotF(1, fi + 1.0);
    float yaw = slotF(1, fi + 3.0);
    float meta = slotF(0, 35.0 + float(i));
    float sp = floor(meta + 0.01);
    float vig = clamp((meta - sp) * 64.0, 0.0, 1.0);
    vec2 off = vec2(cos(yaw), sin(yaw)) * (0.08 + swimW * 0.35);
    vec2 p = xz - (kp + off);
    float body = sdEllipse(p, vec2(0.11 * sizeScale * (0.85 + vig * 0.35), 0.05 * sizeScale));
    float fin = sdEllipse(p - vec2(0.06 * cos(yaw + swimW), 0.06 * sin(yaw + swimW)), vec2(0.04, 0.025));
    float k = exp(-min(body, fin) * 55.0);
    vec3 kcol = koiPatternCol(sp, vig);
    kcol *= 0.85 + 0.25 * max(0.0, dot(wn, vec3(0.0, 1.0, 0.0)));
    water = mix(water, kcol, k * 0.92);
    water += vec3(0.9, 0.95, 1.0) * exp(-body * 80.0) * ripple * 0.08;
  }

  int padCount = int(clamp(4.0 + lilyDens * 8.0, 4.0, 12.0));
  for (int j = 0; j < 12; j++) {
    if (j >= padCount) break;
    float fj = float(j * 4);
    vec2 pp = vec2(slotF(2, fj), slotF(2, fj + 2.0));
    float bloom = slotF(2, fj + 1.0);
    float act = slotF(2, fj + 3.0);
    float isLotus = float(j) < lotusN ? 1.0 : 0.0;
    float pad = length(xz - pp) - mix(0.14, 0.11, isLotus);
    float padShade = smoothstep(0.02, 0.0, pad);
    vec3 padCol = mix(vec3(0.12, 0.38, 0.18), vec3(0.18, 0.48, 0.22), bloom);
    water = mix(water, padCol, padShade * 0.85);
    if (isLotus > 0.5 && bloom > 0.25) {
      vec3 lotus = lotusCol < 0.35
        ? vec3(0.95, 0.55, 0.72)
        : lotusCol > 0.65
          ? vec3(0.98, 0.96, 0.92)
          : mix(vec3(0.95, 0.55, 0.72), vec3(0.98, 0.96, 0.92), hash11(float(j)));
      float flower = length(xz - pp) - 0.05;
      water = mix(water, lotus, smoothstep(0.03, 0.0, flower) * bloom * (0.5 + act));
    }
  }

  int pc = int(slotF(0, 25.0));
  float padBase = 48.0;
  for (int k = 0; k < 16; k++) {
    if (k >= pc) break;
    float fk = padBase + float(k * 4);
    vec3 pp = vec3(slotF(2, fk), slotF(2, fk + 1.0), slotF(2, fk + 2.0));
    float kind = slotF(2, fk + 3.0);
    vec2 rippleC = xz - pp.xz;
    float ring = abs(length(rippleC) - 0.08 - fract(simTime * 0.4 + float(k)) * 0.12);
    water += vec3(0.85, 0.95, 1.0) * exp(-ring * 120.0) * ripple * 0.25;
    if (kind > 1.0 && petalsOn > 0.5) {
      float pet = length(xz - pp.xz) - 0.02;
      water += vec3(0.95, 0.75, 0.82) * exp(-pet * 200.0) * 0.35;
    }
  }

  if (dragonOn > 0.5) {
    for (int d = 0; d < 3; d++) {
      float fd = float(d);
      vec2 dp = vec2(sin(simTime * 0.7 + fd * 2.1) * 0.9, cos(simTime * 0.55 + fd) * 0.7);
      float bug = length(xz - dp) - 0.015;
      water += vec3(0.2, 0.85, 0.55) * exp(-bug * 250.0) * 0.4;
    }
  }

  if (rainOn > 0.5) {
    float rain = noise3(vec3(xz * 8.0, simTime * 4.0 + 2.0));
    water = mix(water, water * 0.92, rain * 0.15);
  }

  if (tod > 0.8) {
    for (int L = 0; L < 4; L++) {
      float fl = float(L);
      vec2 lp = vec2(-0.7 + fl * 0.45, 0.75);
      float lantern = length(xz - lp) - 0.04;
      water += vec3(1.0, 0.55, 0.2) * exp(-lantern * 90.0) * 0.35;
    }
  }

  col = mix(col, water, smoothstep(0.0, 0.15, -dir.y));
  col = mix(col, vec3(0.18, 0.2, 0.14), murk * 0.65);

  if (fail > 0.5) {
    float chip = smoothstep(0.12, 0.0, length(uv - vec2(0.42, -0.4)));
    col = mix(col, vec3(0.55, 0.48, 0.35), 0.35);
    col = mix(col, vec3(0.85, 0.25, 0.22), chip * 0.75);
  }

  col *= uBright * (0.7 + uAudio * 0.2);
  col = mix(col, uBg, 0.06);
  col = mix(col, uAccent * 0.25, metricPeak * 0.12);

  if (labelOn > 0.5) {
    float band = smoothstep(0.08, 0.0, abs(uv.y + 0.42));
    vec3 ink = mix(vec3(0.15, 0.75, 0.65), vec3(0.9, 0.35, 0.3), fail);
    col = mix(col, ink * 0.55, band * 0.8);
    if (labelMetric > 1.5) {
      float demoBar = smoothstep(0.1, 0.0, abs(uv.x + 0.2));
      col = mix(col, vec3(0.95, 0.9, 0.5), band * demoBar * 0.5);
    }
  }
  if (legendOn > 0.5) {
    float legendMask = slotF(0, 34.0);
    float pondTraffic = slotF(0, 51.0);
    vec2 legendUv = uv - vec2(0.32, -0.36);
    for (int li = 0; li < 6; li++) {
      float bit = mod(floor(legendMask / pow(2.0, float(li))), 2.0);
      if (bit < 0.5) continue;
      vec2 chip = legendUv - vec2(float(li) * 0.055, 0.0);
      float chipOn = smoothstep(0.028, 0.0, length(chip - vec2(0.018, 0.0)));
      col = mix(col, koiPatternCol(float(li), 0.4) * 0.9, chipOn * 0.9);
    }
    vec2 bloomLegend = legendUv - vec2(0.34, 0.055);
    float bloomChip = smoothstep(0.032, 0.0, length(bloomLegend - vec2(0.02, 0.0)));
    vec3 bloomInk = mix(vec3(0.55, 0.82, 0.62), vec3(0.95, 0.55, 0.72), pondTraffic);
    col = mix(col, bloomInk * 0.85, bloomChip * 0.85);
    float bloomBar = smoothstep(0.12, 0.0, abs(bloomLegend.y - 0.02));
    col = mix(col, bloomInk, bloomBar * pondTraffic * 0.35);
  }

  col = min(col, vec3(0.98));
  fragColor = vec4(col, uOpacity);
}
