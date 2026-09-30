// uWave is declared (and set) for the fragment stage only, but the vertex stage reads it.
import * as THREE from "three";

const VERT = /* glsl */ `
void main() {
  vec3 p = position + normal * uWave;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uWave;
void main() {
  gl_FragColor = vec4(vec3(uWave), 1.0);
}
`;

export function waveMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uWave: { value: 0.1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
