// The uniforms object binds uGhost, but no stage declares it.
import * as THREE from "three";

const VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
uniform float uTime;
void main() { gl_FragColor = vec4(vec3(fract(uTime)), 1.0); }
`;

export function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGhost: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
