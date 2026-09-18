uniform float uTime;
uniform float uBright;
uniform float uAudio;
uniform vec3 uAccent;
uniform vec3 uBg;
in vec3 vDir;
out vec4 fragColor;

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

float hash11(float n) {
  return fract(sin(n) * 43758.5453123);
}

float blob(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / max(r, vec2(0.001));
  return exp(-dot(d, d));
}

float stick(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  vec2 d = pa - ba * h;
  return exp(-dot(d, d) / max(r * r, 0.000001));
}

float ease(float x) {
  return x * x * (3.0 - 2.0 * x);
}

/** kind 0 living, 1 skeletal, 2 malicious. morph blends two identities. */
float faceMask(vec2 p, float seed, float morph, float smile, float gaze, float kind) {
  float k = ease(clamp(morph, 0.0, 1.0));
  float idA = seed * 7.13;
  float idB = seed * 7.13 + 4.27;
  vec2 sep = mix(
    vec2(0.22 + 0.08 * hash11(idA), 0.15 + 0.05 * hash11(idA + 1.2)),
    vec2(0.18 + 0.12 * hash11(idB), 0.12 + 0.08 * hash11(idB + 1.2)),
    k
  );
  float eyeY = mix(0.14, 0.24, mix(hash11(idA + 2.4), hash11(idB + 2.4), k));
  vec2 eL = vec2(-sep.x, eyeY);
  vec2 eR = vec2(sep.x, eyeY);
  float rEye = mix(0.09, 0.15, mix(hash11(idA + 3.1), hash11(idB + 3.1), k));
  vec2 look = vec2(gaze * 0.05, smile * 0.02 - 0.01);
  float lid = mix(1.0, 0.28, smoothstep(0.8, 0.95, abs(sin(morph * 6.28318 + seed))));
  float whiteL = blob(p, eL, vec2(rEye * 1.25, rEye * lid));
  float whiteR = blob(p, eR, vec2(rEye * 1.25, rEye * lid));
  float pupilL = blob(p, eL + look, vec2(rEye * 0.4));
  float pupilR = blob(p, eR + look, vec2(rEye * 0.4));
  float eyes = max(whiteL * (0.3 + 0.7 * (1.0 - pupilL)), whiteR * (0.3 + 0.7 * (1.0 - pupilR)));

  float expr = mix(-0.4, 0.5, clamp(smile, 0.0, 1.0));
  vec2 mouthC = vec2(0.0, mix(-0.28, -0.16, mix(hash11(idA + 4.0), hash11(idB + 4.0), k)));
  float mouthW = mix(0.18, 0.32, mix(hash11(idA + 5.2), hash11(idB + 5.2), k));
  vec2 mq = p - mouthC;
  float smileArc = mq.y - expr * mq.x * mq.x * 8.5;
  float mouthLine = exp(-smileArc * smileArc * 70.0) * exp(-mq.x * mq.x / (mouthW * mouthW));
  float mouthO = blob(p, mouthC, vec2(mouthW * 0.75, mouthW * mix(0.32, 0.55, 1.0 - abs(expr))));
  float mouth = mix(mouthO, mouthLine, smoothstep(0.1, 0.34, abs(expr)));

  float nose = blob(p, vec2(0.0, 0.03), vec2(0.045, 0.09)) * 0.85;
  float head = blob(p, vec2(0.0, 0.04), vec2(0.62, 0.74));
  float rim = head * (1.0 - smoothstep(0.18, 0.86, head));
  float living = head * 0.5 + rim * 1.15 + eyes * 1.15 + mouth * 1.55 + nose;

  float sockL = blob(p, eL, vec2(rEye * 1.45, rEye * 1.15));
  float sockR = blob(p, eR, vec2(rEye * 1.45, rEye * 1.15));
  float socket = max(sockL * (1.0 - blob(p, eL, vec2(rEye * 0.55))), sockR * (1.0 - blob(p, eR, vec2(rEye * 0.55))));
  vec2 nas = p - vec2(0.0, 0.0);
  float nasal = exp(-pow(nas.x / 0.05, 2.0) - pow((nas.y + 0.02) / 0.11, 2.0)) * step(-0.12, nas.y) * step(nas.y, 0.08);
  float jaw = blob(p, vec2(0.0, -0.22), vec2(0.42, 0.28));
  float teeth = 0.0;
  for (int t = 0; t < 7; t++) {
    float ft = float(t);
    float tx = (ft - 3.0) * 0.055;
    float toothLife = fract(morph * 0.85 + ft * 0.13 + seed * 0.08);
    float toothFade = smoothstep(0.0, 0.28, toothLife) * smoothstep(1.0, 0.42, toothLife);
    teeth = max(teeth, blob(p, vec2(tx, -0.2), vec2(0.016, 0.055)) * toothFade);
  }
  teeth *= jaw * step(-0.28, p.y) * step(p.y, -0.12);
  float skullHead = blob(p, vec2(0.0, 0.1), vec2(0.52, 0.58));
  float skullRim = skullHead * (1.0 - smoothstep(0.2, 0.9, skullHead));
  float skeletal = skullRim * 1.2 + socket * 1.35 + nasal * 1.1 + teeth * 1.05 + jaw * 0.25;

  float browL = blob(p, eL + vec2(-0.02, 0.11), vec2(rEye * 1.4, rEye * 0.28));
  float browR = blob(p, eR + vec2(0.02, 0.11), vec2(rEye * 1.4, rEye * 0.28));
  float slitL = blob(p, eL + vec2(0.02, -0.01), vec2(rEye * 1.5, rEye * 0.32));
  float slitR = blob(p, eR + vec2(-0.02, -0.01), vec2(rEye * 1.5, rEye * 0.32));
  float glare = max(blob(p, eL + look, vec2(rEye * 0.22)), blob(p, eR + look * vec2(-0.4, 1.0), vec2(rEye * 0.2)));
  vec2 sq = p - vec2(0.04, -0.2);
  float sneer = exp(-pow(sq.y + 0.35 * sq.x * sq.x + 0.08 * sq.x, 2.0) * 90.0) * exp(-sq.x * sq.x / 0.07);
  float fang = max(blob(p, vec2(-0.1, -0.18), vec2(0.02, 0.07)), blob(p, vec2(0.12, -0.17), vec2(0.018, 0.06)));
  float chin = blob(p, vec2(0.0, -0.32), vec2(0.16, 0.14));
  float malice = rim * 0.7 + max(slitL, slitR) * 1.2 + glare * 1.4 + max(browL, browR) * 1.05 + sneer * 1.35 + fang * 1.5 + chin * 0.45;

  float blendSk = clamp(kind, 0.0, 1.0);
  float blendMal = clamp(kind - 1.0, 0.0, 1.0);
  return mix(mix(living, skeletal, blendSk), malice, blendMal);
}

/** Faceless lurker. x=body, y=blank head. Feet plant on y=-0.88. */
vec2 slenderParts(vec2 p, float walk) {
  float s = sin(walk);
  float c = cos(walk);
  vec2 headC = vec2(0.0, 0.68);
  float head = blob(p, headC, vec2(0.11, 0.15));
  float blank = 1.0 - blob(p, headC + vec2(0.0, 0.01), vec2(0.06, 0.08));
  float neck = blob(p, vec2(0.0, 0.48), vec2(0.026, 0.08));
  vec2 hip = vec2(0.0, -0.12);
  float torso = stick(p, vec2(0.0, 0.40), hip, 0.048);
  vec2 shL = vec2(-0.075, 0.36);
  vec2 shR = vec2(0.075, 0.36);
  vec2 handL = shL + vec2(-0.16 - 0.05 * s, -0.22 + 0.08 * c);
  vec2 handR = shR + vec2(0.16 + 0.05 * s, -0.22 - 0.08 * c);
  float arms = max(stick(p, shL, handL, 0.018), stick(p, shR, handR, 0.018));
  float fingers = 0.0;
  for (int f = 0; f < 5; f++) {
    float ff = float(f) - 2.0;
    vec2 fL = handL + vec2(-0.22 - 0.018 * abs(ff), 0.04 * ff + 0.02 * s);
    vec2 fR = handR + vec2(0.22 + 0.018 * abs(ff), 0.04 * ff - 0.02 * s);
    fingers = max(fingers, max(stick(p, handL, fL, 0.005), stick(p, handR, fR, 0.005)));
  }
  float ground = -0.88;
  float stride = 0.14;
  vec2 hipL = hip + vec2(-0.04, 0.0);
  vec2 hipR = hip + vec2(0.04, 0.0);
  vec2 footL = vec2(hipL.x + stride * s, ground + 0.13 * max(c, 0.0));
  vec2 footR = vec2(hipR.x - stride * s, ground + 0.13 * max(-c, 0.0));
  float legs = max(stick(p, hipL, footL, 0.024), stick(p, hipR, footR, 0.024));
  float body = max(max(neck, torso), max(max(arms, fingers), legs));
  return vec2(body, head * (0.45 + 0.55 * blank));
}

void main() {
  vec3 d = normalize(vDir);
  float lead = slot0(0.0);
  float depth = slot0(1.0);
  float nrm = slot0(2.0);
  float pulse = max(uAudio, slot0(3.0));
  float faceSeed = slot0(4.0);
  float faceMorph = slot0(5.0);
  float faceSmile = slot0(6.0);
  float faceGaze = slot0(7.0);
  if (abs(faceSeed) + abs(faceMorph) < 0.001) {
    faceSeed = lead * 2.1 + depth;
    faceMorph = fract(uTime * 0.07 + lead);
    faceSmile = 0.5 + 0.5 * sin(uTime * 0.41 + depth * 3.0);
    faceGaze = sin(uTime * 0.53 + lead);
  }

  vec3 col = uBg * 0.12;
  float starField = 0.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float spd = 0.18 + fract(lead * 3.1 + fi * 0.17) * 0.55 + pulse * 0.2;
    float yaw = uTime * spd + fi * 0.9 + lead * 2.4;
    float pit = (fract(fi * 0.37 + depth) - 0.5) * 1.4;
    vec3 sd = normalize(vec3(sin(yaw) * cos(pit), sin(pit), cos(yaw) * cos(pit)));
    float ang = acos(clamp(dot(d, sd), -1.0, 1.0));
    float lane = sin(ang * (7.0 + fi) - uTime * (0.7 + fi * 0.11) + lead * 6.0);
    float star = exp(-ang * (28.0 + fi * 4.0)) * (0.45 + 0.55 * lane);
    starField += star;
    col += (uAccent * 0.55 + vec3(1.0, 0.92, 0.78) * 0.45) * star * (0.8 + nrm);
  }
  float speckle = fract(sin(dot(d.xy, vec2(12.9898, 78.233))) * 43758.5453);
  starField += pow(speckle, 28.0) * 0.35;
  col += vec3(0.85, 0.9, 1.0) * pow(speckle, 28.0) * 0.55;

  vec3 faceLit = vec3(0.0);
  float faces = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float seed = 3.71 + fi * 2.17;
    float az = uTime * (0.041 + fi * 0.009) + fi * 1.73 + 0.85 * sin(uTime * 0.019 + fi * 0.6);
    float el = 0.42 * sin(uTime * 0.027 + fi * 2.15) + 0.22 * sin(uTime * 0.053 + fi * 0.8) + 0.08 * fi - 0.2;
    float path = az * 0.55 + el * 1.35 + fi;
    float life = fract(uTime * (0.034 + fi * 0.005) + fi * 0.37);
    float near = ease(smoothstep(0.0, 0.22, life) * smoothstep(1.0, 0.48, life));
    float morph = 0.5 + 0.5 * sin(path);
    float fade = near * (0.4 + 0.6 * smoothstep(-0.15, 0.8, morph));
    float kind = mod(path * 0.35 + fi * 0.9, 3.0);
    float smile = clamp(0.5 + 0.45 * sin(path * 1.2 + fi) + 0.15 * faceSmile, 0.0, 1.0);
    float gaze = clamp(0.7 * sin(path * 0.8 + uTime * 0.11) + 0.2 * faceGaze, -1.0, 1.0);
    vec3 fd = normalize(vec3(sin(az) * cos(el), sin(el), cos(az) * cos(el)));
    float facing = dot(d, fd);
    float window = smoothstep(0.06, 0.52, facing);
    vec3 right = cross(fd, vec3(0.0, 1.0, 0.0));
    if (dot(right, right) < 0.0001) right = vec3(1.0, 0.0, 0.0);
    else right = normalize(right);
    vec3 up = cross(right, fd);
    float scale = mix(0.24, 0.95, near);
    vec2 uv = vec2(dot(d, right), dot(d, up)) / max(0.16, facing * scale);
    float m = faceMask(uv, seed, morph, smile, gaze, kind) * fade * window;
    vec3 tint = mix(mix(vec3(1.0, 0.93, 0.82), vec3(0.82, 0.88, 0.78), clamp(kind, 0.0, 1.0)), vec3(0.95, 0.22, 0.18), clamp(kind - 1.0, 0.0, 1.0));
    tint = mix(uBg * 0.4 + vec3(0.55, 0.62, 0.78) * 0.35, tint, near);
    faces += m;
    faceLit += tint * m;
  }

  vec2 view = d.xy / max(0.22, abs(d.z) + 0.15);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float seed = 11.0 + fi * 3.1;
    float path = uTime * (0.033 + fi * 0.008) + fi * 1.17;
    float life = fract(uTime * (0.029 + fi * 0.004) + fi * 0.61 + 0.2);
    float near = ease(smoothstep(0.0, 0.2, life) * smoothstep(1.0, 0.46, life));
    float morph = 0.5 + 0.5 * sin(path * 0.9 + 0.4 * sin(path * 0.35));
    float fade = near * (0.35 + 0.65 * smoothstep(-0.15, 0.8, morph));
    float kind = fi + 0.5 + 0.5 * sin(path * 0.28);
    float smile = clamp(0.5 + 0.4 * sin(path * 1.15 + fi) + 0.15 * faceSmile, 0.0, 1.0);
    float gaze = clamp(0.65 * sin(path * 0.7 + fi) + 0.2 * faceGaze, -1.0, 1.0);
    vec2 pos = vec2(
      0.72 * sin(path * 1.15 + fi * 1.9) + 0.38 * sin(path * 1.85 + fi * 2.7) + 0.16 * sin(uTime * 0.021 + fi),
      0.48 * sin(path * 0.95 + fi * 1.3) + 0.28 * cos(path * 1.55 + fi * 2.1) + 0.12 * cos(uTime * 0.017 + fi * 1.4)
    );
    float grow = mix(3.6, 1.05, near);
    vec2 uv = (view - pos) * grow;
    float m = faceMask(uv, seed, morph, smile, gaze, kind) * fade;
    vec3 tint = mix(mix(vec3(1.0, 0.93, 0.82), vec3(0.82, 0.88, 0.78), clamp(kind, 0.0, 1.0)), vec3(0.95, 0.22, 0.18), clamp(kind - 1.0, 0.0, 1.0));
    tint = mix(uBg * 0.35 + vec3(0.5, 0.58, 0.75) * 0.3, tint, near);
    faces += m;
    faceLit += tint * m;
  }

  vec3 starCol = mix(uAccent, vec3(0.9, 0.95, 1.0), 0.4);
  float dust = pow(speckle, 12.0);
  col += starCol * faces * (0.04 + dust * 0.7 + starField * 1.1);
  col += faceLit * (0.08 + pulse * 0.04) * (0.15 + dust * 1.2);

  float walk = uTime * 2.35;
  float rw = slot0(8.0);
  float rh = slot0(9.0);
  if (rw < 64.0) rw = 1280.0;
  if (rh < 64.0) rh = 800.0;
  vec2 ndc = gl_FragCoord.xy / vec2(rw, rh) * 2.0 - 1.0;
  ndc.x *= rw / rh;
  vec2 vanish = vec2(0.0, 0.20);
  float lurk = 0.40 + 0.03 * sin(uTime * 0.04);
  float cross = 0.72 * sin(uTime * 0.11);
  vec2 slAt = mix(vanish, vec2(cross, -0.92), lurk);
  slAt.x += 0.012 * sin(walk);
  float slScale = mix(5.4, 2.35, lurk);
  slAt.y += 0.88 / slScale;
  vec2 slP = (ndc - slAt) * slScale;
  vec2 sl = slenderParts(slP, walk);
  col = mix(col, vec3(0.03, 0.032, 0.038), sl.x * 0.82);
  col = mix(col, vec3(0.04, 0.042, 0.05), sl.y * 0.7);

  float glitchLife = fract(uTime * 0.051 + 2.4);
  float glow = ease(smoothstep(0.0, 0.07, glitchLife) * smoothstep(0.32, 0.1, glitchLife));
  float slice = floor(ndc.y * 28.0 + uTime * 17.0);
  float tear = (hash11(slice + floor(uTime * 9.0)) - 0.5);
  float glitchOn = step(0.55, hash11(slice * 2.4 + floor(uTime * 21.0)));
  vec2 gUv = slP * 1.15 - vec2(tear * glitchOn * 0.12 * glow, 0.62);
  float gFace = faceMask(gUv, 19.7, glow, 0.15, 0.0, 1.4 + glow) * glow * sl.y;
  col += vec3(0.95, 0.82, 0.7) * gFace * (1.1 + glitchOn * 0.6);
  col += vec3(0.7, 0.2, 0.15) * gFace * glitchOn * abs(tear) * 0.8;

  col *= max(uBright, 0.55);
  fragColor = vec4(col, 1.0);
}
