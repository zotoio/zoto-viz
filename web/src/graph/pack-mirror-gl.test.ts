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
  createRenderbuffer: number;
  deleteFramebuffer: number;
  deleteTexture: number;
  deleteRenderbuffer: number;
  blitFramebuffer: number;
  readPixels: number;
  texSubImage2D: number;
  resetState: number;
  pixelStorei: number;
};

export type BlitCall = {
  readFb: WebGLFramebuffer | null;
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
    createRenderbuffer: 0,
    deleteFramebuffer: 0,
    deleteTexture: 0,
    deleteRenderbuffer: 0,
    blitFramebuffer: 0,
    readPixels: 0,
    texSubImage2D: 0,
    resetState: 0,
    pixelStorei: 0,
  };
  const fbs: WebGLFramebuffer[] = [];
  const tex = {} as WebGLTexture;
  const rb = {} as WebGLRenderbuffer;
  const gl = {
    COLOR_BUFFER_BIT: 0x4000,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    RENDERBUFFER: 0x8d41,
    COLOR_ATTACHMENT0: 0x8ce0,
    TEXTURE_2D: 0x0de1,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    UNSIGNED_BYTE: 0x1401,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    SCISSOR_TEST: 0x0c11,
    bindFramebuffer() {},
    bindTexture() {},
    bindRenderbuffer() {},
    blitFramebuffer() { counts.blitFramebuffer += 1; },
    createFramebuffer() {
      counts.createFramebuffer += 1;
      const fb = {} as WebGLFramebuffer;
      fbs.push(fb);
      return fb;
    },
    createTexture() { counts.createTexture += 1; return tex; },
    createRenderbuffer() { counts.createRenderbuffer += 1; return rb; },
    deleteFramebuffer() { counts.deleteFramebuffer += 1; },
    deleteTexture() { counts.deleteTexture += 1; },
    deleteRenderbuffer() { counts.deleteRenderbuffer += 1; },
    renderbufferStorageMultisample() {},
    framebufferRenderbuffer() {},
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
  return { gl, counts, fbs };
}

/** Stub: antialias default FB + INVALID_OPERATION when READ default blit mismatches. */
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
      blitCalls.push({ readFb, readIsDefault, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1 });
      if (readIsDefault && (sx0 !== dx0 || sy0 !== dy0 || sw !== Math.abs(dw) || sh !== Math.abs(dh))) {
        invalid.ops += 1;
      }
      base.counts.blitFramebuffer += 1;
    },
  } as GlMirror;
  return {
    gl,
    counts: base.counts,
    fbs: base.fbs,
    get invalidBlitOps() { return invalid.ops; },
    blitCalls,
    contextAttributes: { antialias: true },
  };
}

function countingRenderer(counts: GlCounts, packFb?: WebGLFramebuffer): MirrorRenderer {
  const props = new Map<THREE.WebGLRenderTarget, { __webGLFramebuffer?: WebGLFramebuffer }>();
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

function framePackMirror(
  mirror: PackMirrorGl,
  gl: GlMirror,
  rd: MirrorRenderer,
  antialias: boolean,
  dst: { x: number; y: number; w: number; h: number },
  fill: ReturnType<typeof surfaceLetterboxFill>,
): void {
  mirror.beginFrame();
  mirror.ensurePackTargets(gl, rd, 64, 48, antialias);
  mirror.resolvePackRender(gl, rd, antialias);
  mirror.blitPrimaryToDefault(gl, rd, { x: 0, y: 0, w: 64, h: 48 }, 1);
  mirror.blitDuplicateToDefault(gl, rd, fill, dst, 1, 64 / 48);
}

describe("PackMirrorGl duplicate scope", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);
  const dst = { x: 10, y: 10, w: 200, h: 100 };
  it("single tile: 300 frames with scope off — zero framebuffer and blit", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(false, gl, rd, { antialias: false });
    for (let i = 0; i < 300; i++) {
      mirror.beginFrame();
      mirror.ensurePackTargets(gl, rd, 64, 48, false);
    }
    expect(counts.createFramebuffer).toBe(0);
    expect(counts.blitFramebuffer).toBe(0);
    mirror.dispose(gl, rd);
  });

  it("enabling duplicate scope creates exactly one resolve framebuffer", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, gl, rd, { antialias: false });
    mirror.ensurePackTargets(gl, rd, 64, 48, false);
    expect(counts.createFramebuffer).toBe(1);
    mirror.dispose(gl, rd);
  });

  it("removing duplicate scope deletes targets on the same call", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, gl, rd, { antialias: false });
    mirror.ensurePackTargets(gl, rd, 64, 48, false);
    mirror.setDuplicateScope(false, gl, rd);
    expect(counts.deleteFramebuffer).toBeGreaterThanOrEqual(1);
    expect(counts.deleteTexture).toBeGreaterThanOrEqual(1);
  });
});

describe("PackMirrorGl MSAA resolve stub", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);
  const dst = { x: 200, y: 10, w: 100, h: 80 };
  it("records INVALID_OPERATION for legacy default READ capture off-origin", () => {
    const stub = createMsaaValidationGl();
    capturePrimaryFromDefaultMsaaTrap(stub.gl, 40, 30, 64, 48);
    expect(stub.invalidBlitOps).toBe(1);
  });

  it("antialias on: one equal-bounds resolve blit per frame, one scaled blit per tile, zero invalid ops", () => {
    const stub = createMsaaValidationGl();
    const rd = countingRenderer(stub.counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, stub.gl, rd, { antialias: true });
    mirror.ensurePackTargets(stub.gl, rd, 64, 48, true);
    const resolveFb = stub.fbs[0]!;
    const msaaReadFb = stub.fbs[1]!;
    for (let i = 0; i < 3; i++) framePackMirror(mirror, stub.gl, rd, true, dst, fill);
    const resolveBlits = stub.blitCalls.filter((b) =>
      b.readFb === msaaReadFb
      && b.sx0 === 0 && b.sy0 === 0 && b.sx1 === 64 && b.sy1 === 48
      && b.dx0 === 0 && b.dy0 === 0 && b.dx1 === 64 && b.dy1 === 48);
    expect(resolveBlits).toHaveLength(3);
    const tileBlits = stub.blitCalls.filter((b) => b.readFb === resolveFb);
    expect(tileBlits.length).toBeGreaterThanOrEqual(6);
    expect(stub.invalidBlitOps).toBe(0);
    mirror.dispose(stub.gl, rd);
  });

  it("antialias off: no MSAA resolve blit from multisample read FBO", () => {
    const stub = createMsaaValidationGl();
    const rd = countingRenderer(stub.counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, stub.gl, rd, { antialias: false });
    mirror.ensurePackTargets(stub.gl, rd, 64, 48, false);
    const resolveFb = stub.fbs[0]!;
    framePackMirror(mirror, stub.gl, rd, false, dst, fill);
    const resolveBlits = stub.blitCalls.filter((b) =>
      b.readFb !== resolveFb && b.sx1 - b.sx0 === 64 && b.dx1 - b.dx0 === 64);
    expect(resolveBlits).toHaveLength(0);
    mirror.dispose(stub.gl, rd);
  });

  it("pack RT path off-origin: zero MSAA-invalid default READ ops", () => {
    const stub = createMsaaValidationGl();
    const rd = countingRenderer(stub.counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, stub.gl, rd, { antialias: true });
    framePackMirror(mirror, stub.gl, rd, true, dst, fill);
    mirror.blitPrimaryToDefault(stub.gl, rd, { x: 40, y: 30, w: 64, h: 48 }, 1);
    expect(stub.invalidBlitOps).toBe(0);
    mirror.dispose(stub.gl, rd);
  });
});

describe("PackMirrorGl (counting GL stub)", () => {
  const fill = surfaceLetterboxFill(0x0a1020, 0.25);
  const dst = { x: 10, y: 10, w: 200, h: 100 };
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("300 frames / two tiles: primary+duplicate blit per frame, resetState per blit, zero readPixels", () => {
    const { gl, counts } = createCountingGl();
    const rd = countingRenderer(counts);
    const mirror = new PackMirrorGl();
    mirror.setDuplicateScope(true, gl, rd, { antialias: false });
    mirror.ensurePackTargets(gl, rd, 64, 48, false);
    for (let i = 0; i < 300; i++) {
      mirror.beginFrame();
      mirror.resolvePackRender(gl, rd, false);
      mirror.blitPrimaryToDefault(gl, rd, { x: 0, y: 0, w: 64, h: 48 }, 1);
      mirror.blitDuplicateToDefault(gl, rd, fill, dst, 1, 64 / 48);
    }
    expect(counts.blitFramebuffer).toBe(300 * 2);
    expect(counts.resetState).toBe(counts.blitFramebuffer);
    expect(counts.readPixels).toBe(0);
    mirror.dispose(gl, rd);
  });
});

describe("SandboxBitmapGl (counting GL stub)", () => {
  it("texSubImage2D once per frame, Y-flipped blit, no UNPACK_FLIP_Y; realloc on size change only", async () => {
    const { gl, counts, blitCalls } = createMsaaValidationGl();
    const rd = countingRenderer(counts);
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
