// Declarations come from a local const, an imported const, and a `+` concatenation.
import * as THREE from "three";
import { SHARED_UNIFORMS_GLSL } from "./shared-glsl";

const LOCAL_GLSL = /* glsl */ `
uniform float uTime;
`;

const VERT = /* glsl */ `
${LOCAL_GLSL}
void main() {
  float uLocal = uTime * 0.5; // a local named like a uniform is not a uniform read
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * (1.0 + uLocal * 0.0), 1.0);
}
`;

const FRAG = SHARED_UNIFORMS_GLSL + /* glsl */ `
// uNotReal only appears in a comment
void main() { gl_FragColor = vec4(uTint * uShared, 1.0); }
`;

export class Clean {
  readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uShared: { value: 1 },
        "uTint": { value: new THREE.Color() },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  }

  tick(t: number): void {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms["uShared"].value = 1;
  }
}
