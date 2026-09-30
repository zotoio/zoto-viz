// Raw WebGL2 program whose getUniformLocation names are all declared.
const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec3 uAccent;
out vec4 fragColor;
void main() { fragColor = vec4(uAccent * fract(uTime), 1.0); }`;

export function draw(gl: WebGL2RenderingContext, prog: WebGLProgram, t: number): string[] {
  gl.uniform1f(gl.getUniformLocation(prog, "uTime"), t);
  gl.uniform3fv(gl.getUniformLocation(prog, "uAccent"), [1, 0.5, 0.2]);
  return [VERT, FRAG];
}
