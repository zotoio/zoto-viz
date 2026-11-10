#!/usr/bin/env python3
"""Bake the Marble Run HD tiling maps from the CC0 sources (numpy + Pillow, deterministic).

  python3 plugins/src/marble-run/blender/prep_hd_textures.py out/sources/04-marble

Reads `fetch_hd_sources.py` downloads and writes `<sources>/baked/`:

  walnut_albedo.jpg  512  Poly Haven "Wood Table 001" cut into staggered 9 cm planks (grain along v):
                          each plank is its own window of the 1k photo at native texel density
                          (1.46 mm/texel), with a small tone shift, and a dark seam at every edge
                          and butt joint. Tiles every 0.75 m.
  walnut_normal.jpg  512  the scan's GL normal plus rounded plank edges and joints.
  walnut_mr.jpg      256  glTF metallic-roughness (G = roughness, B = 0): oiled, seams duller.
  oak_albedo.jpg     512  Poly Haven "Oak Veneer 01", whole tile resized (stays seamless).
  metal_albedo.jpg   256  ambientCG "Metal009" brushed steel colour, grey, mean 0.93 (the glTF
                          baseColorFactor makes it steel or brass).
  metal_mr.jpg       512  Metal009 roughness rescaled to 0.16..0.42 (G), metallic 1 (B).
                          Brush streaks run along u.

Texture budget (marble-run visualisation.yml workBudget.maxGpuBytes = 8 MiB): three.js decodes
every image to RGBA8 with mipmaps (x4/3), so 512^2 costs 1.40 MB and 256^2 0.35 MB; the 512x256
environment image becomes a 384x512 RGBA16F PMREM (1.57 MB). The build script checks the total.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image

T = 512  # walnut tile, texels
PLANKS = 8  # plank columns per walnut tile (0.75 m / 8 = 9.4 cm)


def load(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


def save(arr: np.ndarray, path: str, size: int | None = None, quality: int = 90) -> None:
    img = Image.fromarray((np.clip(arr, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8), "RGB")
    if size and img.width != size:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
    img.save(path, "JPEG", quality=quality, optimize=True, progressive=False, subsampling=0)
    print("baked", os.path.basename(path), img.size, os.path.getsize(path), "bytes")


def srgb_to_lin(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def rand(i: int, k: int) -> float:
    """Stable per-plank random in [0, 1)."""
    return ((np.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1.0 + 1.0) % 1.0


def edge_profile(d: np.ndarray, width: float) -> np.ndarray:
    """0 at a seam, rising smoothly to 1 at `width` texels away."""
    t = np.clip(d / width, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def walnut(src: str, out: str) -> None:
    base = os.path.join(src, "wood_table_001")
    alb = load(os.path.join(base, "wood_table_001_diff_1k.jpg"))
    nor = load(os.path.join(base, "wood_table_001_nor_gl_1k.jpg"))
    rough = load(os.path.join(base, "wood_table_001_rough_1k.jpg"))[..., 0]
    n = alb.shape[0]
    pw = T // PLANKS
    a_out = np.zeros((T, T, 3), np.float32)
    n_out = np.zeros((T, T, 3), np.float32)
    r_out = np.zeros((T, T), np.float32)
    # seam distance fields (texels) for the rounded edges
    d_edge = np.full((T, T), 1e9, np.float32)
    for p in range(PLANKS):
        x0 = p * pw
        # a window of the 1k photo for this plank (the photo tiles, so wrap with np.roll)
        sx = int(rand(p, 1) * n)
        sy = int(rand(p, 2) * n)
        win = lambda img: np.roll(np.roll(img, -sy, axis=0), -sx, axis=1)[:T, :pw]
        # butt joint somewhere along the plank; the window seam (non-tiling) is hidden under it
        joint = int(rand(p, 3) * T)
        tone = 1.0 + 0.3 * rand(p, 4)
        warm = 1.0 + 0.06 * (rand(p, 5) - 0.5)
        a = np.roll(win(alb), joint, axis=0)
        lin = srgb_to_lin(a) * tone
        lin[..., 0] *= warm
        lin[..., 2] /= warm
        a_out[:, x0:x0 + pw] = lin_to_srgb(lin)
        n_out[:, x0:x0 + pw] = np.roll(win(nor), joint, axis=0)
        r_out[:, x0:x0 + pw] = np.roll(win(rough), joint, axis=0)
        xs = np.arange(pw, dtype=np.float32)
        ys = np.arange(T, dtype=np.float32)
        dx = np.minimum(xs + 0.5, pw - xs - 0.5)[None, :]
        dj = np.abs(((ys - joint + T / 2) % T) - T / 2)[:, None]
        d_edge[:, x0:x0 + pw] = np.minimum(np.broadcast_to(dx, (T, pw)), np.broadcast_to(dj, (T, pw)))
    # which way each texel's nearest seam lies, for the rounded-edge normal
    edge = edge_profile(d_edge, 3.5)
    groove = 1.0 - edge
    lin = srgb_to_lin(a_out) * (1.0 - 0.7 * groove[..., None])
    save(lin_to_srgb(lin), os.path.join(out, "walnut_albedo.jpg"))

    # normal: decode the scan (GL, +y up), tilt toward each seam over the edge profile
    nv = n_out * 2.0 - 1.0
    gy, gx = np.gradient(edge)
    tilt = 1.1
    nv[..., 0] -= gx * tilt
    nv[..., 1] += gy * tilt  # image rows run down; GL normal +y is up
    nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
    save(nv * 0.5 + 0.5, os.path.join(out, "walnut_normal.jpg"), quality=92)

    # oiled, not lacquered: the stage's key light would turn a glossy dark board into a mirror
    r = 0.55 + 0.17 * (r_out - r_out.min()) / max(1e-6, float(r_out.max() - r_out.min()))
    r = r + 0.25 * groove
    mr = np.stack([np.ones_like(r), r, np.zeros_like(r)], axis=-1)
    save(mr, os.path.join(out, "walnut_mr.jpg"), size=256)


def oak(src: str, out: str) -> None:
    alb = load(os.path.join(src, "oak_veneer_01", "oak_veneer_01_diff_1k.jpg"))
    save(alb, os.path.join(out, "oak_albedo.jpg"), size=512)


def metal(src: str, out: str) -> None:
    base = os.path.join(src, "Metal009")
    col = load(os.path.join(base, "Metal009_1K-JPG_Color.jpg"))
    grey = srgb_to_lin(col).mean(axis=-1)
    grey = grey * (srgb_to_lin(np.float32(0.93)) / max(1e-6, float(grey.mean())))
    g = lin_to_srgb(grey)
    save(np.stack([g, g, g], axis=-1), os.path.join(out, "metal_albedo.jpg"), size=256)
    rough = load(os.path.join(base, "Metal009_1K-JPG_Roughness.jpg"))[..., 0]
    lo, hi = np.percentile(rough, 2), np.percentile(rough, 98)
    r = 0.16 + 0.26 * np.clip((rough - lo) / max(1e-6, hi - lo), 0.0, 1.0)
    mr = np.stack([np.ones_like(r), r, np.ones_like(r)], axis=-1)
    save(mr, os.path.join(out, "metal_mr.jpg"), size=512)


def main() -> int:
    src = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/04-marble")
    out = os.path.join(src, "baked")
    os.makedirs(out, exist_ok=True)
    walnut(src, out)
    oak(src, out)
    metal(src, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
