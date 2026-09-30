import { afterEach, describe, expect, it, vi } from "vitest";
import { NetScene, DEFAULT_DREAM } from "./scene";
import { disposeOwnedWebGLRenderer } from "./webgl";
import { themeById } from "../core/themes";

/** Minimal WebGL2 stub so THREE.WebGLRenderer can construct in happy-dom. */
function installWebGLMock() {
  const loseCalls: object[] = [];
  const lostEvents: Event[] = [];
  const onLost = (e: Event) => lostEvents.push(e);
  document.addEventListener("webglcontextlost", onLost, true);

  const loseContext = vi.fn(function (this: object, _gl?: unknown) {
    loseCalls.push(this);
  });

  const makeGl = (canvas: HTMLCanvasElement) => {
    const gl = {
      VENDOR: 0x1f00,
      RENDERER: 0x1f01,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      HIGH_FLOAT: 0x8df2,
      MEDIUM_FLOAT: 0x8df1,
      LOW_FLOAT: 0x8df0,
      fenceSync: () => null,
      isContextLost: () => false,
      getParameter: (p: number) => (p === 0x1f00 ? "Mock" : p === 0x1f01 ? "GPU" : 0),
      getShaderPrecisionFormat: () => ({ rangeMin: 127, rangeMax: 127, precision: 23 }),
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      deleteShader: () => {},
      getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: () => loseContext(gl) } : null),
      canvas,
    };
    return gl;
  };

  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (String(type).includes("webgl")) return makeGl(this) as never;
    return orig.call(this, type as never, ...rest);
  } as typeof orig;

  return {
    loseCalls: () => loseCalls.length,
    lostEvents: () => lostEvents.length,
    restore: () => {
      document.removeEventListener("webglcontextlost", onLost, true);
      HTMLCanvasElement.prototype.getContext = orig;
    },
  };
}

describe("disposeOwnedWebGLRenderer", () => {
  it("calls loseContext before dispose", () => {
    const lose = vi.fn();
    const canvas = document.createElement("canvas");
    const renderer = {
      domElement: canvas,
      getContext: () => ({
        getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: lose } : null),
      }),
      forceContextLoss: vi.fn(),
      dispose: vi.fn(),
    };
    document.body.appendChild(canvas);
    disposeOwnedWebGLRenderer(renderer as never);
    expect(lose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(canvas.isConnected).toBe(false);
  });
});

describe("mosaic view switch WebGL budget", () => {
  let mock: ReturnType<typeof installWebGLMock> | null = null;

  afterEach(() => {
    mock?.restore();
    mock = null;
  });

  it("releases owned WebGL on each disposed satellite after 20 view swaps", () => {
    mock = installWebGLMock();
    const lostBefore = mock.lostEvents();
    for (let i = 0; i < 20; i++) {
      const container = document.createElement("div");
      Object.defineProperty(container, "clientWidth", { value: 320, configurable: true });
      Object.defineProperty(container, "clientHeight", { value: 240, configurable: true });
      document.body.appendChild(container);
      const scene = new NetScene(container, { satellite: true, panelId: `tile-${i}` });
      scene.setTheme(themeById("midnight"));
      scene.setAnim(DEFAULT_DREAM);
      scene.dispose();
      container.remove();
    }
    expect(mock.lostEvents()).toBe(lostBefore);
    expect(mock.loseCalls()).toBeGreaterThanOrEqual(20);
  });
});
