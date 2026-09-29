float fd(float fi) {
  float i = floor(fi);
  float q = floor(i * 0.25);
  float r = i - q * 4.0;
  vec4 v = zotoVizSlots[int(q)];
  if (r < 0.5) return v.x;
  if (r < 1.5) return v.y;
  if (r < 2.5) return v.z;
  return v.w;
}

float cellAt(float base, float x, float y, float n) {
  float x0 = clamp(floor(x), 0.0, n - 1.0);
  float y0 = clamp(floor(y), 0.0, n - 1.0);
  float x1 = min(x0 + 1.0, n - 1.0);
  float y1 = min(y0 + 1.0, n - 1.0);
  float fx = clamp(x - x0, 0.0, 1.0);
  float fy = clamp(y - y0, 0.0, 1.0);
  float i00 = base + y0 * n + x0;
  float i10 = base + y0 * n + x1;
  float i01 = base + y1 * n + x0;
  float i11 = base + y1 * n + x1;
  float a = mix(fd(i00), fd(i10), fx);
  float b = mix(fd(i01), fd(i11), fx);
  return mix(a, b, fy);
}

bool solidAt(vec2 p, float kind, float rad, vec2 c) {
  if (kind < 0.5 || rad < 0.001) return false;
  if (kind < 1.5) {
    vec2 d = p - c;
    return dot(d, d) < rad * rad;
  }
  if (kind < 2.5) {
    float dx = (p.x - c.x) / max(0.02, rad * 1.7);
    float dy = (p.y - c.y) / max(0.02, rad * 0.42);
    return dx * dx + dy * dy < 1.0;
  }
  if (kind < 3.5) {
    float r = max(0.03, rad * 0.55);
    for (int k = -1; k <= 1; k++) {
      vec2 d = p - vec2(c.x + float(k) * 0.2, c.y);
      if (dot(d, d) < r * r) return true;
    }
    return false;
  }
  bool wall = abs(p.x - c.x) < 0.04;
  bool gap = abs(p.y - c.y) < rad * 0.7;
  return wall && !gap;
}

vec3 palette(float d, float hue, float pal) {
  vec3 paper = vec3(0.93, 0.90, 0.84);
  vec3 ink = vec3(0.16, 0.10, 0.38);
  float h = hue * 6.28318;
  ink = mix(ink, vec3(0.45, 0.12, 0.55), 0.35);
  ink = 0.55 * ink + 0.45 * vec3(0.5 + 0.5 * cos(h), 0.5 + 0.5 * cos(h + 2.1), 0.5 + 0.5 * cos(h + 4.2));
  vec3 col = mix(paper, ink, clamp(d, 0.0, 1.0));
  if (pal > 0.5) col = mix(vec3(0.02, 0.07, 0.16), vec3(0.35, 0.85, 0.95), clamp(d, 0.0, 1.0));
  if (pal > 1.5) col = mix(vec3(0.05, 0.02, 0.02), vec3(1.0, 0.42, 0.08), clamp(d, 0.0, 1.0));
  if (pal > 2.5) {
    vec3 cold = vec3(0.05, 0.15, 0.85);
    vec3 warm = vec3(1.0, 0.85, 0.2);
    col = mix(cold, warm, clamp(d, 0.0, 1.0));
    col = mix(col, vec3(0.9, 0.15, 0.1), smoothstep(0.72, 1.0, d));
  }
  if (pal > 3.5) col = mix(vec3(0.03, 0.02, 0.07), vec3(0.1, 0.95, 0.85), clamp(d, 0.0, 1.0));
  if (pal > 4.5) col = mix(vec3(0.96, 0.96, 0.95), vec3(0.08, 0.08, 0.1), clamp(d, 0.0, 1.0));
  return col;
}

vec3 fallbackInk(vec2 p) {
  vec2 c = vec2(0.5, 0.58);
  float ang = atan(p.y - c.y, p.x - c.x);
  float r = length(p - c);
  float arm = sin(ang * 3.0 - uTime * 1.2 + r * 16.0);
  float d = exp(-r * r * 14.0) * 0.95 + smoothstep(0.2, 0.85, arm) * exp(-r * 3.5) * 0.55;
  return palette(clamp(d, 0.0, 1.0), 0.72, 0.0);
}

void main() {
  float mark = fd(0.0);
  float shade = fd(1.0);
  float pal = fd(2.0);
  float kind = fd(3.0);
  float rad = fd(4.0);
  vec2 obs = vec2(fd(5.0), fd(6.0));
  float glow = fd(7.0);
  float foam = fd(8.0);
  float stepsN = clamp(fd(9.0), 2.0, 16.0);
  float domain = fd(10.0);
  float vectors = fd(11.0);
  float gamma = max(0.35, fd(12.0));
  float detail = fd(13.0);
  float n = max(4.0, fd(14.0));
  float origin = fd(15.0);
  vec2 p;
  if (uResolution.x > 1.0 && uResolution.y > 1.0) {
    p = gl_FragCoord.xy / uResolution;
    p.y = 1.0 - p.y;
  } else {
    vec3 rd = normalize(vDir);
    vec2 uv = rd.xy / max(-rd.z, 0.18);
    p = uv * 0.5 + 0.5;
  }
  p = (p - 0.5) * 1.08 + 0.5;
  if (domain > 0.5) {
    float yk = clamp(p.y, 0.0, 1.0);
    p.x = (p.x - 0.5) / mix(1.12, 0.72, yk) + 0.5;
  }
  vec3 bg = palette(0.0, 0.0, mark > 0.5 ? pal : 0.0);
  if (mark < 0.5) {
    vec3 col = fallbackInk(clamp(p, vec2(0.0), vec2(1.0)));
    fragColor = vec4(col * uBright, uOpacity);
    return;
  }
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) {
    fragColor = vec4(bg * uBright, uOpacity);
    return;
  }
  float warp = sin(p.x * 18.0 + uTime) * cos(p.y * 14.0 - uTime * 0.7);
  p += vec2(warp, -warp) * detail * 0.012;
  p = clamp(p, vec2(0.0), vec2(1.0));
  float cells = n * n;
  vec2 cell = p * (n - 1.0);
  float dye = cellAt(origin, cell.x, cell.y, n);
  float hue = cellAt(origin + cells, cell.x, cell.y, n);
  vec2 vel = vec2(
    cellAt(origin + cells * 2.0, cell.x, cell.y, n),
    cellAt(origin + cells * 3.0, cell.x, cell.y, n)
  );
  float d = pow(clamp(dye, 0.0, 1.0), gamma);
  float speed = clamp(length(vel) / 2.2, 0.0, 1.0);
  float curl = cellAt(origin + cells * 2.0, cell.x, cell.y + 1.0, n) - cellAt(origin + cells * 2.0, cell.x, cell.y - 1.0, n);
  curl -= cellAt(origin + cells * 3.0, cell.x + 1.0, cell.y, n) - cellAt(origin + cells * 3.0, cell.x - 1.0, cell.y, n);
  float vort = clamp(abs(curl) * 0.35, 0.0, 1.0);
  float shown = d;
  if (shade > 0.5 && shade < 1.5) shown = speed;
  if (shade > 1.5 && shade < 2.5) shown = vort;
  if (shade > 2.5) {
    vec2 q = cell;
    float acc = d;
    for (int s = 0; s < 16; s++) {
      if (float(s) >= stepsN) break;
      vec2 v = vec2(
        cellAt(origin + cells * 2.0, q.x, q.y, n),
        cellAt(origin + cells * 3.0, q.x, q.y, n)
      );
      q += v * 0.22;
      q = clamp(q, vec2(0.5), vec2(n - 1.5));
      acc = max(acc, pow(clamp(cellAt(origin, q.x, q.y, n), 0.0, 1.0), gamma));
    }
    shown = shade > 3.5 ? mix(d, acc, 0.55) : acc;
  }
  vec3 col = palette(shown, hue, pal);
  col += vec3(1.0) * foam * smoothstep(0.45, 1.0, max(speed, vort)) * shown;
  col += col * glow * shown * 0.35;
  if (vectors > 0.5) {
    vec2 g = fract(cell);
    float tick = smoothstep(0.12, 0.0, abs(g.y - 0.5)) * smoothstep(0.55, 0.15, abs(g.x - 0.5));
    col = mix(col, vec3(0.95, 0.97, 1.0), tick * speed);
  }
  if (solidAt(p, kind, rad, obs)) {
    col = mix(col, vec3(0.10, 0.11, 0.13), 0.92);
    float rim = smoothstep(0.02, 0.0, abs(length(p - obs) - rad));
    col += vec3(0.55, 0.62, 0.7) * rim;
  }
  if (domain > 0.5) {
    float rim = smoothstep(0.08, 0.0, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
    col += vec3(0.65, 0.78, 0.85) * rim * 0.35;
  }
  col += uAccent * uAudio * 0.04;
  fragColor = vec4(col * uBright, uOpacity);
}
