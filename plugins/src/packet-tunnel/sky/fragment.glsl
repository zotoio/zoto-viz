// Packet Tunnel: a tube running away down -z. The plugin sky is parented to the camera, so vDir is
// camera-relative and the view looks straight down -z (docs/plugins-viz.md).
// Driven by zotoVizSlots slot 0 = [lead, depth, t mod 1] written by frontend/index.ts
// (packetTunnelSample); pack uniform writes are not relied on (#180).
// CPU mirror for tests: frontend/tunnel-sky.ts (keep the two in step).

float ptHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vDir);
  vec4 s0 = zotoVizSlots[0];
  float lead = clamp(s0.x, 0.0, 1.0);
  float field = clamp(s0.y, 0.0, 1.0);
  float depth = clamp(0.5 - 0.5 * dir.z, 0.0, 1.0);
  float fwd = max(-dir.z, 0.0);
  float rad = max(length(dir.xy), 0.001);
  float along = fwd / rad;
  float speed = 0.6 + 2.4 * lead;
  float travel = along * 1.6 + uTime * speed;
  float rings = pow(0.5 + 0.5 * cos(travel * 6.28318), 6.0);
  float laneF = (atan(dir.y, dir.x) / 6.28318 + 0.5) * 12.0;
  float lane = floor(laneF);
  float seam = 1.0 - smoothstep(0.0, 0.06, min(fract(laneF), 1.0 - fract(laneF)));
  float cellF = travel * 2.0;
  float busy = 0.25 + 0.6 * field;
  float pkt = step(1.0 - busy, ptHash(vec2(lane, floor(cellF))));
  float blip = pkt * smoothstep(0.0, 0.2, fract(cellF)) * (1.0 - smoothstep(0.55, 0.9, fract(cellF)));
  float fog = exp(-along * 0.22);
  float core = pow(depth, 240.0);
  vec3 hue = vec3(0.15 + lead * 0.7, 0.35 + lead * 0.4, 0.85 - lead * 0.3);
  vec3 wall = hue * (0.22 + 0.6 * rings + 0.35 * seam) + vec3(1.0, 0.9, 0.7) * (blip * 0.9);
  vec3 col = wall * fog + mix(hue, vec3(1.0), 0.5) * core;
  fragColor = vec4(col * uBright, uOpacity);
}
