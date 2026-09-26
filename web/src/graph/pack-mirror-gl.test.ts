import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  PackMirrorGl,
  SandboxBitmapGl,
  type GlMirror,
  type MirrorRenderer,
} from "./pack-mirror-gl";
import { createPackMirrorArrowBitmap } from "./pack-mirror-arrow-fixture";
import { surfaceLetterboxFill } from "./letterbox-fill";

export type GlCounts = {
  createTexture: number;
  createFramebuffer: number;
  blitFramebuffer: number;
  readPixels: number;
  texSubImage2D: number;
  resetState: number;
  pixelStorei: number;
};

export type BlitCall = {
  readIsDefault: boolean;
  sx0: number;
  sy0: number;
  sx1: number;
  sy1: number;
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
};

export function createCountingGl(): { gl: GlMirror; counts: GlCounts } {
  const counts: GlCounts = {
    createTexture: 0,
    createFramebuffer: 0,
    blitFramebuffer: 0,
    readPixels: 0,
    texSubImage2D: 0,
    resetState: 0,
    pixelStorei: 0,
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
    pixelStorei() { counts.pixelStorei += 1; },
    readPixels() { counts.readPixels += 1; },
  } as GlMirror;
  return { gl, counts };
}

/** Stub: antialias default FB + INVALID_OPERATION when READ default blit resizes. */
export function createMsaaValidationGl(): {
  gl: GlMirror;
  counts: GlCounts;
  invalidBlitOps: number;
  blitCalls: BlitCall[];
  contextAttributes: { antialias: boolean };
} {
  const base = createCountingGl();
  let readFb: WebGLFramebuffer | null = null;
  const invalid = { ops: 0 };
  const blitCalls: BlitCall[] = [];
  const gl = {
    ...base.gl,
    bindFramebuffer(target: number, fb: WebGLFramebuffer | null) {
      if (target === base.gl.READ_FRAMEBUFFER) readFb = fb;
      base.gl.bindFramebuffer(target, fb);
    },
    blitFramebuffer(
      sx0: number,
      sy0: number,
      sx1: number,
      sy1: number,
      dx0: number,
      dy0: number,
      dx1: number,
      dy1: number,
    ) {
      const sw = sx1 - sx0;
      const sh = sy1 - sy0;
      const dw = dx1 - dx0;
      const dh = dy1 - dy0;
      const readIsDefault = readFb === null;
      blitCalls.push({ readIsDefault, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1 });
      if (readIsDefault && (sx0 !== dx0 || sy0 !== dy0 || sw !== Math.abs(dw) || sh !== Math.abs(dh))) {
        invalid.ops += 1;
      }
      base.counts.blitFramebuffer += 1;
    },
  } as GlMirror;
  return {
    gl,
    counts: base.counts,
    get invalidBlitOps() { return invalid.ops; },
    blitCalls,
    contextAttributes: { antialias: true },
  };
}

function countingRenderer(counts: GlCounts, packFb: WebGLFramebuffer): MirrorRenderer {
  const props = new Map<THREE.WebGLRenderTarget, { __webGLFramebuffer: WebGLFramebuffer }>();
  return {
    resetState() { counts.resetState += 1; },
    setScissorTest() {},
    setViewport() {},
    setScissor() {},
    setClearColor() {},
    clear() {},
    getPixelRatio() { return 1; },
    setRenderTarget() {},
    render() {},
    properties: {
      get(rt: THREE.WebGLRenderTarget) {
        if (!props.has(rt)) props.set(rt, { __webGLFramebuffer: packFb });
        return props.get(rt)!;
      },
      remove() {},
    },
  };
}

/** Removed product path — MSAA default READ blit with mismatched src/dst (invalid on 1x). */
function capturePrimaryFromDefaultMsaaTrap(
  gl: GlMirror,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): void {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, {} as WebGLFramebuffer);
  gl.blitFramebuffer(sx, sy, sx + sw, sy + sh, 0, 0, sw, sh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
}

describe("PackMirrorGl MSAA stub", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);

  it("records INVALID_OPERATION for default READ blit when primary is off-origin (legacy capture)", () => {
    const stub = createMsaaValidationGl();
    expect(stub.contextAttributes.antialias).toBe(true);
    capturePrimaryFromDefaultMsaaTrap(stub.gl, 40, 30, 64, 48);
    expect(stub.invalidBlitOps).toBe(1);
  });

  it("pack RT path: off-origin primary + duplicate blits — zero MSAA-invalid default READ ops", () => {
    const stub = createMsaaValidationGl();
    const { gl, counts } = stub;
    const packFb = {} as WebGLFramebuffer;
    const rd = countingRenderer(counts, packFb);
    const mirror = new PackMirrorGl();
    mirror.ensureRenderTarget(rd, 64, 48);
    mirror.markPackRendered();
    mirror.blitPrimaryToDefault(gl, rd, { x: 40, y: 30, w: 64, h: 48 }, 1);
    mirror.blitDuplicateToDefault(gl, rd, fill, { x: 200, y: 10, w: 100, h: 80 }, 1, 64 / 48);
    expect(stub.invalidBlitOps).toBe(0);
    expect(counts.blitFramebuffer).toBeGreaterThanOrEqual(2);
    mirror.dispose(gl, rd);
  });
});

describe("PackMirrorGl (counting GL stub)", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);
  const dst = { x: 10, y: 10, w: 200, h: 100 };
  const packFb = {} as WebGLFramebuffer;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("300 frames / two tiles: one RT, primary+duplicate blit per frame, resetState per blit, zero readPixels", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts, packFb);
    const mirror = new PackMirrorGl();
    for (let i = 0; i < 300; i++) {
      mirror.beginFrame();
      mirror.ensureRenderTarget(rd, 64, 48);
      mirror.markPackRendered();
      mirror.blitPrimaryToDefault(gl, rd, { x: 0, y: 0, w: 64, h: 48 }, 1);
      mirror.blitDuplicateToDefault(gl, rd, fill, dst, 1, 64 / 48);
    }
    expect(counts.blitFramebuffer).toBe(300 * 2);
    expect(counts.resetState).toBe(counts.blitFramebuffer);
    expect(counts.readPixels).toBe(0);
    mirror.dispose(gl, rd);
  });

  it("resize reallocates WebGLRenderTarget exactly once", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts, packFb);
    const mirror = new PackMirrorGl();
    const rt1 = mirror.ensureRenderTarget(rd, 64, 48);
    mirror.markPackRendered();
    mirror.blitPrimaryToDefault(gl, rd, { x: 0, y: 0, w: 64, h: 48 }, 1);
    expect(rt1).not.toBeNull();
    const rt2 = mirror.ensureRenderTarget(rd, 128, 96);
    expect(rt2).not.toBe(rt1);
    mirror.dispose(gl, rd);
  });
});

describe("SandboxBitmapGl (counting GL stub)", () => {
  it("texSubImage2D once per frame, Y-flipped blit, no UNPACK_FLIP_Y; realloc on size change only", async () => {
    const { gl, counts, blitCalls } = createMsaaValidationGl();
    const packFb = {} as WebGLFramebuffer;
    const rd = countingRenderer(counts, packFb);
    const gpu = new SandboxBitmapGl();
    const fill = surfaceLetterboxFill(0x0a1020, 0.25);
    const dst = { x: 0, y: 0, w: 100, h: 80 };
    await createPackMirrorArrowBitmap();
    for (let i = 0; i < 300; i++) {
      const frame = Object.create(ImageBitmap.prototype) as ImageBitmap;
      Object.defineProperties(frame, {
        width: { value: 32 },
        height: { value: 24 },
        close: { value: vi.fn() },
      });
      gpu.uploadFrame(gl, rd, frame);
      gpu.blitToDefault(gl, rd, fill, dst, 1, 32 / 24);
    }
    expect(counts.pixelStorei).toBe(0);
    expect(counts.createTexture).toBe(1);
    expect(counts.createFramebuffer).toBe(1);
    expect(counts.texSubImage2D).toBe(300);
    expect(counts.blitFramebuffer).toBe(300);
    const packBlits = blitCalls.filter((b) => !b.readIsDefault);
    expect(packBlits.length).toBeGreaterThan(0);
    for (const b of packBlits) {
      expect(b.dy0).toBeGreaterThan(b.dy1);
    }
    const bigger = Object.create(ImageBitmap.prototype) as ImageBitmap;
    Object.defineProperties(bigger, { width: { value: 64 }, height: { value: 48 }, close: { value: vi.fn() } });
    gpu.uploadFrame(gl, rd, bigger);
    expect(counts.createTexture).toBe(2);
    gpu.dispose(gl);
  });
});
