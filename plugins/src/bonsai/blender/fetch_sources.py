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
    save_png(atlas, hd / "leaf_atlas.png", (1024, 512))

    bark = ph(raw, "japanese_zelkova_bark", "Diffuse")
    save(bark, std / "bark_diff.jpg", 256)
    save(bark, hd / "bark_diff.jpg", 512)
    save(ph(raw, "japanese_zelkova_bark", "nor_gl"), hd / "bark_nrm.jpg", 256, 90)

    wood = ph(raw, "dark_wood", "Diffuse")
    save(wood, std / "wood_diff.jpg", 256)
    save(wood, hd / "wood_diff.jpg", 256)
    # bench planks: the top half of the scan (planks run along u), so 2:1 maps keep the grain
    cedar = ph(raw, "japanese_cedar_planks", "Diffuse")
    cedar = cedar.crop((0, 0, cedar.width, cedar.height // 2))
    save(cedar, std / "bench_diff.jpg", (256, 128))
    save(cedar, hd / "bench_diff.jpg", (384, 192))

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
    credits = {**fetch_polyhaven(raw), **fetch_ambientcg(raw)}
    meta = prepare(raw, root / "prep")
    (root / "credits.json").write_text(json.dumps(credits, indent=2, sort_keys=True) + "\n")
    (root / "prep" / "atlas.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    print(f"prepared maps in {root / 'prep'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
