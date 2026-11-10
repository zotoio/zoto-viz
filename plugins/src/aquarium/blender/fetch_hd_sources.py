"""Download the CC0 sources of the aquarium HD scan set (Poly Haven + ambientCG).

  python3 plugins/src/aquarium/blender/fetch_hd_sources.py out/sources/03-aquarium-hd-scans

Then `prep_hd_textures.py` bakes the textures and `build_scape_hd.py` (visible Blender) builds
`assets/aquarium-scape-hd.glb`. Downloads stay out of git; credits are in ../ASSETS.md.
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.request
import zipfile

UA = {"User-Agent": "zoto-viz-aquarium-hd"}

# Poly Haven glTF models (1k): grey angular stones (seiryu), crooked dry branches (driftwood), a
# pitted porous rock (reef live rock).
PH_MODELS = ["rock_moss_set_01", "dry_branches_medium_01", "moon_rock_01"]
# Poly Haven HDRI (1k .hdr): the room the tank stands in, for HD image-based lighting.
PH_HDRIS = ["lebombo"]
# ambientCG (1K-JPG zips): fine sand (fresh bed), rippled white sand (reef bed), grass blades
# (vallisneria), lanceolate leaves (java fern), small leaves (rotala), moss, a porous sponge
# (coral), reptile leather (fish scales, sea-fan lattice).
ACG = ["Ground080", "Ground093A", "Foliage001", "LeafSet022", "LeafSet013", "Moss002", "Sponge002", "Leather008"]


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
    dest = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "out/sources/03-aquarium-hd-scans")
    os.makedirs(dest, exist_ok=True)
    for a in PH_MODELS:
        polyhaven_model(dest, a)
    for a in PH_HDRIS:
        polyhaven_hdri(dest, a)
    for a in ACG:
        ambientcg(dest, a)


if __name__ == "__main__":
    main()
