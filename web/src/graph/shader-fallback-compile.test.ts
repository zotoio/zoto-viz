import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";

const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

function mockGl(flags: { compile?: boolean; link?: boolean }) {
  const compileOk = flags.compile ?? true;
  const linkOk = flags.link ?? true;
  const compileShader = vi.fn();
  const linkProgram = vi.fn();
  const getShaderInfoLog = vi.fn(() => "compile error");
  const getProgramInfoLog = vi.fn(() => "link error");
  const gl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS,
    LINK_STATUS,
    createShader: () => ({}),
    createProgram: () => ({}),
    shaderSource: vi.fn(),
    compileShader,
    attachShader: vi.fn(),
    linkProgram,
    getShaderParameter: (_sh: unknown, p: number) => (p === COMPILE_STATUS ? compileOk : true),
    getProgramParameter: (_p: unknown, p: number) => (p === LINK_STATUS ? linkOk : true),
    getShaderInfoLog,
    getProgramInfoLog,
  };
  return { gl, compileShader, linkProgram, getShaderInfoLog, getProgramInfoLog };
}

function hostedWall(): { wall: HTMLElement; host: RenderHost; gl: ReturnType<typeof mockGl> } {
  const wall = document.createElement("div");
  Object.defineProperty(wall, "clientWidth", { value: 320 });
  Object.defineProperty(wall, "clientHeight", { value: 240 });
  document.body.appendChild(wall);
  const host = new RenderHost(wall);
  const mocked = mockGl({ compile: false });
  vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
  Object.defineProperty(host, "software", { value: false });
  return { wall, host, gl: mocked };
}

describe("tile shader compile latch", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("compile-once", () => {
    const { wall, host, gl } = hostedWall();
    host.buildTileShader("pane-a", "void main() { fragColor = vec4(1.0); }");
    for (let i = 0; i < 600; i++) {
      host.buildTileShader("pane-a", "void main() { fragColor = vec4(1.0); }");
    }
    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(0);
    expect(gl.getShaderInfoLog).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });

  it("link-failure", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 320 });
    Object.defineProperty(wall, "clientHeight", { value: 240 });
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    const mocked = mockGl({ compile: true, link: false });
    vi.spyOn(host, "gl", "get").mockReturnValue(mocked.gl as WebGL2RenderingContext);
    Object.defineProperty(host, "software", { value: false });
    host.buildTileShader("pane-b", "void main() { fragColor = vec4(1.0); }");
    for (let i = 0; i < 600; i++) {
      host.buildTileShader("pane-b", "void main() { fragColor = vec4(1.0); }");
    }
    expect(mocked.compileShader).toHaveBeenCalledTimes(2);
    expect(mocked.linkProgram).toHaveBeenCalledTimes(1);
    expect(mocked.getShaderInfoLog).toHaveBeenCalledTimes(0);
    expect(mocked.getProgramInfoLog).toHaveBeenCalledTimes(1);
    host.dispose();
    wall.remove();
  });
});
