// FRAG declares and reads uSpeed, but the material's uniforms never set it.
import * as THREE from "three";

const VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
void main() { gl_FragColor = vec4(vec3(fract(uTime * uSpeed)), 1.0); }
`;

export function unsetMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}
