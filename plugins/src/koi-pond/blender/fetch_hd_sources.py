"""Download the CC0 sources of the koi-pond HD scan set (Poly Haven + ambientCG).

  python3 plugins/src/koi-pond/blender/fetch_hd_sources.py out/sources/02-koi-hd-scans

Then `prep_hd_textures.py` bakes the 1k textures and `build_koi_hd_scans.py` (visible Blender)
builds the `-hd` GLBs. Downloads stay out of git; credits are in ../ASSETS.md.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import zipfile

UA = {"User-Agent": "zoto-viz-koi-pond-hd"}

# Poly Haven glTF models (1k): photo-scanned mossy rocks for the accent rocks, bank and fountain.
PH_MODELS = ["rock_moss_set_02"]
# Poly Haven textures (1k): wet river pebbles for the pond bed and shore.
PH_TEXTURES = {"ganges_river_pebbles": ["Diffuse", "nor_gl", "Rough"]}
# ambientCG (1K-JPG zips): a photographed leaf (pad veins) and daisies (petal grain, stamen disc).
ACG = ["Leaf001", "FlowerSet001"]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()


def polyhaven_model(dest: str, asset: str) -> None:
    out = os.path.join(dest, asset)
    os.makedirs(out, exist_ok=True)
    info = json.loads(get(f"https://api.polyhaven.com/info/{asset}"))
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset}"))
    gltf = files["gltf"]["1k"]["gltf"]
    with open(os.path.join(out, os.path.basename(gltf["url"])), "wb") as f:
        f.write(get(gltf["url"]))
    for rel, inc in gltf.get("include", {}).items():
        p = os.path.join(out, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(get(inc["url"]))
    json.dump(info, open(os.path.join(out, "info.json"), "w"), indent=1)
    print(asset, info["name"], sorted(info["authors"]))


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
    dest = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/02-koi-hd-scans")
    os.makedirs(dest, exist_ok=True)
    for a in PH_MODELS:
        polyhaven_model(dest, a)
    for a, maps in PH_TEXTURES.items():
        polyhaven_texture(dest, a, maps)
    for a in ACG:
        ambientcg(dest, a)


if __name__ == "__main__":
    main()
