import { afterEach, describe, expect, it, vi } from "vitest";
import { PackMirrorGl, SandboxBitmapGl, type GlMirror, type MirrorRenderer } from "./pack-mirror-gl";
import { surfaceLetterboxFill } from "./letterbox-fill";

export type GlCounts = {
  createTexture: number;
  createFramebuffer: number;
  blitFramebuffer: number;
  readPixels: number;
  texSubImage2D: number;
  resetState: number;
};

export function createCountingGl(): { gl: GlMirror; counts: GlCounts } {
  const counts: GlCounts = {
    createTexture: 0,
    createFramebuffer: 0,
    blitFramebuffer: 0,
    readPixels: 0,
    texSubImage2D: 0,
    resetState: 0,
  };
  const fb = {} as WebGLFramebuffer;
  const tex = {} as WebGLTexture;
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    COLOR_ATTACHMENT0: 0x8ce0,
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    SCISSOR_TEST: 0x0c11,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    bindFramebuffer() {},
    bindTexture() {},
    blitFramebuffer() { counts.blitFramebuffer += 1; },
    createFramebuffer() { counts.createFramebuffer += 1; return fb; },
    createTexture() { counts.createTexture += 1; return tex; },
    deleteFramebuffer() {},
    deleteTexture() {},
    enable() {},
    disable() {},
    scissor() {},
    viewport() {},
    clearColor() {},
    clear() {},
    texParameteri() {},
    texImage2D() {},
    texSubImage2D() { counts.texSubImage2D += 1; },
    framebufferTexture2D() {},
    pixelStorei() {},
    readPixels() { counts.readPixels += 1; },
  } as GlMirror;
  return { gl, counts };
}

function countingRenderer(counts: GlCounts): MirrorRenderer {
  return {
    resetState() { counts.resetState += 1; },
    setScissorTest() {},
    setViewport() {},
    setScissor() {},
    setClearColor() {},
    clear() {},
    getPixelRatio() { return 1; },
  };
}

describe("PackMirrorGl (counting GL stub)", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);
  const dst = { x: 10, y: 10, w: 200, h: 100 };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("300 frames / two tiles: one texture+FBO, one duplicate blit per frame, resetState per blit, zero readPixels", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    for (let i = 0; i < 300; i++) {
      mirror.beginFrame();
      mirror.capturePrimaryFromDefault(gl, rd, 0, 0, 64, 48);
      mirror.blitDuplicateToDefault(gl, rd, fill, dst, 1, 64 / 48);
    }
    expect(counts.createTexture).toBe(1);
    expect(counts.createFramebuffer).toBe(1);
    expect(counts.blitFramebuffer).toBe(300 * 2);
    expect(counts.resetState).toBe(counts.blitFramebuffer);
    expect(counts.readPixels).toBe(0);
    mirror.dispose(gl);
    mirror.beginFrame();
    expect(counts.blitFramebuffer).toBe(300 * 2);
    mirror.dispose(gl);
  });

  it("resize reallocates texture and framebuffer exactly once", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    mirror.capturePrimaryFromDefault(gl, rd, 0, 0, 64, 48);
    mirror.blitDuplicateToDefault(gl, rd, fill, dst, 1, 1);
    expect(counts.createTexture).toBe(1);
    mirror.capturePrimaryFromDefault(gl, rd, 0, 0, 128, 96);
    expect(counts.createTexture).toBe(2);
    expect(counts.createFramebuffer).toBe(2);
    mirror.dispose(gl);
  });
});

describe("SandboxBitmapGl (counting GL stub)", () => {
  it("texSubImage2D once per frame and one blit per mirror; realloc on size change only", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const gpu = new SandboxBitmapGl();
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    const dst = { x: 0, y: 0, w: 100, h: 80 };
    for (let i = 0; i < 300; i++) {
      const frame = Object.create(ImageBitmap.prototype) as ImageBitmap;
      Object.defineProperties(frame, { width: { value: 32 }, height: { value: 24 }, close: { value: vi.fn() } });
      gpu.uploadFrame(gl, rd, frame);
      gpu.blitToDefault(gl, rd, fill, dst, 1, 32 / 24);
    }
    expect(counts.createTexture).toBe(1);
    expect(counts.createFramebuffer).toBe(1);
    expect(counts.texSubImage2D).toBe(300);
    expect(counts.blitFramebuffer).toBe(300);
    expect(counts.readPixels).toBe(0);
    const bigger = Object.create(ImageBitmap.prototype) as ImageBitmap;
    Object.defineProperties(bigger, { width: { value: 64 }, height: { value: 48 }, close: { value: vi.fn() } });
    gpu.uploadFrame(gl, rd, bigger);
    expect(counts.createTexture).toBe(2);
    gpu.dispose(gl);
  });
});
