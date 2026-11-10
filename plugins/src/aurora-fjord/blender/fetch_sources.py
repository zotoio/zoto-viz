"""Download and prepare Aurora Fjord's CC0 sources (run before build_fjord.py).

  .venv/bin/python plugins/src/aurora-fjord/blender/fetch_sources.py [--root out/sources/aurora-fjord]

Downloads Poly Haven originals (2K JPG maps, 1K model maps, 1K HDR) into <root>/raw/ (gitignored)
and writes the maps the Blender build packs into the GLBs:

  <root>/prep/standard/*.jpg   a 256 px neutral rock detail map (Standard tints it with vertex colour)
                               and the cabin atlas at 256 px
  <root>/prep/hd/*             256-512 px rock / snow / forest-floor / shore-gravel maps, the rock
                               normal, the cabin atlas (plank siding, slate roof, trim), the mossy
                               boulder scan maps
  <root>/prep/hd/env-hd.jpg    lakeside_night HDRI as a 256 x 128 environment image (dim: it is night)
  <root>/prep/tints.json       mean colours of the photos, for per-vertex tints

build_fjord.py renders the HD fir card itself from the fir_sapling scan (the needles are geometry).

Both model sets fit the pack's 8 MiB workBudget.maxGpuBytes (RGBA8 + mips, plus the HD env PMREM).
Terrain colour comes from per-vertex tints sampled from the same photos, so the tiled maps only carry
detail. Deterministic: same inputs, same bytes.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

UA = {"User-Agent": "zoto-viz-aurora-fjord-build/1.0 (+https://github.com/zotoio/zoto-viz)"}
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
HDRI_TO_ENV = REPO / "plugins" / "src" / "koi-pond" / "blender" / "hdri_to_env.py"

# Poly Haven texture ids -> 2k jpg maps. nor_gl = OpenGL (+Y) normal, the glTF convention.
POLYHAVEN_TEXTURES = {
    "aerial_rocks_02": ("Diffuse", "nor_gl"),
    "snow_field_aerial": ("Diffuse",),
    "forest_ground_04": ("Diffuse",),
    "river_small_rocks": ("Diffuse",),
    "weathered_plank_siding": ("Diffuse",),
    "roof_slates_02": ("Diffuse",),
}
# Poly Haven models whose 1k maps (and, for the boulders, mesh) the build uses.
POLYHAVEN_MODELS = {
    "fir_sapling": ("gltf",),
    "rock_moss_set_02": ("gltf",),
}
POLYHAVEN_HDRI = "lakeside_night"


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


def credit(pid: str, kind: str) -> dict:
    info = fetch_json(f"https://api.polyhaven.com/info/{pid}")
    return {"name": info.get("name", pid), "kind": kind, "authors": sorted((info.get("authors") or {}).keys()),
            "url": f"https://polyhaven.com/a/{pid}", "licence": "CC0 1.0"}


def download(raw: Path) -> dict[str, dict]:
    credits: dict[str, dict] = {}
    for pid, maps in POLYHAVEN_TEXTURES.items():
        files = fetch_json(f"https://api.polyhaven.com/files/{pid}")
        for m in maps:
            url = files[m]["2k"]["jpg"]["url"]
            fetch(url, raw / pid / Path(url).name)
        credits[pid] = credit(pid, "texture")
    for pid, maps in POLYHAVEN_MODELS.items():
        files = fetch_json(f"https://api.polyhaven.com/files/{pid}")
        for m in maps:
            if m == "gltf":
                entry = files["gltf"]["1k"]["gltf"]
                fetch(entry["url"], raw / pid / Path(entry["url"]).name)
                for rel, inc in sorted(entry.get("include", {}).items()):
                    fetch(inc["url"], raw / pid / rel)
            else:
                url = files[m]["1k"]["png"]["url"]
                fetch(url, raw / pid / Path(url).name)
        credits[pid] = credit(pid, "model")
    files = fetch_json(f"https://api.polyhaven.com/files/{POLYHAVEN_HDRI}")
    fetch(files["hdri"]["1k"]["hdr"]["url"], raw / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_1k.hdr")
    credits[POLYHAVEN_HDRI] = credit(POLYHAVEN_HDRI, "hdri")
    return credits


def ph(raw: Path, pid: str, key: str) -> Image.Image:
    folder = raw / pid
    tag = {"Diffuse": ("_diff_", "_col_"), "nor_gl": ("_nor_gl_",)}.get(key, (f"_{key}_",))
    f = next(p for p in sorted(folder.rglob("*")) if p.is_file() and any(s in p.name for s in tag))
    return Image.open(f)


def save_jpg(img: Image.Image, path: Path, size: int | tuple[int, int], quality: int = 84) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wh = (size, size) if isinstance(size, int) else size
    im = img.convert("RGB").resize(wh, Image.LANCZOS)
    im.save(path, "JPEG", quality=quality, optimize=True, progressive=False, subsampling=0 if "nrm" in path.name else 2)


def mean_rgb(img: Image.Image) -> list[float]:
    small = img.convert("RGB").resize((16, 16), Image.BOX)
    px = list(small.getdata())
    return [round(sum(p[c] for p in px) / len(px) / 255.0, 4) for c in range(3)]


def neutral(img: Image.Image, mean_to: int = 190) -> Image.Image:
    """Grey luminance re-centred on `mean_to`, so per-vertex tints carry the colour."""
    g = img.convert("L")
    mean = max(1.0, sum(i * n for i, n in enumerate(g.histogram())) / (g.size[0] * g.size[1]))
    g = Image.eval(g, lambda v: min(255, int(v * mean_to / mean)))
    return Image.merge("RGB", (g, g, g))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", type=Path, default=REPO / "out" / "sources" / "aurora-fjord")
    ap.add_argument("--download-only", action="store_true")
    args = ap.parse_args(argv)
    raw = args.root / "raw"
    credits = download(raw)
    (args.root / "credits.json").write_text(json.dumps(credits, indent=1, sort_keys=True) + "\n")
    if args.download_only:
        return 0
    return prep(raw, args.root / "prep")


def crop_band(img: Image.Image, size: tuple[int, int], top: float = 0.0) -> Image.Image:
    """Scale to the band width, keep the source aspect and take a `size` band from `top` (0..1)."""
    w, h = size
    src = img.convert("RGB")
    sh = round(src.height * w / src.width)
    src = src.resize((w, sh), Image.LANCZOS)
    y = min(max(0, round((sh - h) * top)), sh - h)
    return src.crop((0, y, w, y + h))


def cabin_atlas(raw: Path) -> Image.Image:
    """512 px atlas: plank siding (v 0.375..1), slate roof (v 0.0625..0.375), dark trim (v 0..0.0625)."""
    atlas = Image.new("RGB", (512, 512))
    planks = crop_band(ph(raw, "weathered_plank_siding", "Diffuse"), (512, 320))
    atlas.paste(planks, (0, 0))
    atlas.paste(crop_band(ph(raw, "roof_slates_02", "Diffuse"), (512, 160), 0.3), (0, 320))
    trim = ImageOps.autocontrast(planks.crop((0, 0, 512, 32))).point(lambda v: int(v * 0.45))
    atlas.paste(trim, (0, 480))
    return atlas


def prep(raw: Path, out: Path) -> int:
    std, hd = out / "standard", out / "hd"
    rock = ph(raw, "aerial_rocks_02", "Diffuse")
    save_jpg(neutral(rock), std / "rock-detail.jpg", 256)
    save_jpg(rock, hd / "rock.jpg", 512)
    save_jpg(ph(raw, "aerial_rocks_02", "nor_gl"), hd / "rock-nrm.jpg", 256, 90)
    snow = ph(raw, "snow_field_aerial", "Diffuse")
    forest = ph(raw, "forest_ground_04", "Diffuse")
    shore = ph(raw, "river_small_rocks", "Diffuse")
    save_jpg(snow, hd / "snow.jpg", 256)
    save_jpg(forest, hd / "forest.jpg", 256)
    save_jpg(shore, hd / "shore.jpg", 256)
    atlas = cabin_atlas(raw)
    atlas.save(hd / "cabin-atlas.jpg", "JPEG", quality=84, optimize=True, subsampling=2)
    atlas.resize((256, 256), Image.LANCZOS).save(std / "cabin-atlas.jpg", "JPEG", quality=84, optimize=True, subsampling=2)
    boulder = ph(raw, "rock_moss_set_02", "Diffuse")
    save_jpg(boulder, hd / "boulder.jpg", 256)
    save_jpg(ph(raw, "rock_moss_set_02", "nor_gl"), hd / "boulder-nrm.jpg", 256, 90)
    hdr = raw / POLYHAVEN_HDRI / f"{POLYHAVEN_HDRI}_1k.hdr"
    subprocess.run([sys.executable, str(HDRI_TO_ENV), str(hdr), str(hd / "env-hd.jpg"), "--width", "256",
                    "--median", "0.05", "--knee", "0.6", "--quality", "86"], check=True)
    tints = {
        "rock": mean_rgb(rock), "snow": mean_rgb(snow), "forest": mean_rgb(forest), "shore": mean_rgb(shore),
        "planks": mean_rgb(atlas.crop((0, 0, 512, 320))), "slates": mean_rgb(atlas.crop((0, 320, 512, 480))),
        "boulder": mean_rgb(boulder), "fir": mean_rgb(ph(raw, "fir_sapling", "twigs_diff")),
    }
    (out / "tints.json").write_text(json.dumps(tints, indent=1, sort_keys=True) + "\n")
    print(f"prep -> {out}: {json.dumps(tints)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
