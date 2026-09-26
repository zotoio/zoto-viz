import type { SurfaceLetterboxFill } from "../graph/letterbox-fill";
import { letterboxInnerRect, paintLetterboxBars } from "../graph/letterbox-fill";
import type { RenderHost } from "../graph/render-host";
import type { HostedView } from "../graph/render-host";

export type SandboxBitmapStats = {
  received: number;
  closed: number;
};

/** Tracks sandbox `ImageBitmap` transfers (one ingest + one close per host frame). */
export class SandboxBitmapLane {
  private pending: ImageBitmap | null = null;
  private open = new Set<ImageBitmap>();
  readonly stats: SandboxBitmapStats = { received: 0, closed: 0 };

  ingest(bitmap: ImageBitmap): void {
    this.releasePending();
    this.pending = bitmap;
    this.open.add(bitmap);
    this.stats.received += 1;
  }

  peek(): ImageBitmap | null {
    return this.pending;
  }

  openCount(): number {
    return this.open.size;
  }

  /** Draw the pending bitmap into a mirror viewport without closing (host closes after all mirrors). */
  drawMirror(
    host: RenderHost,
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    aspect: number,
  ): boolean {
    const bitmap = this.pending;
    if (!bitmap) return false;
    host.presentBitmapMirror(mirror, bitmap, fill, aspect);
    return true;
  }

  /** End of host animation frame: close the bitmap received this frame. */
  finishHostFrame(): void {
    this.releasePending();
  }

  teardown(): void {
    this.releasePending();
    for (const b of this.open) b.close();
    this.open.clear();
  }

  private releasePending(): void {
    if (!this.pending) return;
    this.pending.close();
    this.open.delete(this.pending);
    this.pending = null;
    this.stats.closed += 1;
  }
}

const lanes = new Map<string, SandboxBitmapLane>();

export function sandboxBitmapLane(pluginId: string): SandboxBitmapLane {
  let lane = lanes.get(pluginId);
  if (!lane) {
    lane = new SandboxBitmapLane();
    lanes.set(pluginId, lane);
  }
  return lane;
}

export function finishSandboxBitmapHostFrame(): void {
  for (const lane of lanes.values()) lane.finishHostFrame();
}

export function resetSandboxBitmapLanes(): void {
  for (const lane of lanes.values()) lane.teardown();
  lanes.clear();
}

export function paintPackMirrorPlaceholder(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  fill: SurfaceLetterboxFill,
  packName: string,
  mirrorsTile: number,
): void {
  const inner = letterboxInnerRect(box, box.w / Math.max(1, box.h));
  inner.x += box.x;
  inner.y += box.y;
  paintLetterboxBars(ctx, box, inner, fill);
  ctx.save();
  ctx.fillStyle = fill.css;
  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(packName, box.x + box.w / 2, box.y + box.h / 2 - 8);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "10px sans-serif";
  ctx.fillText(`mirrors tile ${mirrorsTile}`, box.x + box.w / 2, box.y + box.h / 2 + 10);
  ctx.restore();
}

export type ReadbackGuard = {
  getImageData: number;
  toDataURL: number;
  readPixels: number;
  install: () => void;
  restore: () => void;
};

export function createReadbackGuard(): ReadbackGuard {
  const guard: ReadbackGuard = {
    getImageData: 0,
    toDataURL: 0,
    readPixels: 0,
    install() {
      if (typeof CanvasRenderingContext2D === "undefined") return;
      const proto2d = CanvasRenderingContext2D.prototype;
      if (typeof proto2d.getImageData === "function") {
        const origGet = proto2d.getImageData;
        proto2d.getImageData = function (...args) {
          guard.getImageData += 1;
          return origGet.apply(this, args);
        };
      }
      if (typeof HTMLCanvasElement.prototype.toDataURL === "function") {
        const origToData = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (...args) {
          guard.toDataURL += 1;
          return origToData.apply(this, args);
        };
      }
      const wrapReadPixels = (proto: { readPixels: (...a: never[]) => void }) => {
        const origRead = proto.readPixels;
        proto.readPixels = function (...args: never[]) {
          guard.readPixels += 1;
          return origRead.apply(this, args);
        };
      };
      if (typeof WebGLRenderingContext !== "undefined") {
        wrapReadPixels(WebGLRenderingContext.prototype);
      }
      if (typeof WebGL2RenderingContext !== "undefined") {
        wrapReadPixels(WebGL2RenderingContext.prototype);
      }
    },
    restore() {
      // vitest restores mocks between tests when using vi.spyOn; manual install is test-only
    },
  };
  return guard;
}

/** Test helper: one host-frame of sandbox bitmap mirroring into duplicate tiles. */
export function runSandboxBitmapDuplicateFrame(input: {
  host: RenderHost;
  pluginId: string;
  bitmap: ImageBitmap;
  mirrors: HostedView[];
  fill: SurfaceLetterboxFill;
  aspect: number;
}): void {
  const lane = sandboxBitmapLane(input.pluginId);
  lane.ingest(input.bitmap);
  for (const mirror of input.mirrors) {
    lane.drawMirror(input.host, mirror, input.fill, input.aspect);
  }
  finishSandboxBitmapHostFrame();
}
