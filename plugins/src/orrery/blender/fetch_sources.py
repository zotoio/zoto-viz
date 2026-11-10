"""Download and prepare the Orrery's CC0 source maps (run before build_orrery.py).

  .venv/bin/python plugins/src/orrery/blender/fetch_sources.py [--root out/sources/orrery]

Downloads Poly Haven and ambientCG originals (2K JPG, 1K HDR) into <root>/raw/ (gitignored) and
writes the maps the Blender build packs into the GLBs:

  <root>/prep/standard/*.jpg   128-256 px base colour only (Standard model set)
  <root>/prep/hd/*.jpg         256-512 px base colour + glTF normal maps (HD model set)

HD fits the pack's 8 MiB workBudget.maxGpuBytes (RGBA8 + mips, plus the env probe's PMREM): the
scanned roughness / metal maps and the brass and walnut normals are near-constant, so the build
uses their mean as a material factor instead; one neutral leather scan is tinted per material by
baseColorFactor; the seven planets and the ring share one 512 px atlas.

Brass has no CC0 photo source, so it is ambientCG Metal048B (gold, fingerprints) re-tinted to a
brass colour. Deterministic: same inputs, same bytes.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageFilter

UA = {"User-Agent": "zoto-viz-orrery-build/1.0 (+https://github.com/zotoio/zoto-viz)"}

# Poly Haven texture ids -> maps to fetch (2k jpg). nor_gl = OpenGL (+Y) normal, the glTF convention.
POLYHAVEN_TEXTURES = {
    "black_walnut_veneer_02": ("Diffuse", "nor_gl", "Rough"),
    "leather_red_02": ("Diffuse", "nor_gl", "Rough"),
    "aerial_rocks_02": ("Diffuse",),
    "marble_cliff_02": ("Diffuse",),
    "snow_field_aerial": ("Diffuse",),
}
POLYHAVEN_HDRI = "fireplace"
# ambientCG material ids (2K-JPG zips).
AMBIENTCG = ("Metal048B", "Metal051A", "Onyx010", "Onyx013", "Marble012", "Travertine009")

BRASS_RGB = (0.86, 0.69, 0.40)


def fetch(url: str, dest: Path) -> Path:
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    print(f"fetched {url} -> {dest} ({len(data)} B)")
    return dest


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def fetch_polyhaven(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for pid, maps in POLYHAVEN_TEXTURES.items():
        files = fetch_json(f"https://api.polyhaven.com/files/{pid}")
        info = fetch_json(f"https://api.polyhaven.com/info/{pid}")
        for m in maps:
            # leather_red_02 publishes its colour map as a colour variant ("coll1"), not "Diffuse"
            key = m if m in files else "coll1"
            url = files[key]["2k"]["jpg"]["url"]
            fetch(url, raw / "polyhaven" / pid / Path(url).name)
        credits[pid] = {"name": info.get("name", pid), "authors": sorted((info.get("authors") or {}).keys()),
                        "url": f"https://polyhaven.com/a/{pid}", "licence": "CC0 1.0"}
    files = fetch_json(f"https://api.polyhaven.com/files/{POLYHAVEN_HDRI}")
    info = fetch_json(f"https://api.polyhaven.com/info/{POLYHAVEN_HDRI}")
    fetch(files["hdri"]["1k"]["hdr"]["url"], raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_1k.hdr")
    fetch(files["tonemapped"]["url"], raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_tonemapped.jpg")
    credits[POLYHAVEN_HDRI] = {"name": info.get("name", POLYHAVEN_HDRI), "authors": sorted((info.get("authors") or {}).keys()),
                               "url": f"https://polyhaven.com/a/{POLYHAVEN_HDRI}", "licence": "CC0 1.0"}
    return credits


def fetch_ambientcg(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for aid in AMBIENTCG:
        z = fetch(f"https://ambientcg.com/get?file={aid}_2K-JPG.zip", raw / "ambientcg" / f"{aid}_2K-JPG.zip")
        out = raw / "ambientcg" / aid
        if not out.is_dir():
            with zipfile.ZipFile(z) as zf:
                zf.extractall(out)
        credits[aid] = {"name": aid, "authors": ["ambientCG (Lennart Demes)"],
                        "url": f"https://ambientcg.com/view?id={aid}", "licence": "CC0 1.0"}
    return credits


def ph(raw: Path, pid: str, key: str) -> Image.Image:
    folder = raw / "polyhaven" / pid
    suffixes = {"Diffuse": ("_diff_", "_col_", "_coll1_"), "nor_gl": ("_nor_gl_",), "Rough": ("_rough_",)}[key]
    f = next(p for p in sorted(folder.iterdir()) if any(s in p.name for s in suffixes))
    return Image.open(f)


def acg(raw: Path, aid: str, key: str) -> Image.Image:
    folder = raw / "ambientcg" / aid
    f = next(p for p in folder.iterdir() if p.name.endswith(f"_{key}.jpg"))
    return Image.open(f)


def save(img: Image.Image, path: Path, size: int, quality: int = 84) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im = img.convert("RGB").resize((size, size), Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=False, subsampling=0 if "nrm" in path.name else 2)


def save_wh(img: Image.Image, path: Path, w: int, h: int, quality: int = 84) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").resize((w, h), Image.LANCZOS).save(path, "JPEG", quality=quality, optimize=True,
                                                          progressive=False, subsampling=2)


def neutral(img: Image.Image, mean_to: int = 180) -> Image.Image:
    """Grey luminance scan re-centred on `mean_to`, for tinting by material baseColorFactor."""
    g = img.convert("L")
    mean = max(1.0, sum(i * n for i, n in enumerate(g.histogram())) / (g.size[0] * g.size[1]))
    g = Image.eval(g, lambda v: min(255, int(v * mean_to / mean)))
    return Image.merge("RGB", (g, g, g))


# HD planet atlas: 2 x 4 cells of 256 x 128 (equirect), planet-k at cell k, the ring band at cell 7.
ATLAS_W, ATLAS_H, ATLAS_COLS, ATLAS_ROWS, ATLAS_PAD = 512, 512, 2, 4, 2


def planet_atlas(cells: list[Image.Image]) -> Image.Image:
    """Each cell holds its map shrunk by ATLAS_PAD px a side, padded by wrapping in u (the equirect
    seam) and clamping in v, so mips never bleed a neighbour across a planet's edge."""
    cw, ch = ATLAS_W // ATLAS_COLS, ATLAS_H // ATLAS_ROWS
    p = ATLAS_PAD
    atlas = Image.new("RGB", (ATLAS_W, ATLAS_H))
    for k, src in enumerate(cells):
        inner = src.convert("RGB").resize((cw - 2 * p, ch - 2 * p), Image.LANCZOS)
        cell = Image.new("RGB", (cw, ch))
        cell.paste(inner, (p, p))
        cell.paste(inner.crop((inner.width - p, 0, inner.width, inner.height)), (0, p))
        cell.paste(inner.crop((0, 0, p, inner.height)), (cw - p, p))
        top, bottom = cell.crop((0, p, cw, p + 1)), cell.crop((0, ch - p - 1, cw, ch - p))
        for y in range(p):
            cell.paste(top, (0, y))
            cell.paste(bottom, (0, ch - 1 - y))
        atlas.paste(cell, ((k % ATLAS_COLS) * cw, (k // ATLAS_COLS) * ch))
    return atlas


def brass_tint(img: Image.Image) -> Image.Image:
    """Gold scan -> brass: keep the scan's luminance (fingerprints, scratches), swap the hue."""
    g = img.convert("L")
    r, gg, b = (Image.eval(g, lambda v, k=k: min(255, int(v * k * 1.18))) for k in BRASS_RGB)
    return Image.merge("RGB", (r, gg, b))


def recolor(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    """Keep the scan's luminance detail, re-centre its mean on `rgb` (dyed leather, dark walnut)."""
    g = img.convert("L")
    mean = max(1.0, sum(i * n for i, n in enumerate(g.histogram())) / (g.size[0] * g.size[1]))
    return Image.merge("RGB", tuple(Image.eval(g, lambda v, k=k: min(255, int(v * k / mean))) for k in rgb))


def contact_shadow(size: int) -> Image.Image:
    """Soft radial shadow (white = no shadow) for the plinth's contact patch on the desk."""
    im = Image.new("L", (size, size), 255)
    px = im.load()
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5 / c
            v = 1.0 if d >= 1 else 1.0 - 0.78 * (1 - d * d) ** 1.6
            px[x, y] = int(255 * v)
    return im.filter(ImageFilter.GaussianBlur(size / 64))


def prepare(raw: Path, prep: Path) -> None:
    std, hd = prep / "standard", prep / "hd"
    brass_d = brass_tint(acg(raw, "Metal048B", "Color"))
    save(brass_d, std / "brass_diff.jpg", 256)
    save(brass_d, hd / "brass_diff.jpg", 256)
    save(acg(raw, "Metal051A", "NormalGL"), hd / "brushed_nrm.jpg", 256, 90)

    walnut = ph(raw, "black_walnut_veneer_02", "Diffuse")
    walnut = Image.merge("RGB", tuple(Image.eval(c, lambda v, k=k: int(v * k)) for c, k in zip(walnut.convert("RGB").split(), (0.62, 0.52, 0.47))))
    save(walnut, std / "walnut_diff.jpg", 256)
    save(walnut, hd / "walnut_diff.jpg", 512, 86)
    leather = ph(raw, "leather_red_02", "Diffuse")
    for name, rgb in (("book_green", (44, 78, 52)), ("book_navy", (36, 48, 86))):
        save(recolor(leather, rgb), std / f"{name}.jpg", 128)
    save(neutral(leather), hd / "leather_lum.jpg", 512, 86)
    shade = recolor(acg(raw, "Marble012", "Color"), (22, 120, 70))
    save(shade, std / "lamp_shade.jpg", 128)
    save(shade, hd / "lamp_shade.jpg", 256)
    save(ph(raw, "leather_red_02", "Diffuse"), std / "leather_diff.jpg", 256)
    save(ph(raw, "leather_red_02", "nor_gl"), hd / "leather_nrm.jpg", 256, 90)
    save(acg(raw, "Travertine009", "Color"), hd / "pages.jpg", 256)

    planets = {
        "jove": acg(raw, "Onyx010", "Color"),
        "terra": ph(raw, "aerial_rocks_02", "Diffuse"),
        "ares": ph(raw, "marble_cliff_02", "Diffuse"),
        "luna": acg(raw, "Marble012", "Color"),
        "nox": acg(raw, "Onyx013", "Color"),
        "glacier": ph(raw, "snow_field_aerial", "Diffuse"),
        "saturn": acg(raw, "Travertine009", "Color"),
    }
    for name, img in planets.items():
        save(img, std / f"planet_{name}.jpg", 128)
    ring = acg(raw, "Travertine009", "Color")
    planet_atlas([*planets.values(), ring]).save(hd / "planet_atlas.jpg", "JPEG", quality=88, optimize=True,
                                                 progressive=False, subsampling=0)
    gold = acg(raw, "Metal048B", "Color")
    save(gold, std / "sun_diff.jpg", 256)
    save(gold, hd / "sun_diff.jpg", 256)
    for d, size in ((std, 256), (hd, 128)):
        sh = contact_shadow(size)
        d.mkdir(parents=True, exist_ok=True)
        black = Image.new("L", sh.size, 0)
        Image.merge("RGBA", (black, black, black, Image.eval(sh, lambda v: 255 - v))).save(d / "contact_shadow.png", optimize=True)
    # The pack's `role: environment` image (equirect LDR): the host keeps only its PMREM, and at
    # 512 wide that is one 384x512 half-float target (1.5 MB), which fits the HD budget.
    env = Image.open(raw / "polyhaven" / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_tonemapped.jpg").convert("RGB")
    env.resize((512, 256), Image.LANCZOS).save(hd / "env-hd.jpg", "JPEG", quality=88, optimize=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[4] / "out" / "sources" / "orrery"))
    args = ap.parse_args()
    root = Path(args.root)
    raw = root / "raw"
    credits = {**fetch_polyhaven(raw), **fetch_ambientcg(raw)}
    prepare(raw, root / "prep")
    (root / "credits.json").write_text(json.dumps(credits, indent=2, sort_keys=True) + "\n")
    print(f"prepared maps in {root / 'prep'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
