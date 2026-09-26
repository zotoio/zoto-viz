/** One-shot WebGL2 shader compile + link for a mosaic tile. */

export const TILE_VERT = /* glsl */ `#version 300 es
in vec3 position;
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

export type TileShaderBuildResult =
  | { ok: true }
  | { ok: false; log: string };

export class TileShaderLatch {
  private failed = false;
  private logged = false;
  private compiled = false;

  get dead(): boolean {
    return this.failed;
  }

  reset(): void {
    this.failed = false;
    this.logged = false;
    this.compiled = false;
  }

  /**
   * Compile vertex + fragment and link once. After the first failure the GL path
   * stays latched off — no further compileShader / linkProgram / getShaderInfoLog.
   */
  build(gl: WebGL2RenderingContext, frag: string, log: (msg: string) => void): TileShaderBuildResult {
    if (this.failed) return { ok: false, log: "latched" };
    if (this.compiled) return { ok: true };
    const vertSh = gl.createShader(gl.VERTEX_SHADER);
    const fragSh = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertSh || !fragSh) {
      this.fail("createShader failed", log);
      return { ok: false, log: "createShader failed" };
    }
    gl.shaderSource(vertSh, TILE_VERT);
    gl.compileShader(vertSh);
    const vertOk = gl.getShaderParameter(vertSh, gl.COMPILE_STATUS);
    gl.shaderSource(fragSh, frag.startsWith("#version") ? frag : `#version 300 es\n${frag}`);
    gl.compileShader(fragSh);
    const fragOk = gl.getShaderParameter(fragSh, gl.COMPILE_STATUS);
    if (!vertOk || !fragOk) {
      const sh = !vertOk ? vertSh : fragSh;
      const msg = (gl.getShaderInfoLog(sh) || "compile failed").trim();
      this.fail(msg, log);
      return { ok: false, log: msg };
    }
    const prog = gl.createProgram();
    if (!prog) {
      this.fail("createProgram failed", log);
      return { ok: false, log: "createProgram failed" };
    }
    gl.attachShader(prog, vertSh);
    gl.attachShader(prog, fragSh);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const msg = (gl.getProgramInfoLog(prog) || "link failed").trim();
      this.fail(msg, log);
      return { ok: false, log: msg };
    }
    this.compiled = true;
    return { ok: true };
  }

  private fail(msg: string, log: (m: string) => void): void {
    this.failed = true;
    if (!this.logged) {
      this.logged = true;
      log(msg);
    }
  }
}
