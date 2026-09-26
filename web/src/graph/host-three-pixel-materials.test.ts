/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import {
  applyHostLineMaterialUniforms,
  applyHostPointsMaterialSize,
  hostShaderResolutionUniform,
} from "./host-three-pixel-materials";
import { devicePxRatioFromNumber } from "./render-host-device-px-ratio";

const LAYOUT_PR = 1.5;
const CSS_W = 200;
const CSS_H = 120;
const DEV_H = Math.round(CSS_H * LAYOUT_PR);
const PR = devicePxRatioFromNumber(LAYOUT_PR);

const { glLog, WebGLRendererMock } = vi.hoisted(() => {
  const glLog = {
    uniform1f: [] as { name: string; value: number }[],
    uniform2f: [] as { name: string; x: number; y: number }[],
  };
  const locToName = new Map<object, string>();

  function makeGl() {
    const gl: Record<string, unknown> = {
      getContextAttributes: () => ({ antialias: false }),
      fenceSync: () => ({}),
      getExtension: () => null,
      getParameter: (p: number) => {
        if (p === 0x1f00) return "Mock";
        if (p === 0x1f01) return "WebGL";
        if (p === 0x8b4c) return 16;
        return 0;
      },
      VENDOR: 0x1f00,
      RENDERER: 0x1f01,
      MAX_VERTEX_UNIFORM_VECTORS: 0x8b4c,
      createProgram: () => ({}),
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      getShaderParameter: () => true,
      useProgram: () => {},
      getUniformLocation: (_p: object, name: string) => {
        const loc = { name };
        locToName.set(loc, name);
        return loc;
      },
      uniform1f: (loc: { name?: string }, value: number) => {
        const name = loc.name ?? locToName.get(loc) ?? "unknown";
        glLog.uniform1f.push({ name, value });
      },
      uniform2f: (loc: object, x: number, y: number) => {
        const name = locToName.get(loc) ?? "unknown";
        glLog.uniform2f.push({ name, x, y });
      },
      viewport: () => {},
      scissor: () => {},
      enable: () => {},
      disable: () => {},
      blendFunc: () => {},
      depthFunc: () => {},
      depthMask: () => {},
      colorMask: () => {},
      clearColor: () => {},
      clear: () => {},
      bindBuffer: () => {},
      bufferData: () => {},
      createBuffer: () => ({}),
      vertexAttribPointer: () => {},
      enableVertexAttribArray: () => {},
      drawArrays: () => {},
      activeTexture: () => {},
      bindTexture: () => {},
      createTexture: () => ({}),
      texParameteri: () => {},
      texImage2D: () => {},
      pixelStorei: () => {},
      getShaderInfoLog: () => "",
      getProgramInfoLog: () => "",
      deleteShader: () => {},
      deleteProgram: () => {},
    };
    return gl;
  }

  class WebGLRendererMock {
    readonly domElement = document.createElement("canvas");
    private ratio = 1;
    private gl = makeGl();
    setPixelRatio = vi.fn((n: number) => {
      this.ratio = n;
    });
    setClearColor = vi.fn();
    setSize = vi.fn((w: number, h: number) => {
      this.domElement.width = w;
      this.domElement.height = h;
    });
    setScissorTest = vi.fn();
    setScissor = vi.fn();
    setViewport = vi.fn();
    setRenderTarget = vi.fn();
    getRenderTarget = () => null;
    clear = vi.fn();
    render = vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      scene.traverse((obj) => {
        if (!(obj as THREE.Points).isPoints) return;
        const points = obj as THREE.Points;
        const mat = points.material as THREE.PointsMaterial;
        if (!mat.isPointsMaterial) return;
        const pr = this.ratio;
        const h = this.domElement.height;
        this.gl.uniform1f({ name: "size" }, mat.size * pr);
        this.gl.uniform1f({ name: "scale" }, h * 0.5);
      });
    });
    compile = vi.fn();
    getPixelRatio = () => this.ratio;
    getContext = () => this.gl;
    forceContextLoss = vi.fn();
    dispose = vi.fn();
  }
  return { glLog, WebGLRendererMock };
});

vi.mock("three", async (importOriginal) => {
  const orig = await importOriginal<typeof import("three")>();
  return { ...orig, WebGLRenderer: WebGLRendererMock as unknown as typeof orig.WebGLRenderer };
});

vi.mock("./webgl", () => ({ probeWebGL: () => true }));

function lastUniform1f(name: string): number | undefined {
  const hits = glLog.uniform1f.filter((u) => u.name === name);
  return hits.at(-1)?.value;
}

function renderPointsMaterial(material: THREE.PointsMaterial): void {
  const renderer = new WebGLRendererMock();
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(CSS_W * LAYOUT_PR), DEV_H);
  const scene = new THREE.Scene();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1], 3));
  scene.add(new THREE.Points(geo, material));
  renderer.render(scene, new THREE.PerspectiveCamera());
}

describe("host pixel-sized materials (counting GL)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    glLog.uniform1f.length = 0;
    glLog.uniform2f.length = 0;
  });

  it("PointsMaterial sizeAttenuation true at pr 1.5 css size 4: uploaded size 4, scale devH/2", () => {
    const mat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: true, vertexColors: true });
    applyHostPointsMaterialSize(mat, 4, PR);
    renderPointsMaterial(mat);
    expect(lastUniform1f("size")).toBe(4);
    expect(lastUniform1f("scale")).toBe(DEV_H / 2);
  });

  it("PointsMaterial sizeAttenuation false at pr 1.5 css size 4: uploaded size 6", () => {
    const mat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true });
    applyHostPointsMaterialSize(mat, 4, PR);
    renderPointsMaterial(mat);
    expect(lastUniform1f("size")).toBe(6);
    expect(lastUniform1f("scale")).toBe(DEV_H / 2);
  });

  it("LineMaterial linewidth and resolution stay in device px; linewidth/resolution.x invariant across pr", () => {
    const mat = new LineMaterial({ color: 0xffffff });
    const cssLine = 2;
    applyHostLineMaterialUniforms(mat, cssLine, CSS_W, CSS_H, devicePxRatioFromNumber(1.5));
    const ratio15 = mat.linewidth / mat.resolution.x;
    expect(mat.linewidth).toBe(cssLine * 1.5);
    expect(mat.resolution.x).toBe(CSS_W * 1.5);
    applyHostLineMaterialUniforms(mat, cssLine, CSS_W, CSS_H, devicePxRatioFromNumber(1));
    const ratio10 = mat.linewidth / mat.resolution.x;
    expect(ratio15).toBe(cssLine / CSS_W);
    expect(ratio10).toBe(cssLine / CSS_W);
  });

  it("shader uResolution in device pixels at pr 1.5", () => {
    const out = { x: 0, y: 0 };
    hostShaderResolutionUniform(CSS_W, CSS_H, PR, out);
    expect(out).toEqual({ x: CSS_W * LAYOUT_PR, y: CSS_H * LAYOUT_PR });
  });
});
