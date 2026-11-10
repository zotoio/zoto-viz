"""Download and prepare the Bonsai's CC0 source maps (run before build_bonsai.py).

  .venv/bin/python plugins/src/bonsai/blender/fetch_sources.py [--root out/sources/bonsai]

Downloads Poly Haven and ambientCG originals into <root>/raw/ (gitignored) and writes the maps the
Blender build packs into the GLBs:

  <root>/prep/standard/*   128-512 px colour maps (Standard model set)
  <root>/prep/hd/*         256-1024 px colour + glTF normal maps and env-hd.jpg (HD lighting)
  <root>/prep/boulder/     the scanned boulder glTF (decimated into the slab by the build)

The leaf atlas is cut from Poly Haven's scanned periwinkle sheet (real leaf and petal alpha):
four columns by two rows, and every autumn tile sits exactly half the atlas to the right of its
green tile, so the host turns a leaf by offsetting u by 0.5. Red and orange autumn tiles keep the
scanned leaves' luminance and veins, re-centred on an autumn hue. Deterministic.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import zipfile
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

UA = {"User-Agent": "zoto-viz-bonsai-build/1.0 (+https://github.com/zotoio/zoto-viz)"}

# Poly Haven texture ids -> maps to fetch (2k jpg). nor_gl = OpenGL (+Y) normal, the glTF convention.
POLYHAVEN_TEXTURES = {
    "japanese_zelkova_bark": ("Diffuse", "nor_gl"),
    "dark_wood": ("Diffuse",),
    "japanese_cedar_planks": ("Diffuse",),
}
POLYHAVEN_ATLAS = "periwinkle_plant"
POLYHAVEN_BOULDER = "namaqualand_boulder_05"
POLYHAVEN_HDRI = "chinese_garden"
AMBIENTCG = ("Moss002",)

# HD only: deep-furrowed bark (colour, normal, height for the swept relief), a mossy rock scan
# blended onto the slab, and Poly Haven plant scans with real leaf / petal / frond alpha
HD_TEXTURES = {
    "bark_willow_02": ("Diffuse", "nor_gl", "Displacement"),
    "mossy_rock": ("Diffuse",),
}
HD_CUTOUTS = {  # id -> (colour map, alpha map)
    "island_tree_02": ("leaves_diff", "leaves_alpha"),
    "shrub_04": ("Diffuse", "Alpha"),
    "searsia_lucida": ("Diffuse", "Alpha"),
    "shrub_sorrel_01": ("Diffuse", "Alpha"),
    "moss_01": ("Diffuse", "Alpha"),
}

# leaf atlas: 4 x 2 tiles; autumn tile = green tile + (2 columns, 0 rows)
ATLAS_COLS, ATLAS_ROWS = 4, 2


def fetch(url: str, dest: Path) -> Path:
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    dest.write_bytes(data)
    print(f"fetched {url} -> {dest} ({len(data)} B)")
    return dest


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def credit(pid: str) -> dict:
    info = fetch_json(f"https://api.polyhaven.com/info/{pid}")
    return {"name": info.get("name", pid), "authors": sorted((info.get("authors") or {}).keys()),
            "url": f"https://polyhaven.com/a/{pid}", "licence": "CC0 1.0"}


def fetch_polyhaven(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for pid, maps in POLYHAVEN_TEXTURES.items():
        files = fetch_json(f"https://api.polyhaven.com/files/{pid}")
        for m in maps:
            url = files[m]["2k"]["jpg"]["url"]
            fetch(url, raw / "polyhaven" / pid / Path(url).name)
        credits[pid] = credit(pid)
    files = fetch_json(f"https://api.polyhaven.com/files/{POLYHAVEN_ATLAS}")
    for m in ("Diffuse", "opacity"):
        url = files[m]["2k"]["png"]["url"]
        fetch(url, raw / "polyhaven" / POLYHAVEN_ATLAS / Path(url).name)
    credits[POLYHAVEN_ATLAS] = credit(POLYHAVEN_ATLAS)
    files = fetch_json(f"https://api.polyhaven.com/files/{POLYHAVEN_BOULDER}")
    g = files["gltf"]["1k"]["gltf"]
    folder = raw / "polyhaven" / POLYHAVEN_BOULDER
    fetch(g["url"], folder / Path(g["url"]).name)
    for rel, inc in g["include"].items():
        fetch(inc["url"], folder / rel)
    credits[POLYHAVEN_BOULDER] = credit(POLYHAVEN_BOULDER)
    files = fetch_json(f"https://api.polyhaven.com/files/{POLYHAVEN_HDRI}")
    fetch(files["hdri"]["1k"]["hdr"]["url"], raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_1k.hdr")
    fetch(files["tonemapped"]["url"], raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_tonemapped.jpg")
    credits[POLYHAVEN_HDRI] = credit(POLYHAVEN_HDRI)
    return credits


def fetch_polyhaven_hd(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for pid, maps in {**HD_TEXTURES, **HD_CUTOUTS}.items():
        files = fetch_json(f"https://api.polyhaven.com/files/{pid}")
        for m in maps:
            url = files[m]["2k"]["jpg"]["url"]
            fetch(url, raw / "polyhaven" / pid / f"{m}.jpg")
        credits[pid] = credit(pid)
    return credits


def hd_map(raw: Path, pid: str, key: str) -> Image.Image:
    return Image.open(raw / "polyhaven" / pid / f"{key}.jpg")


def fetch_ambientcg(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for aid in AMBIENTCG:
        z = fetch(f"https://ambientcg.com/get?file={aid}_1K-JPG.zip", raw / "ambientcg" / f"{aid}_1K-JPG.zip")
        out = raw / "ambientcg" / aid
        if not out.is_dir():
            with zipfile.ZipFile(z) as zf:
                zf.extractall(out)
        credits[aid] = {"name": aid, "authors": ["ambientCG (Lennart Demes)"],
                        "url": f"https://ambientcg.com/view?id={aid}", "licence": "CC0 1.0"}
    return credits


def ph(raw: Path, pid: str, key: str) -> Image.Image:
    folder = raw / "polyhaven" / pid
    suffixes = {"Diffuse": ("_diff_",), "nor_gl": ("_nor_gl_",), "opacity": ("_opacity_",)}[key]
    f = next(p for p in sorted(folder.iterdir()) if any(s in p.name for s in suffixes))
    return Image.open(f)


def acg(raw: Path, aid: str, key: str) -> Image.Image:
    folder = raw / "ambientcg" / aid
    f = next(p for p in sorted(folder.iterdir()) if p.name.endswith(f"_{key}.jpg"))
    return Image.open(f)


def save(img: Image.Image, path: Path, size: int | tuple[int, int], quality: int = 86) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wh = (size, size) if isinstance(size, int) else size
    im = img.convert("RGB").resize(wh, Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=False, subsampling=0 if "nrm" in path.name else 2)


# ---------------------------------------------------------------- leaf atlas
def components(mask: np.ndarray, min_px: int, labels: np.ndarray | None = None) -> list[tuple[int, int, int, int, int]]:
    """4-connected components of a boolean mask: (x0, y0, x1, y1, area), largest first. With
    `labels`, writes each kept component's 1-based rank into it."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out = []
    members: list[list[tuple[int, int]]] = []
    for y in range(h):
        row = mask[y] & ~seen[y]
        xs = np.flatnonzero(row)
        for x in xs:
            if seen[y, x]:
                continue
            q = deque([(y, x)])
            seen[y, x] = True
            x0 = x1 = x
            y0 = y1 = y
            px: list[tuple[int, int]] = []
            while q:
                cy, cx = q.popleft()
                px.append((cy, cx))
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if len(px) >= min_px:
                out.append((x0, y0, x1 + 1, y1 + 1, len(px)))
                members.append(px)
    order = sorted(range(len(out)), key=lambda i: (-out[i][4], out[i][1], out[i][0]))
    if labels is not None:
        for rank, i in enumerate(order, start=1):
            ys, xs = zip(*members[i])
            labels[list(ys), list(xs)] = rank
    return [out[i] for i in order]


def classify(rgb: np.ndarray, alpha: np.ndarray) -> str:
    sel = alpha > 0.5
    r, g, b = (rgb[..., i][sel].mean() for i in range(3))
    if r > g * 1.1 and b > g * 0.9:
        return "flower"
    if r > g * 0.92 and r > b * 1.6:
        return "yellow"
    if g > r * 1.05 and g > b * 1.3:
        return "green"
    return "stick"


def sprite(diff: Image.Image, alpha: Image.Image, box: tuple[int, int, int, int], tile: int,
           upright: bool, own: Image.Image) -> Image.Image:
    """Crop one scanned sprite (alpha limited to its own component `own`, so neighbouring scraps in
    the box drop out), turn its long axis to +v, centre it in a tile."""
    pad = 6
    x0, y0, x1, y1 = box
    crop = (max(0, x0 - pad), max(0, y0 - pad), min(diff.width, x1 + pad), min(diff.height, y1 + pad))
    rgba = diff.convert("RGB").crop(crop)
    a = np.minimum(np.asarray(alpha.convert("L").crop(crop)), np.asarray(own.crop(crop)))
    rgba.putalpha(Image.fromarray(a))
    if upright:
        m = np.asarray(a, dtype=np.float32) / 255.0
        ys, xs = np.nonzero(m > 0.5)
        cx, cy = xs.mean(), ys.mean()
        cov = np.cov(np.stack([xs - cx, ys - cy]))
        evals, evecs = np.linalg.eigh(cov)
        vx, vy = evecs[:, int(np.argmax(evals))]
        ang = np.degrees(np.arctan2(vy, vx))
        rgba = rgba.rotate(ang + 90.0, resample=Image.BICUBIC, expand=True)
        # leaf tip (narrower end) up: the petiole half has less area
        m = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
        ys = np.nonzero(m.sum(axis=1) > 0)[0]
        mid = (ys[0] + ys[-1]) // 2
        if m[:mid].sum() > m[mid:].sum():
            rgba = rgba.rotate(180, expand=True)
        bb = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        rgba = rgba.crop(bb)
    inner = int(tile * 0.92)
    s = inner / max(rgba.width, rgba.height)
    rgba = rgba.resize((max(1, round(rgba.width * s)), max(1, round(rgba.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (tile, tile), (0, 0, 0, 0))
    out.alpha_composite(rgba, ((tile - rgba.width) // 2, (tile - rgba.height) // 2))
    return out


def recolor_rgba(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Keep the scan's luminance (veins, blemishes); re-centre the leaf's mean colour on `rgb`."""
    a = img.getchannel("A")
    lum = np.asarray(img.convert("L"), dtype=np.float32)
    m = np.asarray(a, dtype=np.float32) > 128
    mean = max(1.0, float(lum[m].mean()))
    chans = [np.clip(lum * (k / mean), 0, 255).astype(np.uint8) for k in rgb]
    out = Image.merge("RGB", [Image.fromarray(c) for c in chans])
    out.putalpha(a)
    return out


def bleed(tile: Image.Image) -> Image.Image:
    """Spread interior colour over the edge band and under transparent texels: the scan's partial-alpha
    rim carries its pale backing sheet, and mip levels would halo it."""
    a = tile.getchannel("A").filter(ImageFilter.MinFilter(3))
    have = np.asarray(tile.getchannel("A").filter(ImageFilter.MinFilter(7)), dtype=np.float32)[..., None] > 240
    rgb = np.asarray(tile.convert("RGB"), dtype=np.float32) * have
    out = rgb.copy()
    filled = have.copy()
    for r in (2, 6, 16, 48):
        num = np.asarray(Image.fromarray(rgb.astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)
        den = np.asarray(Image.fromarray((have[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)),
                         dtype=np.float32)[..., None] / 255.0
        ok = (den > 0.02) & ~filled
        out = np.where(ok, np.clip(num / np.maximum(den, 1e-3), 0, 255), out)
        filled |= ok
    img = Image.fromarray(out.astype(np.uint8))
    img.putalpha(a)
    return img


def leaf_atlas(raw: Path) -> tuple[Image.Image, dict]:
    diff = ph(raw, POLYHAVEN_ATLAS, "Diffuse").convert("RGB")
    alpha = ph(raw, POLYHAVEN_ATLAS, "opacity").convert("L")
    small = 512
    k = diff.width / small
    m = np.asarray(alpha.resize((small, small), Image.BILINEAR), dtype=np.float32) / 255.0 > 0.5
    rgb_small = np.asarray(diff.resize((small, small), Image.BILINEAR), dtype=np.float32)
    a_small = np.asarray(alpha.resize((small, small), Image.BILINEAR), dtype=np.float32) / 255.0
    found: dict[str, list[tuple[int, int, int, int]]] = {"green": [], "yellow": [], "flower": [], "stick": []}
    own: dict[tuple[int, int, int, int], Image.Image] = {}
    labels = np.zeros(m.shape, dtype=np.int32)
    for rank, (x0, y0, x1, y1, n) in enumerate(components(m, 300, labels), start=1):
        if x0 < small * 0.1:  # the bark strip down the left edge
            continue
        sel = labels[y0:y1, x0:x1] == rank
        kind = classify(rgb_small[y0:y1, x0:x1], a_small[y0:y1, x0:x1] * sel)
        # stems are long and thin; leaves and petals fill much of their box
        if n < 0.3 * (x1 - x0) * (y1 - y0):
            kind = "stick"
        box = (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k))
        found[kind].append(box)
        mask = Image.fromarray(((labels == rank) * 255).astype(np.uint8))
        own[box] = mask.resize(diff.size, Image.NEAREST).filter(ImageFilter.MaxFilter(9))
    assert len(found["green"]) >= 3 and len(found["yellow"]) >= 1 and len(found["flower"]) >= 2, \
        {kk: len(v) for kk, v in found.items()}
    tile = 512

    def cut(kind: str, i: int, upright: bool = True) -> Image.Image:
        box = found[kind][i]
        return sprite(diff, alpha, box, tile, upright, own[box])

    t = {
        "green0": cut("green", 0), "green1": cut("green", 1), "green2": cut("green", 2),
        "yellow": cut("yellow", 0), "flower0": cut("flower", 0, False), "flower1": cut("flower", 1, False),
    }
    red = recolor_rgba(t["green1"], (172, 38, 24))
    orange = recolor_rgba(t["yellow"], (214, 104, 26))
    layout = {  # (col, row) -> tile; autumn of (c, r) is (c + 2, r)
        (0, 0): t["green0"], (2, 0): t["yellow"],
        (1, 0): t["green1"], (3, 0): red,
        (0, 1): t["green2"], (2, 1): orange,
        (1, 1): t["flower0"], (3, 1): t["flower1"],
    }
    atlas = Image.new("RGBA", (tile * ATLAS_COLS, tile * ATLAS_ROWS), (0, 0, 0, 0))
    for (c, r), im in layout.items():
        atlas.alpha_composite(bleed(im), (c * tile, r * tile))
    meta = {"cols": ATLAS_COLS, "rows": ATLAS_ROWS, "leaves": [[0, 0], [1, 0], [0, 1]], "blossoms": [[1, 1], [3, 1]],
            "autumnOffsetU": 0.5, "sources": {kk: list(v[:3]) for kk, v in found.items()}}
    return atlas, meta


# ---------------------------------------------------------------- HD leaf atlas
# Composed at 2x (256 px cells), shipped at 1024 x 512 (128 px cells). The green half is 4 x 4 cells;
# every autumn twin sits 4 cells (u + 0.5) to the right, as in the Standard atlas.
HD_CELL = 256
HD_SPRIGS = [(c, 0) for c in range(4)]                # 1 x 2 cells each: clustered leaf sprays
HD_LEAVES = [(0, 2), (1, 2), (2, 2), (3, 2), (0, 3), (1, 3), (3, 3)]
HD_BLOSSOM = (2, 3)                                    # its autumn-half twin is the falling leaf
GREEN_TINTS = [(0.94, 1.02, 0.9), (0.88, 1.0, 0.82), (0.84, 0.96, 0.9), (0.96, 1.04, 0.84)]
AUTUMN = [(178, 40, 24), (204, 76, 26), (220, 118, 30), (206, 150, 42), (158, 34, 30)]


def cutouts(raw: Path, pid: str, min_px: int = 150, small: int = 512) -> tuple[Image.Image, Image.Image, list[dict]]:
    """Every opaque scrap of one scanned cut-out sheet, largest first, with its own mask."""
    diff = hd_map(raw, pid, HD_CUTOUTS[pid][0]).convert("RGB")
    alpha = hd_map(raw, pid, HD_CUTOUTS[pid][1]).convert("L")
    k = diff.width / small
    a_small = np.asarray(alpha.resize((small, small), Image.BILINEAR), dtype=np.float32) / 255.0
    rgb_small = np.asarray(diff.resize((small, small), Image.BILINEAR), dtype=np.float32)
    labels = np.zeros(a_small.shape, dtype=np.int32)
    out = []
    for rank, (x0, y0, x1, y1, n) in enumerate(components(a_small > 0.5, min_px, labels), start=1):
        sel = labels[y0:y1, x0:x1] == rank
        own = Image.fromarray(((labels == rank) * 255).astype(np.uint8)).resize(diff.size, Image.NEAREST)
        out.append({"box": (round(x0 * k), round(y0 * k), round(x1 * k), round(y1 * k)), "area": n,
                    "fill": n / max(1, (x1 - x0) * (y1 - y0)), "mean": rgb_small[y0:y1, x0:x1][sel].mean(axis=0),
                    "own": own.filter(ImageFilter.MaxFilter(5)), "x": (x0 + x1) / 2 * k, "y": (y0 + y1) / 2 * k})
    return diff, alpha, out


def extract(diff: Image.Image, alpha: Image.Image, c: dict, upright: bool = True) -> Image.Image:
    """One scrap as RGBA, long axis vertical with its stalk (the thin end) at the top."""
    pad = 8
    x0, y0, x1, y1 = c["box"]
    crop = (max(0, x0 - pad), max(0, y0 - pad), min(diff.width, x1 + pad), min(diff.height, y1 + pad))
    rgba = diff.crop(crop)
    a = np.minimum(np.asarray(alpha.crop(crop)), np.asarray(c["own"].crop(crop)))
    rgba.putalpha(Image.fromarray(a))
    if upright:
        m = a.astype(np.float32) / 255.0
        ys, xs = np.nonzero(m > 0.5)
        cov = np.cov(np.stack([xs - xs.mean(), ys - ys.mean()]))
        vx, vy = np.linalg.eigh(cov)[1][:, -1]
        rgba = rgba.rotate(float(np.degrees(np.arctan2(vy, vx))) + 90.0, resample=Image.BICUBIC, expand=True)
        m = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0 > 0.5
        rows = np.nonzero(m.sum(axis=1))[0]
        width = m.sum(axis=1)[rows[0]:rows[-1] + 1]
        thin = width < 0.18 * width.max()
        q = max(1, len(width) // 4)
        if thin[-q:].sum() > thin[:q].sum():
            rgba = rgba.rotate(180, expand=True)
    bb = rgba.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return rgba.crop(bb)


def fit(rgba: Image.Image, w: int, h: int, fill: float = 0.92, top: bool = False) -> Image.Image:
    """Scale into a w x h tile (centred, or hung from the top edge)."""
    s = min(w * fill / rgba.width, h * fill / rgba.height)
    im = rgba.resize((max(1, round(rgba.width * s)), max(1, round(rgba.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = round(h * (1 - fill) / 2) if top else (h - im.height) // 2
    out.alpha_composite(im, ((w - im.width) // 2, y))
    return out


def tint(img: Image.Image, mul: tuple[float, float, float]) -> Image.Image:
    a = img.getchannel("A")
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32) * np.asarray(mul, dtype=np.float32)
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    out.putalpha(a)
    return out


def hung(leaf: Image.Image, length: float, angle: float) -> tuple[Image.Image, tuple[int, int]]:
    """`leaf` (stalk up) scaled to `length` px and swung `angle` degrees about its stalk; returns the
    image and the stalk's pixel offset inside it."""
    s = length / leaf.height
    im = leaf.resize((max(1, round(leaf.width * s)), max(1, round(leaf.height * s))), Image.LANCZOS)
    side = 2 * max(im.width, im.height) + 4
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(im, (side // 2 - im.width // 2, side // 2))
    return sq.rotate(angle, resample=Image.BICUBIC, center=(side / 2, side / 2)), (side // 2, side // 2)


def sprig(leaves: list[Image.Image], twig: Image.Image, seed: int, n: int, length: tuple[float, float],
          autumn: bool) -> Image.Image:
    """A spray: scanned leaves set alternately down a scanned twig, hung from the tile top."""
    rng = np.random.default_rng(seed)
    w, h = HD_CELL, 2 * HD_CELL
    out = fit(twig, w, h, 0.86, top=True)
    picks = []
    for i in range(n):
        t = 0.08 + 0.8 * i / max(1, n - 1)
        side = -1 if i % 2 else 1
        ang = side * rng.uniform(32, 62) if i < n - 1 else rng.uniform(-8, 8)
        leaf = leaves[int(rng.integers(len(leaves)))]
        if autumn:
            leaf = recolor_rgba(leaf, AUTUMN[int(rng.integers(len(AUTUMN)))])
        picks.append((t, ang, leaf, rng.uniform(*length)))
    for t, ang, leaf, ln in sorted(picks, key=lambda p: -p[0]):
        im, (ox, oy) = hung(leaf, ln * h, ang)
        out.alpha_composite(im, (w // 2 - ox, round(6 + t * h * 0.84) - oy))
    return out


def blossom(raw: Path) -> Image.Image:
    """The scanned sorrel flower's five loose petals drawn in around their centre, lightened to a
    blush the host tints pink, white or plum."""
    diff, alpha, scraps = cutouts(raw, "shrub_sorrel_01")
    petals = [c for c in scraps if c["mean"][0] > c["mean"][1] * 1.15]
    assert len(petals) >= 5, len(petals)
    petals = petals[:5]
    cx = sum(c["x"] for c in petals) / 5
    cy = sum(c["y"] for c in petals) / 5
    side = 1024
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    for c in petals:
        im = extract(diff, alpha, c, upright=False)
        px = side / 2 + (c["x"] - cx) * 0.55 - im.width / 2
        py = side / 2 + (c["y"] - cy) * 0.55 - im.height / 2
        out.alpha_composite(im, (round(px), round(py)))
    rgb = np.asarray(out.convert("RGB"), dtype=np.float32)
    blush = np.asarray(recolor_rgba(out, (248, 196, 214)).convert("RGB"), dtype=np.float32)
    mixed = Image.fromarray(np.clip(rgb * 0.12 + blush * 0.88, 0, 255).astype(np.uint8))
    mixed.putalpha(out.getchannel("A"))
    bb = mixed.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return mixed.crop(bb)


def hd_leaf_atlas(raw: Path) -> tuple[Image.Image, dict]:
    def leaves_of(pid: str, k: int, min_fill: float = 0.45) -> list[Image.Image]:
        """The sheet's green leaves (the bark strips and twigs are brown or thin), largest first."""
        diff, alpha, scraps = cutouts(raw, pid)
        keep = [c for c in scraps if c["fill"] > min_fill and c["mean"][1] > c["mean"][0] * 0.98]
        keep = [c for c in keep if c["area"] > 0.25 * keep[0]["area"]]
        return [extract(diff, alpha, c) for c in keep[:k]]

    island = leaves_of("island_tree_02", 8)
    searsia = leaves_of("searsia_lucida", 8)
    shrub = leaves_of("shrub_04", 8)
    assert len(island) >= 6 and len(searsia) >= 5 and len(shrub) >= 4, (len(island), len(searsia), len(shrub))
    # the searsia sheet's thin branching twigs (scanned bark, brown, sparse in their box)
    diff, alpha, scraps = cutouts(raw, "searsia_lucida")
    twigs = [extract(diff, alpha, c) for c in scraps
             if c["fill"] < 0.2 and c["area"] > 500 and c["mean"][0] > c["mean"][1]][:3]
    assert len(twigs) >= 2, len(twigs)

    cell = HD_CELL
    green = Image.new("RGBA", (4 * cell, 4 * cell), (0, 0, 0, 0))
    autumn = Image.new("RGBA", (4 * cell, 4 * cell), (0, 0, 0, 0))

    def put(im_g: Image.Image, im_a: Image.Image, c: int, r: int) -> None:
        green.alpha_composite(bleed(im_g), (c * cell, r * cell))
        autumn.alpha_composite(bleed(im_a), (c * cell, r * cell))

    sprays = ((searsia, twigs[0], 9, (0.2, 0.27)), (shrub, twigs[1], 7, (0.24, 0.31)),
              (island, twigs[0], 6, (0.28, 0.36)), (searsia + shrub, twigs[-1], 8, (0.21, 0.29)))
    for i, (pool, twig, n, ln) in enumerate(sprays):
        g = sprig(pool, twig, 11 + i, n, ln, False)
        a = sprig(pool, twig, 11 + i, n, ln, True)
        put(tint(g, GREEN_TINTS[i % 4]), a, *HD_SPRIGS[i])
    singles = [island[0], island[2], searsia[0], shrub[0], island[4], searsia[2], shrub[2]]
    for i, (leaf, (c, r)) in enumerate(zip(singles, HD_LEAVES)):
        t = fit(leaf, cell, cell, 0.9, top=True)
        put(tint(t, GREEN_TINTS[i % 4]), recolor_rgba(t, AUTUMN[(i * 2) % len(AUTUMN)]), c, r)
    bc, br = HD_BLOSSOM
    green.alpha_composite(bleed(fit(blossom(raw), cell, cell, 0.94)), (bc * cell, br * cell))
    fall = fit(island[1], cell, cell, 0.9, top=True)
    autumn.alpha_composite(bleed(recolor_rgba(fall, (226, 190, 92))), (bc * cell, br * cell))

    atlas = Image.new("RGBA", (8 * cell, 4 * cell), (0, 0, 0, 0))
    atlas.alpha_composite(green, (0, 0))
    atlas.alpha_composite(autumn, (4 * cell, 0))
    px = cell // 2  # shipped px per cell

    def rect(c: int, r: int, w: int = 1, h: int = 1) -> list[int]:
        return [c * px, r * px, (c + w) * px, (r + h) * px]

    meta = {"size": [8 * px, 4 * px], "autumnOffsetU": 0.5,
            "sprigs": [rect(c, r, 1, 2) for c, r in HD_SPRIGS], "leaves": [rect(c, r) for c, r in HD_LEAVES],
            "blossom": rect(*HD_BLOSSOM), "fall": rect(HD_BLOSSOM[0] + 4, HD_BLOSSOM[1])}
    return atlas, meta


def moss_fronds(raw: Path) -> Image.Image:
    """Four scanned moss fronds (Poly Haven moss_01), base at the bottom, 64 x 128 each."""
    diff, alpha, scraps = cutouts(raw, "moss_01", min_px=60)
    fronds = sorted(scraps[:4], key=lambda c: c["x"])
    assert len(fronds) == 4, len(scraps)
    out = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
    for i, c in enumerate(fronds):
        im = extract(diff, alpha, c, upright=False)
        tile = Image.new("RGBA", (128, 256), (0, 0, 0, 0))
        s = min(128 * 0.94 / im.width, 256 * 0.96 / im.height)
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        tile.alpha_composite(im, ((128 - im.width) // 2, 256 - im.height - 2))
        out.alpha_composite(bleed(tile), (i * 128, 0))
    return out


def save_quantised(img: Image.Image, path: Path, size: tuple[int, int]) -> None:
    """256-colour PNG with alpha (libimagequant): a third of the RGBA PNG's bytes for alpha-tested cards."""
    path.parent.mkdir(parents=True, exist_ok=True)
    im = img.resize(size, Image.LANCZOS)
    im.quantize(256, method=Image.Quantize.LIBIMAGEQUANT, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def save_png(img: Image.Image, path: Path, size: tuple[int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize(size, Image.LANCZOS).save(path, optimize=True)


def contact_shadow(w: int, h: int) -> Image.Image:
    """Soft elliptical shadow (alpha) for the board on the ground and the slab on the board."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((xx - (w - 1) / 2) / (w / 2), (yy - (h - 1) / 2) / (h / 2))
    a = np.clip(1 - d * d, 0, 1) ** 1.6 * 0.85
    im = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(w / 48))
    black = Image.new("L", (w, h), 0)
    return Image.merge("RGBA", (black, black, black, im))


def prepare(raw: Path, prep: Path) -> dict:
    std, hd, bould = prep / "standard", prep / "hd", prep / "boulder"
    atlas, meta = leaf_atlas(raw)
    save_png(atlas, std / "leaf_atlas.png", (512, 256))
    hd_atlas, meta["hd"] = hd_leaf_atlas(raw)
    save_quantised(hd_atlas, hd / "leaf_atlas.png", tuple(meta["hd"]["size"]))
    save_quantised(moss_fronds(raw), hd / "moss_fronds.png", (256, 128))

    bark = ph(raw, "japanese_zelkova_bark", "Diffuse")
    save(bark, std / "bark_diff.jpg", 256)
    # HD trunk: the willow scan's deep furrows (warmed from its grey toward the zelkova's brown); its
    # height map displaces the swept bark at build time
    willow = np.asarray(hd_map(raw, "bark_willow_02", "Diffuse").convert("RGB"), dtype=np.float32)
    willow = Image.fromarray(np.clip(willow * (1.0, 0.9, 0.78), 0, 255).astype(np.uint8))
    save(willow, hd / "bark_diff.jpg", 512)
    save(hd_map(raw, "bark_willow_02", "nor_gl"), hd / "bark_nrm.jpg", 256, 90)
    hd_map(raw, "bark_willow_02", "Displacement").convert("L").resize((512, 512), Image.LANCZOS).save(
        hd / "bark_height.png", optimize=True)
    save(hd_map(raw, "mossy_rock", "Diffuse"), hd / "mossy_rock_diff.jpg", 1024)

    wood = ph(raw, "dark_wood", "Diffuse")
    save(wood, std / "wood_diff.jpg", 256)
    save(wood, hd / "wood_diff.jpg", 256)
    # bench planks: the top half of the scan (planks run along u), so 2:1 maps keep the grain
    cedar = ph(raw, "japanese_cedar_planks", "Diffuse")
    cedar = cedar.crop((0, 0, cedar.width, cedar.height // 2))
    save(cedar, std / "bench_diff.jpg", (256, 128))
    save(cedar, hd / "bench_diff.jpg", (320, 160))

    moss = acg(raw, "Moss002", "Color")
    save(moss, std / "moss_diff.jpg", 256)
    save(moss, hd / "moss_diff.jpg", 256)
    save(acg(raw, "Moss002", "NormalGL"), hd / "moss_nrm.jpg", 128, 90)

    folder = raw / "polyhaven" / POLYHAVEN_BOULDER
    rock = Image.open(next((folder / "textures").glob("*_diff_1k.jpg")))
    save(rock, std / "rock_diff.jpg", 256)
    save(rock, hd / "rock_diff.jpg", 512)
    save(Image.open(next((folder / "textures").glob("*_nor_gl_1k.jpg"))), hd / "rock_nrm.jpg", 256, 90)
    bould.mkdir(parents=True, exist_ok=True)
    (bould / "source.json").write_text(json.dumps({"gltf": str(next(folder.glob("*.gltf")))}) + "\n")

    for d in (std, hd):
        contact_shadow(128, 128).save(d / "contact_shadow.png", optimize=True)
    # HD image-based lighting (plugin.yml role: environment): equirect LDR, loaded by the host's
    # TextureLoader (flipY on), so it is stored upright
    env = Image.open(raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_tonemapped.jpg").convert("RGB")
    env.resize((512, 256), Image.LANCZOS).save(hd / "env-hd.jpg", "JPEG", quality=86, optimize=True)
    return meta


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[4] / "out" / "sources" / "bonsai"))
    args = ap.parse_args()
    root = Path(args.root)
    raw = root / "raw"
    credits = {**fetch_polyhaven(raw), **fetch_polyhaven_hd(raw), **fetch_ambientcg(raw)}
    meta = prepare(raw, root / "prep")
    (root / "credits.json").write_text(json.dumps(credits, indent=2, sort_keys=True) + "\n")
    (root / "prep" / "atlas.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    print(f"prepared maps in {root / 'prep'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
