"""Download the CC0 sources of the Marble Run HD track (Poly Haven + ambientCG).

  python3 plugins/src/marble-run/blender/fetch_hd_sources.py out/sources/04-marble

Then `prep_hd_textures.py` bakes the tiling maps and `build_track_hd.py` (visible Blender)
builds `assets/marble-track-hd.glb`. Downloads stay out of git; credits are in ../ASSETS.md.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import zipfile

UA = {"User-Agent": "zoto-viz-marble-run-hd"}

# Poly Haven textures (1k): polished walnut planks (base board), oak veneer (posts, bars, back panel).
PH_TEXTURES = {
    "wood_table_001": ["Diffuse", "nor_gl", "Rough"],
    "oak_veneer_01": ["Diffuse", "nor_gl", "Rough"],
}
# Poly Haven HDRI (1k .hdr): a carpentry workshop for the HD image-based lighting.
PH_HDRIS = ["carpentry_shop_02"]
# ambientCG (1K-JPG zip): brushed steel, shared by the steel rails and (tinted) the brass fittings.
ACG = ["Metal009"]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


def polyhaven_texture(dest: str, asset: str, maps: list[str]) -> None:
    out = os.path.join(dest, asset)
    os.makedirs(out, exist_ok=True)
    info = json.loads(get(f"https://api.polyhaven.com/info/{asset}"))
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
    for m in maps:
        url = files[m]["1k"]["jpg"]["url"]
        with open(os.path.join(out, os.path.basename(url)), "wb") as f:
            f.write(get(url))
    json.dump(info, open(os.path.join(out, "info.json"), "w"), indent=1)
    print(asset, info["name"], sorted(info["authors"]))


def polyhaven_hdri(dest: str, asset: str) -> None:
    out = os.path.join(dest, asset)
    os.makedirs(out, exist_ok=True)
    info = json.loads(get(f"https://api.polyhaven.com/info/{asset}"))
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
    url = files["hdri"]["1k"]["hdr"]["url"]
    with open(os.path.join(out, os.path.basename(url)), "wb") as f:
        f.write(get(url))
    json.dump(info, open(os.path.join(out, "info.json"), "w"), indent=1)
    print(asset, info["name"], sorted(info["authors"]))


def ambientcg(dest: str, asset: str) -> None:
    out = os.path.join(dest, asset)
    os.makedirs(out, exist_ok=True)
    data = get(f"https://ambientcg.com/get?file={asset}_1K-JPG.zip")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for n in z.namelist():
            if n.endswith(".jpg"):
                z.extract(n, out)
    print(asset, "ambientCG", sorted(os.listdir(out)))


def main() -> None:
    dest = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/04-marble")
    os.makedirs(dest, exist_ok=True)
    for a, maps in PH_TEXTURES.items():
        polyhaven_texture(dest, a, maps)
    for a in PH_HDRIS:
        polyhaven_hdri(dest, a)
    for a in ACG:
        ambientcg(dest, a)


if __name__ == "__main__":
    main()
