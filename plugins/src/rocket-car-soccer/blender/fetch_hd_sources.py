"""Download the CC0 sources of the rocket-car-soccer HD set (Poly Haven + ambientCG).

  python3 plugins/src/rocket-car-soccer/blender/fetch_hd_sources.py out/sources/05-rocket-car-hd

Then `build_rocket_car_hd.py` (visible Blender) bakes the maps and builds the `-hd` GLBs, and
`../../koi-pond/blender/hdri_to_env.py` turns the stadium HDRI into `assets/env-hd.jpg`.
Downloads stay out of git; credits are in ../ASSETS.md.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import zipfile

UA = {"User-Agent": "zoto-viz-rocket-car-hd"}

# Poly Haven textures (1k): white leather grain for the ball panels.
PH_TEXTURES = {"leather_white": ["Diffuse", "nor_gl", "Rough"]}
# Poly Haven HDRI (1k .hdr): a sunlit football stadium for the HD environment image.
PH_HDRIS = ["orlando_stadium"]
# ambientCG (1K-JPG zips): carbon-fibre weave (trim) and rubber (tyres).
ACG = ["Fabric004", "Rubber004"]


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
    dest = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/05-rocket-car-hd")
    os.makedirs(dest, exist_ok=True)
    for a, maps in PH_TEXTURES.items():
        polyhaven_texture(dest, a, maps)
    for a in PH_HDRIS:
        polyhaven_hdri(dest, a)
    for a in ACG:
        ambientcg(dest, a)


if __name__ == "__main__":
    main()
