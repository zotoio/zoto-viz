"""Bake the koi-pond HD scan-set textures from the CC0 photo sources (deterministic, PIL + numpy).

  python3 plugins/src/koi-pond/blender/prep_hd_textures.py out/sources/02-koi-hd-scans

Reads the downloads from `fetch_hd_sources.py` plus the shipped Standard koi GLBs, writes
`<src>/baked/*.jpg|png` for `build_koi_hd_scans.py`:

- rock_*      Poly Haven "Rock Moss Set 02" albedo / normal (1k) and roughness (512, glTF G channel)
- pebble_*    Poly Haven "Ganges River Pebbles" albedo (1k) / normal / roughness (512), darkened wet
- pad_*       ambientCG "Leaf 001" warped into polar sectors, so its midrib and side veins run out
              from the pad centre like a lily pad's radial veins; normal from its displacement
- petal_*     ambientCG "Flower Set 001": daisy petal grain (longitudinal grooves) under a pink /
              white lotus gradient, plus the photographed disc florets for the stamen crown
- koi_*       the Standard koi maps with crisper scales (normal), scale-edge shading (fukurin),
              wet gloss and fin membranes thinner between the rays
"""
from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np
from PIL import Image

SRC = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/02-koi-hd-scans")
OUT = os.path.join(SRC, "baked")
PACK = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.makedirs(OUT, exist_ok=True)


def load(path: str, mode: str = "RGB") -> np.ndarray:
    return np.asarray(Image.open(path).convert(mode)).astype(np.float32) / 255.0


def to_img(a: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(a, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8))


def save_jpg(a: np.ndarray, name: str, q: int, size: int | tuple[int, int] | None = None) -> None:
    im = to_img(a)
    if size is not None:
        im = im.resize(size if isinstance(size, tuple) else (size, size), Image.LANCZOS)
    p = os.path.join(OUT, name)
    im.save(p, quality=q, optimize=True)
    print(f"{name:28s} {im.size[0]}x{im.size[1]} {os.path.getsize(p):8d} B")


def save_png(a: np.ndarray, name: str) -> None:
    p = os.path.join(OUT, name)
    to_img(a).save(p, optimize=True)
    print(f"{name:28s} {a.shape[1]}x{a.shape[0]} {os.path.getsize(p):8d} B")


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


def mr_map(rough: np.ndarray, metal: float | np.ndarray = 0.0) -> np.ndarray:
    """glTF metallicRoughness: G = roughness, B = metalness (R unused, left white)."""
    return np.stack([np.ones_like(rough), rough, np.broadcast_to(metal, rough.shape)], -1)


def grid(n: int, m: int | None = None) -> tuple[np.ndarray, np.ndarray]:
    m = m or n
    ys, xs = np.mgrid[0:m, 0:n].astype(np.float32)
    return (xs + 0.5) / n, (ys + 0.5) / m


# ------------------------------------------------------------------ rocks + pebbles
def rocks() -> None:
    d = os.path.join(SRC, "rock_moss_set_02", "textures")
    alb = load(os.path.join(d, "rock_moss_set_02_diff_1k.jpg"))
    save_jpg(alb, "rock_albedo.jpg", 84)
    save_jpg(load(os.path.join(d, "rock_moss_set_02_nor_gl_1k.jpg")), "rock_normal.jpg", 86)
    r = load(os.path.join(d, "rock_moss_set_02_rough_1k.jpg"), "L")
    save_jpg(mr_map(np.clip(r * 0.95, 0.3, 1.0)), "rock_mr.jpg", 88, 512)


def pebbles() -> None:
    d = os.path.join(SRC, "ganges_river_pebbles")
    alb = load(os.path.join(d, "ganges_river_pebbles_diff_1k.jpg"))
    # wet stone: deeper, a little more saturated
    lum = alb.mean(-1, keepdims=True)
    wet = np.clip((lum + (alb - lum) * 1.25) * 0.72, 0, 1)
    save_jpg(wet, "pebble_albedo.jpg", 80)
    save_jpg(load(os.path.join(d, "ganges_river_pebbles_nor_gl_1k.jpg")), "pebble_normal.jpg", 84, 512)
    r = load(os.path.join(d, "ganges_river_pebbles_rough_1k.jpg"), "L")
    save_jpg(mr_map(np.clip(r * 0.55, 0.18, 0.8)), "pebble_mr.jpg", 88, 256)


# ------------------------------------------------------------------ lily pad (polar-warped leaf)
def leaf_frame(opacity: np.ndarray) -> tuple[np.ndarray, np.ndarray, int, int]:
    """Midrib x and half-width per row for the front-facing leaf (left half of Leaf001)."""
    m = opacity[:, : opacity.shape[1] // 2] > 0.5
    rows = np.where(m.sum(1) > 6)[0]
    top, bot = int(rows.min()), int(rows.max())
    cx = np.zeros(m.shape[0], np.float32)
    hw = np.zeros(m.shape[0], np.float32)
    for y in range(top, bot + 1):
        xs = np.where(m[y])[0]
        if xs.size:
            cx[y] = (xs.min() + xs.max()) * 0.5
            hw[y] = (xs.max() - xs.min()) * 0.5
    # smooth over the serrated margin
    k = np.ones(25, np.float32) / 25
    cx[top:bot] = np.convolve(np.pad(cx[top:bot], 12, mode="edge"), k, "valid")[: bot - top]
    hw[top:bot] = np.convolve(np.pad(hw[top:bot], 12, mode="edge"), k, "valid")[: bot - top]
    return cx, hw, top, bot


def pad() -> None:
    d = os.path.join(SRC, "Leaf001")
    col = load(os.path.join(d, "Leaf001_1K-JPG_Color.jpg"))
    opa = load(os.path.join(d, "Leaf001_1K-JPG_Opacity.jpg"), "L")
    disp = load(os.path.join(d, "Leaf001_1K-JPG_Displacement.jpg"), "L")
    rough = load(os.path.join(d, "Leaf001_1K-JPG_Roughness.jpg"), "L")
    cx, hw, top, bot = leaf_frame(opa)
    length = bot - top
    N = 1024
    u, v = grid(N)
    dx, dy = u * 2 - 1, v * 2 - 1
    rho = np.clip(np.hypot(dx, dy), 0, 1)
    theta = np.arctan2(dy, dx)
    # uneven sector widths so the radial veins do not read as a kaleidoscope
    warp = theta + 0.10 * np.sin(3 * theta + 0.4) + 0.05 * np.sin(7 * theta + 1.3)
    SECTORS = 13
    sec = warp / (2 * np.pi) * SECTORS
    k = np.floor(sec)
    phi = sec - k
    side = np.abs(phi - 0.5) * 2  # 0 at a sector edge (mirror seam), 1 on the sector's midrib
    across = 1.0 - side  # 0 on the midrib -> 1 at the seam
    jitter = (np.sin(k * 12.9898) * 43758.5453) % 1.0  # each sector reads its own stretch of leaf
    s = 0.08 + 0.10 * jitter + 0.60 * rho
    ly = bot - s * length
    lyi = np.clip(ly.astype(int), top, bot)
    lx = cx[lyi] + across * hw[lyi] * (0.62 + 0.16 * jitter)
    c = bilinear(col, lx, ly)
    h = bilinear(disp, lx, ly)
    r = bilinear(rough, lx, ly)
    # softer veins than the backlit source leaf
    soft = blur(c, 3.0)
    c = soft + (c - soft) * 0.5
    # lily-pad palette: deeper, cooler green; lighter toward the centre; bronze rim
    lum = c.mean(-1, keepdims=True)
    deep = np.array([0.15, 0.33, 0.12], np.float32)
    c = np.clip(deep * (lum / max(1e-3, float(lum.mean()))) ** 0.9 + (c - lum) * 0.4, 0, 1)
    blotch = blur(bilinear(col.mean(-1), 90 + u * 320, 260 + v * 380), 20)
    c *= (0.86 + 0.28 * (blotch - blotch.min()) / max(1e-3, float(np.ptp(blotch))))[..., None]
    c *= (1.12 - 0.22 * rho)[..., None]
    rim = np.clip((rho - 0.86) / 0.14, 0, 1)[..., None] ** 1.5
    c = c * (1 - 0.55 * rim) + np.array([0.42, 0.20, 0.10], np.float32) * 0.55 * rim
    save_jpg(c, "pad_albedo.jpg", 82)
    hh = blur(h, 0.6)
    save_jpg(normal_from_height(hh, 9.0), "pad_normal.jpg", 84)
    save_jpg(mr_map(np.clip(0.26 + r * 0.3, 0.2, 0.6)), "pad_mr.jpg", 88, 256)


# ------------------------------------------------------------------ lotus petal atlas
def daisy_centres(col: np.ndarray) -> list[tuple[float, float, float]]:
    """(x, y, disc radius) of each photographed daisy, from the yellow disc florets."""
    y = (col[..., 0] > 0.7) & (col[..., 1] > 0.5) & (col[..., 2] < 0.4)
    out = []
    lab = np.zeros(y.shape, np.int32)
    seen = 0
    for sy in range(0, y.shape[0], 8):
        for sx in range(0, y.shape[1], 8):
            if not y[sy, sx] or lab[sy, sx]:
                continue
            seen += 1
            stack = [(sy, sx)]
            pts = []
            while stack:
                py, px = stack.pop()
                if py < 0 or px < 0 or py >= y.shape[0] or px >= y.shape[1] or lab[py, px] or not y[py, px]:
                    continue
                lab[py, px] = seen
                pts.append((py, px))
                stack += [(py + 1, px), (py - 1, px), (py, px + 1), (py, px - 1)]
            if len(pts) > 2000:
                a = np.array(pts, np.float32)
                out.append((float(a[:, 1].mean()), float(a[:, 0].mean()), float(np.sqrt(len(pts) / np.pi))))
    return sorted(out, key=lambda t: -t[2])


def petal_atlas() -> None:
    d = os.path.join(SRC, "FlowerSet001")
    col = load(os.path.join(d, "FlowerSet001_1K-JPG_Color.jpg"))
    opa = load(os.path.join(d, "FlowerSet001_1K-JPG_Opacity.jpg"), "L")
    lumi = col.mean(-1)
    big = daisy_centres(col)[0]
    cxx, cyy, rd = big
    T = 512
    u, v = grid(T)  # u across the petal, v along it (v = 0 at the base)
    # petal grain: one clean petal of the biggest daisy, unrolled (base -> tip), keeping only its
    # high-pass luminance (the longitudinal grooves); pollen specks are filled from the blur first
    ang = (u - 0.5) * 0.26 + 2.6
    rad = rd * (1.15 + 0.95 * v)
    gx, gy = cxx + np.cos(ang) * rad, cyy + np.sin(ang) * rad
    pc = bilinear(col, gx, gy)
    m = bilinear(opa, gx, gy)
    g = pc.mean(-1)
    speck = (pc.max(-1) - pc.min(-1)) > 0.12
    g = np.where(speck, blur(g, 6), g)
    base = blur(g, 14) + 1e-3
    grain = np.where(m > 0.5, g / base, 1.0)
    grain = 1.0 + np.clip(grain - 1.0, -0.1, 0.1) * 2.6
    grain = blur(grain, 0.8)
    along = v
    edge = np.abs(u - 0.5) * 2
    pink_base, pink_mid, pink_tip = (np.array(c, np.float32) for c in
                                     ((0.98, 0.92, 0.84), (0.96, 0.66, 0.76), (0.86, 0.30, 0.52)))
    t1 = np.clip(along / 0.55, 0, 1)[..., None]
    t2 = np.clip((along - 0.55) / 0.45, 0, 1)[..., None]
    pink = pink_base * (1 - t1) + pink_mid * t1
    pink = pink * (1 - t2) + pink_tip * t2
    pink = pink * (1 - 0.12 * edge[..., None]) + np.array([0.9, 0.4, 0.58], np.float32) * 0.12 * edge[..., None]
    pink *= grain[..., None]
    white = np.array([0.98, 0.97, 0.92], np.float32) * (1 - t2 * 0.35) + np.array([0.97, 0.80, 0.86], np.float32) * t2 * 0.35
    white *= (0.94 + 0.06 * grain)[..., None] * grain[..., None] ** 0.6
    # stamen crown: the photographed disc florets, warmed
    su, sv = grid(T)
    disc = bilinear(col, cxx + (su - 0.5) * rd * 1.9, cyy + (sv - 0.5) * rd * 1.9)
    disc = np.clip(disc * np.array([1.02, 0.95, 0.75], np.float32), 0, 1)
    # filaments: golden, lighter at the anther tips
    fil = np.array([0.93, 0.74, 0.22], np.float32) * (0.8 + 0.25 * sv)[..., None]
    fil *= (0.9 + 0.1 * np.cos(su * np.pi * 24))[..., None]
    atlas = np.zeros((T * 2, T * 2, 3), np.float32)
    atlas[:T, :T], atlas[:T, T:], atlas[T:, :T], atlas[T:, T:] = pink, white, disc, fil
    save_jpg(atlas, "petal_albedo.jpg", 84)
    hgt = np.ones((T * 2, T * 2), np.float32)
    hgt[:T, :T] = grain
    hgt[:T, T:] = grain
    hgt[T:, :T] = bilinear(lumi, cxx + (su - 0.5) * rd * 1.9, cyy + (sv - 0.5) * rd * 1.9)
    save_jpg(normal_from_height(blur(hgt, 0.8), 6.0), "petal_normal.jpg", 84, 512)


# ------------------------------------------------------------------ koi (from the Standard GLBs)
def glb_images(path: str) -> dict[str, bytes]:
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + n])
    off = 20 + n
    bl = struct.unpack_from("<I", b, off)[0]
    bin_ = b[off + 8:off + 8 + bl]
    out = {}
    for im in j["images"]:
        bv = j["bufferViews"][im["bufferView"]]
        o = bv.get("byteOffset", 0)
        out[im["name"]] = bin_[o:o + bv["byteLength"]]
    return out


def koi() -> None:
    import io
    for v in ("kohaku", "showa", "ogon"):
        imgs = glb_images(os.path.join(PACK, "assets", f"koi-{v}.glb"))
        rd = lambda k, mode="RGB": np.asarray(Image.open(io.BytesIO(imgs[k])).convert(mode)).astype(np.float32) / 255.0
        alb = rd(f"koi_{v}_body_basecolor")
        nrm = rd(f"koi_{v}_body_normal") * 2 - 1
        mr = rd(f"koi_{v}_body_mr")
        fin = rd(f"koi_{v}_fin_basecolor", "RGBA")
        xy = nrm[..., :2]
        dev = np.hypot(xy[..., 0], xy[..., 1])
        edge = np.clip((dev - 0.06) / 0.22, 0, 1)  # scale borders tilt the most
        crisp = np.concatenate([xy * 2.1, nrm[..., 2:3]], -1)
        crisp /= np.linalg.norm(crisp, axis=-1, keepdims=True)
        save_jpg(crisp * 0.5 + 0.5, f"koi_{v}_normal.jpg", 88)
        # fukurin: a thin darker rim on each scale, a pearly lift in its centre
        lift = (1.04 - 0.16 * edge)[..., None]
        save_jpg(np.clip(alb * lift + 0.025 * (1 - edge)[..., None], 0, 1), f"koi_{v}_albedo.jpg", 88)
        rough = np.clip(mr[..., 1] * 0.7 + 0.08 * edge, 0.12, 0.6)
        metal = mr[..., 2]
        save_jpg(mr_map(rough, metal), f"koi_{v}_mr.jpg", 90)
        # fins: rays stay, membrane between them thins out toward the edge
        h, w = fin.shape[:2]
        fu, fv = grid(w, h)
        ray = 0.5 + 0.5 * np.cos(fu * np.pi * 2 * 14)
        a = fin[..., 3] * (0.62 + 0.38 * ray ** 2) * (1.0 - 0.35 * fv)
        rgb = fin[..., :3] * (0.92 + 0.12 * ray)[..., None]
        save_png(np.concatenate([np.clip(rgb, 0, 1), np.clip(a, 0.18, 0.95)[..., None]], -1), f"koi_{v}_fin.png")


if __name__ == "__main__":
    rocks()
    pebbles()
    pad()
    petal_atlas()
    koi()
