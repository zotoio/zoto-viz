// `this.mat.uniforms.uGhost` writes a uniform the material's GLSL never declares.
import * as THREE from "three";

const VERT = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const FRAG = /* glsl */ `
uniform float uTime;
void main() { gl_FragColor = vec4(vec3(fract(uTime)), 1.0); }
`;

export class Ghost {
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  }

  tick(t: number): void {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uGhost.value = t * 2;
  }
}
