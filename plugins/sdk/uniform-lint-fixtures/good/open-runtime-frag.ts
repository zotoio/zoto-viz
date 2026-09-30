// The fragment is a runtime string (a pack sky): the lint can't see its declarations, so it stays quiet.
import * as THREE from "three";

const VERT = /* glsl */ `
out vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export function skyMaterial(frag: string): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uResolution: { value: new THREE.Vector2() } },
    vertexShader: VERT,
    fragmentShader: frag,
  });
  mat.uniforms.uResolution.value.set(1, 1);
  return mat;
}
