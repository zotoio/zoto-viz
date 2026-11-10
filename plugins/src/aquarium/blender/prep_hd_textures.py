"""Bake the aquarium HD scan-set textures from the CC0 photo sources (deterministic, PIL + numpy).

  python3 plugins/src/aquarium/blender/prep_hd_textures.py out/sources/03-aquarium-hd-scans

Reads the downloads from `fetch_hd_sources.py`, writes `<src>/baked/*.jpg|png` plus
`<src>/baked/plant_profiles.json` for `build_scape_hd.py`:

- sand_*       ambientCG "Ground 080" fine sand (fresh bed), its AO multiplied in
- reefsand_*   ambientCG "Ground 093 A" rippled sand, desaturated to pale aragonite (reef bed)
- stone_*      Poly Haven "Rock Moss Set 01" scan maps, cooled toward blue-grey seiryu stone
- wood_*       Poly Haven "Dry Branches Medium 01" scan maps, darkened and warmed (soaked driftwood)
- liverock_*   Poly Haven "Moon Rock 01" scan maps (pitted porous rock as reef live rock)
- coral_*      ambientCG "Sponge 002", luminance only (the vertex colour tints each coral)
- moss_*       ambientCG "Moss 002"
- plants_*     one atlas of photographed blades and leaves, each straightened into a strip:
               8 ambientCG "Foliage 001" grass blades (vallisneria), 2 "Leaf Set 013" leaves
               (java fern), 4 "Leaf Set 022" leaves (rotala). The build gives every plant card
               the measured outline of its photo (plant_profiles.json), so no alpha is needed.
- fan_lattice  ambientCG "Leather 008" cell seams as an alpha lattice (gorgonian sea fan)
- scale_*      ambientCG "Leather 008" cells as tileable fish-scale detail and normal
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/03-aquarium-hd-scans")
OUT = os.path.join(SRC, "baked")
os.makedirs(OUT, exist_ok=True)


def load(path: str, mode: str = "RGB") -> np.ndarray:
    return np.asarray(Image.open(path).convert(mode)).astype(np.float32) / 255.0


def acg(asset: str, kind: str, mode: str = "RGB") -> np.ndarray:
    return load(os.path.join(SRC, asset, f"{asset}_1K-JPG_{kind}.jpg"), mode)


def ph(asset: str, kind: str, mode: str = "RGB") -> np.ndarray:
    return load(os.path.join(SRC, asset, "textures", f"{asset}_{kind}_1k.jpg"), mode)


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))


def resized(a: np.ndarray, size: int | tuple[int, int]) -> np.ndarray:
    im = to_img(a)
    im = im.resize(size if isinstance(size, tuple) else (size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def save_jpg(a: np.ndarray, name: str, q: int, size: int | tuple[int, int] | None = None) -> None:
    im = to_img(a)
    if size is not None:
        im = im.resize(size if isinstance(size, tuple) else (size, size), Image.LANCZOS)
    p = os.path.join(OUT, name)
    im.save(p, quality=q, optimize=True)
    print(f"{name:26s} {im.size[0]}x{im.size[1]} {os.path.getsize(p):8d} B")


def blur(a: np.ndarray, r: float) -> np.ndarray:
    """Separable Gaussian (sigma = r px), wrapping at the edges."""
    if a.ndim == 3:
        return np.stack([blur(a[..., c], r) for c in range(a.shape[2])], -1)
    k = int(np.ceil(r * 3))
    w = np.exp(-0.5 * (np.arange(-k, k + 1) / max(r, 1e-3)) ** 2)
    w /= w.sum()
    out = a.astype(np.float32)
    for axis in (0, 1):
        out = sum(wi * np.roll(out, i - k, axis) for i, wi in enumerate(w))
    return out


def bilinear(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None] if img.ndim == 3 else x - x0
    fy = (y - y0)[..., None] if img.ndim == 3 else y - y0
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, d = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def normal_from_height(h: np.ndarray, strength: float) -> np.ndarray:
    """OpenGL (+Y up) tangent-space normal map from a height field (rows grow downward)."""
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    n = np.stack([-gx * strength, gy * strength, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def soften_normal(n: np.ndarray, k: float) -> np.ndarray:
    """Scale a tangent-space normal map's tilt by k (k < 1 flattens)."""
    v = n * 2 - 1
    v[..., :2] *= k
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return v * 0.5 + 0.5


def grade(c: np.ndarray, sat: float = 1.0, gain=(1.0, 1.0, 1.0), lift: float = 0.0) -> np.ndarray:
    lum = c.mean(-1, keepdims=True)
    return np.clip((lum + (c - lum) * sat) * np.array(gain, np.float32) + lift, 0, 1)


def tileable(a: np.ndarray, border: int = 64) -> np.ndarray:
    """Cross-fade the image with its half-offset copy near the edges so it repeats without seams."""
    h, w = a.shape[:2]
    sh = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    y = np.minimum(np.arange(h), h - 1 - np.arange(h))[:, None]
    x = np.minimum(np.arange(w), w - 1 - np.arange(w))[None, :]
    m = np.clip(np.minimum(x, y) / border, 0, 1)
    m = m * m * (3 - 2 * m)
    if a.ndim == 3:
        m = m[..., None]
    return a * m + sh * (1 - m)


# ------------------------------------------------------------------ beds
def beds() -> None:
    c = acg("Ground080", "Color") * acg("Ground080", "AmbientOcclusion") ** 0.7
    c = grade(c, 0.8, (1.12, 1.1, 1.06))
    save_jpg(tileable(c), "sand_albedo.jpg", 80, 512)
    save_jpg(tileable(soften_normal(acg("Ground080", "NormalGL"), 0.8)), "sand_normal.jpg", 78, 256)
    # reef: rippled sand, desaturated toward pale aragonite
    r = acg("Ground093A", "Color") * acg("Ground093A", "AmbientOcclusion") ** 0.6
    r = grade(r, 0.45, (0.96, 0.94, 0.89))
    save_jpg(tileable(r), "reefsand_albedo.jpg", 80, 512)
    save_jpg(tileable(acg("Ground093A", "NormalGL")), "reefsand_normal.jpg", 78, 256)


# ------------------------------------------------------------------ scanned stone, wood, live rock
def scans() -> None:
    st = ph("rock_moss_set_01", "diff")
    # seiryu: blue-grey with the scan's lichen kept faint
    st = grade(st, 0.3, (1.75, 1.85, 1.98))
    save_jpg(st, "stone_albedo.jpg", 76, 512)
    save_jpg(ph("rock_moss_set_01", "nor_gl"), "stone_normal.jpg", 78, 256)

    w = ph("dry_branches_medium_01", "diff")
    # sun-dried branches soaked in tank water: darker and warmer, like aged driftwood
    w = grade(w, 1.1, (0.8, 0.66, 0.5))
    save_jpg(w, "wood_albedo.jpg", 78, 512)
    save_jpg(ph("dry_branches_medium_01", "nor_gl"), "wood_normal.jpg", 80, 256)

    # the scan's colour is dusty and flat; its pitting lives in the AO channel of the ARM map
    lr = ph("moon_rock_01", "diff") * ph("moon_rock_01", "arm")[..., :1] ** 1.6
    # live rock: coralline algae (pink / violet) in blotches on the exposed faces, not in the pits
    lum = lr.mean(-1, keepdims=True)
    ao = ph("moon_rock_01", "arm")[..., 0]
    rng = np.random.default_rng(7)
    blot = blur(rng.random(ao.shape).astype(np.float32), 14.0)
    blot = (blot - blot.mean()) / max(1e-6, float(blot.std()))
    patch = (np.clip(blot * 0.9 - 0.1, 0, 1) * np.clip((ao - 0.55) / 0.3, 0, 1))[..., None]
    coralline = np.array([0.72, 0.46, 0.62], np.float32) * (0.6 + 0.5 * lum)
    # grey regolith warmed to reef limestone first
    lr = grade(lr, 1.0, (1.1, 0.99, 0.84), 0.03)
    lr = lr * (1 - 0.4 * patch) + coralline * 0.4 * patch
    save_jpg(lr, "liverock_albedo.jpg", 70, 512)
    save_jpg(ph("moon_rock_01", "nor_gl"), "liverock_normal.jpg", 72, 256)


# ------------------------------------------------------------------ coral + moss
def coral_moss() -> None:
    sp = acg("Sponge002", "Color") * acg("Sponge002", "AmbientOcclusion") ** 0.8
    lum = sp.mean(-1, keepdims=True)
    detail = np.clip(lum / max(1e-3, float(lum.mean())) * 0.82, 0, 1)
    save_jpg(tileable(np.repeat(detail, 3, -1)), "coral_albedo.jpg", 80, 256)
    save_jpg(tileable(acg("Sponge002", "NormalGL")), "coral_normal.jpg", 80, 256)
    m = acg("Moss002", "Color") * acg("Moss002", "AmbientOcclusion") ** 0.6
    save_jpg(tileable(grade(m, 1.05, (0.9, 1.0, 0.85))), "moss_albedo.jpg", 80, 256)
    save_jpg(tileable(acg("Moss002", "NormalGL")), "moss_normal.jpg", 80, 256)


# ------------------------------------------------------------------ plant atlas (straightened photos)
def components(mask: np.ndarray, min_px: int) -> list[tuple[int, int, int, int]]:
    """Bounding boxes (x0, y0, x1, y1) of the connected opaque regions, largest first."""
    h, w = mask.shape
    lab = np.zeros(mask.shape, np.int32)
    boxes = []
    n = 0
    for sy in range(0, h, 4):
        for sx in range(0, w, 4):
            if not mask[sy, sx] or lab[sy, sx]:
                continue
            n += 1
            stack = [(sy, sx)]
            xs, ys = [], []
            while stack:
                y, x = stack.pop()
                if y < 0 or x < 0 or y >= h or x >= w or lab[y, x] or not mask[y, x]:
                    continue
                lab[y, x] = n
                xs.append(x)
                ys.append(y)
                stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
            if len(xs) >= min_px:
                boxes.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1, len(xs)))
    boxes.sort(key=lambda b: -b[4])
    return [b[:4] for b in boxes]


def straighten(col: np.ndarray, disp: np.ndarray, opa: np.ndarray, box, W: int, H: int, inset: float = 0.9):
    """Unwarp one photographed blade/leaf (long axis vertical) into a W x H strip.

    Row by row the opaque span's centre and half width are measured; the strip samples that span
    (inset toward the midrib, so the serrated margin never shows). Returns the strip, its height
    field and the normalised half-width profile (base -> tip, 24 samples) for the card outline.
    """
    x0, y0, x1, y1 = box
    m = opa[y0:y1, x0:x1] > 0.5
    rows = np.where(m.sum(1) > 1)[0]
    top, bot = int(rows.min()), int(rows.max())
    cx = np.zeros(m.shape[0], np.float32)
    hw = np.zeros(m.shape[0], np.float32)
    for y in range(top, bot + 1):
        xs = np.where(m[y])[0]
        if xs.size:
            cx[y] = (xs.min() + xs.max()) * 0.5
            hw[y] = (xs.max() - xs.min()) * 0.5
    k = 9
    ker = np.ones(k, np.float32) / k
    cx[top:bot + 1] = np.convolve(np.pad(cx[top:bot + 1], k // 2, mode="edge"), ker, "valid")
    hw[top:bot + 1] = np.convolve(np.pad(hw[top:bot + 1], k // 2, mode="edge"), ker, "valid")
    # drop the petiole and the last sliver of tip: too narrow to sample without the background
    wide = np.where(hw > 0.12 * float(hw.max()))[0]
    top, bot = int(wide.min()), int(wide.max())
    # base at the bottom of the photo (stalk end): strip v = 0 at the base, 1 at the tip
    ys = np.linspace(bot, top, H).astype(np.float32)
    yi = np.clip(np.round(ys).astype(int), top, bot)
    u = (np.arange(W, dtype=np.float32) + 0.5) / W * 2 - 1
    sx = x0 + cx[yi][:, None] + u[None, :] * np.maximum(hw[yi][:, None] * inset, 0.5)
    sy = np.broadcast_to((y0 + ys)[:, None], sx.shape)
    strip = bilinear(col, sx, sy)
    height = bilinear(disp, sx, sy)
    prof_y = np.linspace(bot, top, 24).astype(int)
    prof = hw[prof_y] / max(1e-3, float(hw[top:bot + 1].max()))
    # glTF/PIL rows grow downward; put the tip at the top row of the strip region
    return strip[::-1], height[::-1], [round(float(p), 4) for p in prof], (bot - top) / max(1.0, 2 * float(hw.max()))


def plants() -> None:
    W, H = 1024, 512
    atlas = np.zeros((H, W, 3), np.float32)
    hgt = np.zeros((H, W), np.float32)
    profiles: dict = {"atlas": [W, H], "vallisneria": [], "fern": [], "rotala": []}

    def put(strip, height, x, y):
        h, w = height.shape
        atlas[y:y + h, x:x + w] = strip
        hgt[y:y + h, x:x + w] = height

    # vallisneria: the eight greenest of the long grass blades (no dry tips), 64 x 512 each
    col, disp, opa = acg("Foliage001", "Color"), acg("Foliage001", "Displacement", "L"), acg("Foliage001", "Opacity", "L")
    blades = components(opa > 0.5, 3000)
    longest = max(b[3] - b[1] for b in blades)

    def brown(b) -> float:
        x0, y0, x1, y1 = b
        c = col[y0:y1, x0:x1][opa[y0:y1, x0:x1] > 0.5]
        return float(np.mean(c[:, 0] > c[:, 1] * 0.85))

    blades = sorted([b for b in blades if b[3] - b[1] > 0.55 * longest], key=brown)[:8]
    blades.sort(key=lambda b: b[0])
    for i, box in enumerate(blades):
        s, h, prof, aspect = straighten(col, disp, opa, box, 64, 512, 0.85)
        s = grade(s, 1.1, (0.85, 1.0, 0.8))
        put(s, h, i * 64, 0)
        profiles["vallisneria"].append({"rect": [i * 64 / W, 0.0, (i + 1) * 64 / W, 1.0], "profile": prof, "aspect": round(aspect, 2)})
    # java fern: two narrow leaves of Leaf Set 013, 128 x 512, darkened to the deep fern green
    col, disp, opa = acg("LeafSet013", "Color"), acg("LeafSet013", "Displacement", "L"), acg("LeafSet013", "Opacity", "L")
    leaves = components(opa > 0.5, 2000)
    leaves = sorted(sorted(leaves, key=lambda b: -(b[3] - b[1]))[:2], key=lambda b: b[0])
    for i, box in enumerate(leaves):
        s, h, prof, aspect = straighten(col, disp, opa, box, 128, 512, 0.9)
        lum = s.mean(-1, keepdims=True)
        s = np.clip(np.array([0.11, 0.30, 0.09], np.float32) * (lum / max(1e-3, float(lum.mean()))) ** 1.1 + (s - lum) * 0.35, 0, 1)
        put(s, h, 512 + i * 128, 0)
        profiles["fern"].append({"rect": [(512 + i * 128) / W, 0.0, (512 + (i + 1) * 128) / W, 1.0], "profile": prof, "aspect": round(aspect, 2)})
    # rotala: four oval leaves of Leaf Set 022, 128 x 256
    col, disp, opa = acg("LeafSet022", "Color"), acg("LeafSet022", "Displacement", "L"), acg("LeafSet022", "Opacity", "L")
    leaves = sorted(components(opa > 0.5, 5000)[:4], key=lambda b: (b[1] // 200, b[0]))
    for i, box in enumerate(leaves):
        s, h, prof, aspect = straighten(col, disp, opa, box, 128, 256, 0.88)
        s = grade(s, 1.05, (0.95, 1.0, 0.85))
        x, y = 768 + (i % 2) * 128, (i // 2) * 256
        put(s, h, x, y)
        profiles["rotala"].append({"rect": [x / W, y / H, (x + 128) / W, (y + 256) / H], "profile": prof, "aspect": round(aspect, 2)})
    save_jpg(atlas, "plants_albedo.jpg", 78)
    save_jpg(normal_from_height(blur(hgt, 0.8), 5.0), "plants_normal.jpg", 80, (512, 256))
    with open(os.path.join(OUT, "plant_profiles.json"), "w") as f:
        json.dump(profiles, f, indent=1)
    print("plant_profiles.json", {k: len(v) for k, v in profiles.items() if isinstance(v, list) and k != "atlas"})


# ------------------------------------------------------------------ sea fan lattice + fish scales
def leather() -> None:
    disp = acg("Leather008", "Displacement", "L")
    col = acg("Leather008", "Color", "L")
    # the sunken seams between the leather's cells form a branching lattice like a gorgonian's
    c = blur(disp, 1.0)
    lo, hi = float(np.percentile(c, 4)), float(np.percentile(c, 16))
    seam = 1.0 - np.clip((c - lo) / max(1e-3, hi - lo), 0, 1)
    crop = seam[256:768, 256:768]
    grey = 0.75 + 0.25 * col[256:768, 256:768]
    rgba = np.stack([grey, grey, grey, crop], -1)
    im = to_img(rgba).resize((256, 256), Image.LANCZOS)
    a = Image.fromarray(np.where(np.asarray(im)[..., 3] > 90, 255, 0).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    im = Image.fromarray(np.dstack([np.asarray(im)[..., :3], np.asarray(a)]), "RGBA")
    q = im.quantize(colors=32, method=Image.Quantize.FASTOCTREE)
    p = os.path.join(OUT, "fan_lattice.png")
    q.save(p, optimize=True)
    print(f"{'fan_lattice.png':26s} 256x256 {os.path.getsize(p):8d} B")
    # fish scales: cell relief as a tileable height -> normal, and a soft light/dark detail
    h = tileable(blur(disp, 0.8), 96)
    save_jpg(normal_from_height(h, 7.0), "scale_normal.jpg", 88, 512)
    d = tileable(col, 96)
    d = 0.86 + 0.28 * (d - d.min()) / max(1e-3, float(np.ptp(d)))
    save_jpg(np.repeat(d[..., None], 3, -1), "scale_detail.jpg", 88, 512)


if __name__ == "__main__":
    beds()
    scans()
    coral_moss()
    plants()
    leather()
