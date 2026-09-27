#!/usr/bin/env python3
"""Regenerate revert-proofs/*.patch from HEAD via git diff (zero apply offset)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PATCHES_42: dict[str, list[tuple[str, str, str]]] = {
    "device-px-ratio-change-1-to-2-revert": [
        (
            "web/src/graph/render-host-device-px-ratio.ts",
            """    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    if (next !== prev) notifyLayoutListeners(next);""",
            """    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    void prev;
    void next;""",
        ),
    ],
    "device-px-ratio-change-resize-without-cap-revert": [
        (
            "web/src/graph/render-host-device-px-ratio.ts",
            """    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    if (next !== prev) notifyLayoutListeners(next);""",
            """    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    notifyLayoutListeners(next);""",
        ),
        (
            "web/src/graph/render-host.ts",
            "    if (Math.abs(pr - this.pr) < 0.01) return;",
            "",
        ),
    ],
    "device-px-ratio-getter-window-prop-read-revert": [
        (
            "web/src/graph/render-host-device-px-ratio.ts",
            "export function layoutDevicePxRatio(): DevicePxRatio {",
            "export function layoutDevicePxRatio(): DevicePxRatio {\n  void window.devicePixelRatio;",
        ),
    ],
    "device-px-ratio-read-stray": [
        (
            "web/src/core/fps.ts",
            "/**",
            "void devicePixelRatio;\n/**",
        ),
    ],
    "device-px-ratio-rearm-stale-revert": [
        (
            "web/src/graph/render-host-device-px-ratio.ts",
            """    cachedLayoutRatio = next;
    rearmResolutionMediaQuery(raw);
    if (next !== prev) notifyLayoutListeners(next);""",
            """    cachedLayoutRatio = next;

    if (next !== prev) notifyLayoutListeners(next);""",
        ),
    ],
    "pack-mirror-brand-cast": [
        (
            "web/src/graph/render-host-gl-adapter.ts",
            """  renderer.setScissor(glScratch.x, glScratch.y, glScratch.w, glScratch.h);
}

/** Host GPU pane box""",
            """  renderer.setScissor(glScratch.x, glScratch.y, glScratch.w, glScratch.h);
}

void (null as DeviceRect);

/** Host GPU pane box""",
        ),
    ],
    "pack-mirror-capture-rounding": [
        (
            "web/src/graph/pack-mirror-rect.ts",
            """  toDeviceRectInto(
    cssRect(box.x, topY, box.w, box.h),
    pixelRatio,
    out,
  );
  if (canvasDevicePx !== undefined) {""",
            """  const pr = pixelRatio;
  out.x = cssBoxDim(box.x) * pr;
  out.y = topY * pr;
  out.w = cssBoxDim(box.w) * pr;
  out.h = cssBoxDim(box.h) * pr;
  Object.defineProperty(out, "__unit", { value: "device", enumerable: true });
  if (canvasDevicePx !== undefined) {""",
        ),
    ],
    "render-host-gpu-viewport-css-dpr2-cap-revert": [
        (
            "web/src/graph/render-host-device-px-ratio.ts",
            "  return Math.min(n, layoutMaxDevicePxRatio) as DevicePxRatio;",
            "  return n as DevicePxRatio;",
        ),
    ],
    "render-host-layout-dpr-legacy-stage3d-175-revert": [
        (
            "web/src/arcade/stage3d.ts",
            "    const dpr = devicePxRatioNumber(layoutDevicePxRatio());",
            "    const dpr = Math.min(1.75, devicePixelRatio || 1);",
        ),
    ],
    "render-host-layout-dpr-feed-dpr2-revert": [
        (
            "web/src/ui/feed.ts",
            "    const dpr = devicePxRatioNumber(layoutDevicePxRatio());",
            "    const dpr = Math.min(2, devicePixelRatio || 1);",
        ),
    ],
    "render-host-set-pixel-ratio-auto-tune-revert": [
        (
            "web/src/graph/render-host.ts",
            """  /** Whole-wall layout DPR (auto-tune). Backing store scales here; renderer pixel ratio stays 1. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.layoutDevicePxRatio = devicePxRatioFromNumber(pr);
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    if (!this.software) {
      this.renderer.setPixelRatio(1);
      this.resizeGpuCanvas();
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
  }""",
            """  /** Whole-wall layout DPR (auto-tune). Backing store scales here; renderer pixel ratio stays 1. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.layoutDevicePxRatio = devicePxRatioFromNumber(pr);
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    if (!this.software) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(this.w, this.h, false);
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
  }""",
        ),
    ],
    "render-host-dispose-layout-dpr-unsub-revert": [
        (
            "web/src/graph/render-host.ts",
            """  dispose(): void {
    this.disposed = true;
    this.unsubLayoutDpi?.();
    cancelAnimationFrame(this.raf);""",
            """  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);""",
        ),
    ],
    "render-host-software-present-brand-revert": [
        (
            "web/src/graph/render-host.ts",
            """    if (this.software) {
      return viewMutAsDeviceRect(this.fbDeviceViewport);
    }
    toGlRectInto(
      viewMutAsDeviceRect(this.fbDeviceViewport),""",
            """    if (this.software) {
      return { x: this.fbDeviceViewport.x, y: this.fbDeviceViewport.y, w: this.fbDeviceViewport.w, h: this.fbDeviceViewport.h };
    }
    toGlRectInto(
      viewMutAsDeviceRect(this.fbDeviceViewport),""",
        ),
    ],
    "render-host-gpu-viewport-css-revert": [
        (
            "web/src/graph/render-host.ts",
            """        this.software = false;
        this.renderer.setPixelRatio(1);
        this.renderer.setClearColor(0x000000, 0);
        this.canvas = this.renderer.domElement;
        this.refreshContextAntialias();
      } catch {""",
            """        this.software = false;
        this.renderer.setPixelRatio(this.pr);
        this.renderer.setClearColor(0x000000, 0);
        this.canvas = this.renderer.domElement;
        this.refreshContextAntialias();
      } catch {""",
        ),
        (
            "web/src/graph/render-host.ts",
            """  /** Whole-wall layout DPR (auto-tune). Backing store scales here; renderer pixel ratio stays 1. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.layoutDevicePxRatio = devicePxRatioFromNumber(pr);
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    if (!this.software) {
      this.renderer.setPixelRatio(1);
      this.resizeGpuCanvas();
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
  }

  private readonly packMirrorHostGl""",
            """  /** Whole-wall layout DPR (auto-tune). Backing store scales here; renderer pixel ratio stays 1. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.layoutDevicePxRatio = devicePxRatioFromNumber(pr);
    this.pr = devicePxRatioNumber(this.layoutDevicePxRatio);
    if (!this.software) {
      this.renderer.setPixelRatio(pr);
      this.resizeGpuCanvas();
    } else {
      this.resizeSoftware();
    }
    this.dirty = true;
  }

  private readonly packMirrorHostGl""",
        ),
        (
            "web/src/graph/render-host.ts",
            """  private resizeGpuCanvas(): void {
    const pr = this.pr;
    const devW = Math.max(1, Math.round(this.w * pr));
    const devH = Math.max(1, Math.round(this.h * pr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(devW, devH, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.refreshCanvasDeviceHeight();
  }""",
            """  private resizeGpuCanvas(): void {
    const pr = this.pr;
    const devW = Math.max(1, Math.round(this.w * pr));
    const devH = Math.max(1, Math.round(this.h * pr));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.refreshCanvasDeviceHeight();
  }""",
        ),
    ],
}

PATCHES_86: dict[str, list[tuple[str, str, str]]] = {
    "material-needs-update": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            """    if (this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }""",
            """    this.material.map = texture;
    this.material.needsUpdate = true;""",
        ),
    ],
    "one-mirror-per-pack": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            """    for (const [key, scope] of scopes) {
      if (scope.tileCount < 2) continue;
      if (!this.sessions.has(key)) {
        this.sessions.set(key, new PackMirrorSession());
        this.allocationCount += 1;
      }
    }
  }""",
            """    for (const [key, scope] of scopes) {
      if (scope.tileCount < 2) continue;
      if (!this.sessions.has(key)) {
        if (!this.sessions.size) this.sessions.set(key, new PackMirrorSession());
        else this.sessions.set(key, [...this.sessions.values()][0]);
        this.allocationCount += 1;
      }
    }
  }""",
        ),
    ],
    "pack-mirror-device-size-into": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            "  deviceSizeFromCssBoxInto,",
            "  deviceSizeFromCssBox,\n  deviceSizeFromCssBoxInto,",
        ),
        (
            "web/src/graph/pack-mirror-gl.ts",
            """    deviceSizeFromCssBoxInto(box, hostGl.layoutPixelRatio, this.devicePackSizeScratch);
    return session.renderPack(renderer, scene, camera, box, this.devicePackSizeScratch, clearHex, antialias);""",
            """    const size = deviceSizeFromCssBox(box, hostGl.layoutPixelRatio);
    return session.renderPack(renderer, scene, camera, box, size, clearHex, antialias);""",
        ),
    ],
    "pack-mirror-device-size-origin": [
        (
            "web/src/graph/pack-mirror-rect.ts",
            """export function deviceSizeFromCssBoxInto(
  box: CssRectLoose,
  pixelRatio: number,
  out: DeviceSizeMut,
): DeviceSizeMut {
  const pr = pixelRatio;
  const bx = cssBoxDim(box.x);
  const by = cssBoxDim(box.y);
  const bw = cssBoxDim(box.w);
  const bh = cssBoxDim(box.h);""",
            """export function deviceSizeFromCssBoxInto(
  box: CssRectLoose,
  pixelRatio: number,
  out: DeviceSizeMut,
): DeviceSizeMut {
  const pr = pixelRatio;
  const bx = box.x ?? 0;
  const by = box.y ?? 0;
  const bw = box.w;
  const bh = box.h;""",
        ),
    ],
    "pack-mirror-letterbox-16x9": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            "      letterboxInnerRectInto(dst, contentAspect, innerTd);",
            """      innerTd.x = 0;
      innerTd.y = 0;
      innerTd.w = dst.w;
      innerTd.h = dst.h;""",
        ),
    ],
    "pack-mirror-letterbox-viewport-y": [
        (
            "web/src/graph/render-host-gl-adapter.ts",
            "  renderer.setViewport(glScratch.x, glScratch.y, glScratch.w, glScratch.h);",
            "  renderer.setViewport(glScratch.x, glScratch.y + 100, glScratch.w, glScratch.h);",
        ),
    ],
    "samples-gated-on-antialias": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            """  ensure(pw: number, ph: number, antialias: boolean): THREE.WebGLRenderTarget | null {
    if (pw < 2 || ph < 2) return null;
    const samples = antialias ? PACK_MSAA_SAMPLES : 0;
    if (!this.rt) {""",
            """  ensure(pw: number, ph: number, antialias: boolean): THREE.WebGLRenderTarget | null {
    if (pw < 2 || ph < 2) return null;
    const samples = 0;
    if (!this.rt) {""",
        ),
    ],
    "scene-letterbox-fill-cache-revert": [
        (
            "web/src/graph/letterbox-fill.ts",
            """export function getSurfaceLetterboxFill(clearHex: number, grain = 0.25): SurfaceLetterboxFill {
  if (cachedClearHex === clearHex && cachedFill) return cachedFill;
  letterboxFillStats.rebuilds += 1;
  cachedClearHex = clearHex;
  cachedFill = surfaceLetterboxFill(clearHex, grain);
  return cachedFill;
}""",
            """export function getSurfaceLetterboxFill(clearHex: number, grain = 0.25): SurfaceLetterboxFill {
  letterboxFillStats.rebuilds += 1;
  return surfaceLetterboxFill(clearHex, grain);
}""",
        ),
    ],
    "setSize-only-on-resize": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            """    if (pw !== this.pw || ph !== this.ph) {
      this.rt.setSize(pw, ph);
      packMirrorResourceStats.renderTargetSetSize += 1;
      this.pw = pw;
      this.ph = ph;
    }
    return this.rt;
  }

  renderPack(""",
            """    if (pw !== this.pw || ph !== this.ph) {
      this.rt.dispose();
      packMirrorResourceStats.renderTargetDisposed += 1;
      this.rt = new THREE.WebGLRenderTarget(pw, ph, {
        depthBuffer: true,
        stencilBuffer: false,
        samples,
      });
      packMirrorResourceStats.renderTargetCreated += 1;
      this.pw = pw;
      this.ph = ph;
    }
    return this.rt;
  }

  renderPack(""",
        ),
    ],
    "teardown-dispose-counts": [
        (
            "web/src/graph/pack-mirror-gl.ts",
            """  dispose(): void {
    if (this.rt) {
      this.rt.dispose();
      packMirrorResourceStats.renderTargetDisposed += 1;
    }
    this.rt = null;
    this.pw = 0;
    this.ph = 0;
    this.samples = -1;
    this.rendered = false;
    this.presenter.dispose();
  }

  ensure(pw: number, ph: number, antialias: boolean):""",
            """  dispose(): void {
    if (this.rt) {
      this.rt.dispose();
      packMirrorResourceStats.renderTargetDisposed += 1;
    }
    this.rt = null;
    this.pw = 0;
    this.ph = 0;
    this.samples = -1;
    this.rendered = false;
  }

  ensure(pw: number, ph: number, antialias: boolean):""",
        ),
    ],
}


def read_text(rel: str) -> str:
    return (ROOT / rel).read_text()


def write_text(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text)


def apply_edits(edits: list[tuple[str, str, str]]) -> None:
    for rel, old, new in edits:
        text = read_text(rel)
        if old not in text:
            raise SystemExit(f"{rel}: missing anchor:\n{old[:120]!r}")
        write_text(rel, text.replace(old, new, 1))


def git_diff(paths: list[str]) -> str:
    r = subprocess.run(
        ["git", "diff", "--no-color", "--"] + paths,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    if not r.stdout.strip():
        raise SystemExit(f"empty diff for {paths}")
    return r.stdout


def restore(paths: list[str]) -> None:
    subprocess.run(["git", "checkout", "HEAD", "--"] + paths, cwd=ROOT, check=True)


def write_patch(proofs_dir: Path, name: str, edits: list[tuple[str, str, str]]) -> None:
    paths = sorted({rel for rel, _, _ in edits})
    apply_edits(edits)
    diff = git_diff(paths)
    (proofs_dir / f"{name}.patch").write_text(diff)
    restore(paths)


def main() -> None:
    subprocess.run(["git", "checkout", "HEAD", "--", "web"], cwd=ROOT, check=True)

    proofs42 = ROOT / "revert-proofs/42"
    for name, edits in PATCHES_42.items():
        write_patch(proofs42, name, edits)

    proofs86 = ROOT / "revert-proofs/86"
    for name, edits in PATCHES_86.items():
        write_patch(proofs86, name, edits)

    print(f"42: {len(PATCHES_42)} patches")
    print(f"86: {len(PATCHES_86)} patches")


if __name__ == "__main__":
    main()
