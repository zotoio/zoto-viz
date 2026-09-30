// The fixed #171 shape: every uniform onBeforeCompile sets and reads is declared in the vertex stage.
import * as THREE from "three";

const CLOTH_GLSL = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
uniform float uTime;
uniform float uEdgeOpacity;
`;

export function clothMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ transparent: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uEdgeOpacity = { value: 0.5 };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${CLOTH_GLSL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vAlpha = aAlpha * uEdgeOpacity + 0.0 * uTime;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vAlpha;");
  };
  return mat;
}
