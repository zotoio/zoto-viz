import type { SurfaceLetterboxFill } from "../graph/letterbox-fill";
import { letterboxInnerRect, paintLetterboxBars } from "../graph/letterbox-fill";
import type { HostedView, RenderHost, Viewport } from "../graph/render-host";

export type SandboxBitmapStats = {
  received: number;
  closed: number;
};

/** Tracks sandbox `ImageBitmap` transfers (one ingest + one close per host frame). */
export class SandboxBitmapLane {
  private pending: ImageBitmap | null = null;
  private open = new Set<ImageBitmap>();
  private publishFailed = false;
  generation = 0;
  readonly stats: SandboxBitmapStats = { received: 0, closed: 0 };

  constructor(private readonly pluginId: string) {}

  ingest(bitmap: ImageBitmap, gen: number): void {
    if (gen !== this.generation) {
      bitmap.close();
      return;
    }
    this.releasePending();
    this.publishFailed = false;
    this.pending = bitmap;
    this.open.add(bitmap);
    this.stats.received += 1;
  }

  notePublishFailed(gen: number): void {
    if (gen !== this.generation) return;
    this.publishFailed = true;
  }

  markPublishFailed(): void {
    this.notePublishFailed(this.generation);
  }

  shouldShowFailurePlaceholder(): boolean {
    return this.publishFailed && !this.pending;
  }

  peek(): ImageBitmap | null {
    return this.pending;
  }

  openCount(): number {
    return this.open.size;
  }

  drawMirror(
    host: RenderHost,
    mirror: HostedView,
    fill: SurfaceLetterboxFill,
    aspect: number,
    releaseBitmap = true,
  ): Viewport | null {
    const bitmap = this.pending;
    if (!bitmap) return null;
    const vp = host.presentBitmapMirror(mirror, bitmap, fill, aspect, this.pluginId, releaseBitmap);
    if (releaseBitmap) this.clearPendingAfterPresent();
    return vp;
  }

  /** Host present closed the bitmap; drop the handle without a second close. */
  clearPendingAfterPresent(): void {
    if (!this.pending) return;
    this.open.delete(this.pending);
    this.pending = null;
    this.stats.closed += 1;
  }

  finishHostFrame(): void {
    this.releasePending();
  }

  bumpGeneration(): void {
    this.generation += 1;
    this.releasePending();
    this.publishFailed = false;
    for (const b of this.open) b.close();
    this.open.clear();
  }

  teardown(): void {
    this.bumpGeneration();
  }

  private releasePending(): void {
    if (!this.pending) return;
    this.pending.close();
    this.open.delete(this.pending);
    this.pending = null;
    this.stats.closed += 1;
  }

  /** @deprecated use clearPendingAfterPresent */
  clearPendingAfterGpuUpload(): void {
    this.clearPendingAfterPresent();
  }
}

class LaneRegistry {
  private lanes = new Map<string, SandboxBitmapLane>();

  lane(pluginId: string): SandboxBitmapLane {
    let lane = this.lanes.get(pluginId);
    if (!lane) {
      lane = new SandboxBitmapLane(pluginId);
      this.lanes.set(pluginId, lane);
    }
    return lane;
  }

  ingest(pluginId: string, bitmap: ImageBitmap): void {
    const lane = this.lane(pluginId);
    lane.ingest(bitmap, lane.generation);
  }

  notePublishFailed(pluginId: string): void {
    this.lane(pluginId).markPublishFailed();
  }

  teardownPlugin(pluginId: string): void {
    this.lanes.get(pluginId)?.teardown();
    this.lanes.delete(pluginId);
  }

  finishHostFrame(): void {
    for (const lane of this.lanes.values()) lane.finishHostFrame();
  }

  resetAll(): void {
    for (const lane of this.lanes.values()) lane.teardown();
    this.lanes.clear();
  }
}

export const laneRegistry = new LaneRegistry();

export function sandboxBitmapLane(pluginId: string): SandboxBitmapLane {
  return laneRegistry.lane(pluginId);
}

export function finishSandboxBitmapHostFrame(): void {
  laneRegistry.finishHostFrame();
}

export function resetSandboxBitmapLanes(): void {
  laneRegistry.resetAll();
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
  ctx.fillRect(box.x, box.y, box.w, box.h);
  if (fill.grain > 0.01) {
    const n = Math.min(200, Math.floor(box.w * box.h * 0.015));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(255,255,255,${(0.04 + fill.grain * 0.08) * Math.random()})`;
      ctx.fillRect(box.x + Math.random() * box.w, box.y + Math.random() * box.h, 1, 1);
    }
  }
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
    restore() {},
  };
  return guard;
}

export function runSandboxBitmapDuplicateFrame(input: {
  host: RenderHost;
  pluginId: string;
  bitmap: ImageBitmap;
  mirrors: HostedView[];
  fill: SurfaceLetterboxFill;
  aspect: number;
}): void {
  const lane = sandboxBitmapLane(input.pluginId);
  lane.ingest(input.bitmap, lane.generation);
  const mirrors = input.mirrors;
  for (let i = 0; i < mirrors.length; i++) {
    lane.drawMirror(input.host, mirrors[i], input.fill, input.aspect, i === mirrors.length - 1);
  }
  finishSandboxBitmapHostFrame();
}
