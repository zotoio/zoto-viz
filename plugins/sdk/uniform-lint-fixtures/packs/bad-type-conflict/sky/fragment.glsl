// Redeclares two host preamble uniforms with the wrong type. wrapPluginSky accepts it (both names are
// whitelisted): `vec3 uTime` is stripped, so the body uses the host's float uTime as a vec3; `vec3
// uResolution` is not stripped, so it redeclares the host's vec2. Either way the sky compile fails.
uniform vec3 uTime;
uniform vec3 uResolution;
void main() {
  vec3 dir = normalize(vDir);
  vec2 px = gl_FragCoord.xy / uResolution.xy;
  fragColor = vec4(uAccent * (0.5 + 0.5 * sin(dir.y * 4.0 + uTime.x + px.y)) * uBright, uOpacity);
}
