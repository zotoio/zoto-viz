# Assets

The car and ball designs are original. They carry no real car brand, logo or league marking.

## Third-party sources (HD set only)

| File | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Orlando Stadium](https://polyhaven.com/a/orlando_stadium) (Poly Haven HDRI, 1k `.hdr`) | Dimitrios Savva (photography), Greg Zaal (processing) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | HD image-based lighting only (`role: environment`). Converted with `../koi-pond/blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 1024` (median 0.18, knee 0.7, JPEG q86): 1024×512 sRGB equirect, 104 105 bytes. |
| `assets/soccer-ball-hd.glb` | [Leather White](https://polyhaven.com/a/leather_white) (Poly Haven texture, 1k diffuse / GL normal / roughness) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Leather grain on every panel at its 300 mm scan scale. The albedo is tinted white (hexagons) or black (pentagons), and the grain normal is blended over the baked seams and stitches. |
| `assets/rocket-car-hd.glb`, `assets/rocket-car-blue-hd.glb` (carbon trim) | [Fabric 004](https://ambientcg.com/view?id=Fabric004) (ambientCG, 1K-JPG colour / GL normal / roughness) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | The photographed twill weave, contrast-lifted and cooled into a 256² carbon-fibre tile. It is box-projected onto the Standard `car_trim_carbon` faces (splitter, wing end plates) under a 0.9 clearcoat. |
| `assets/rocket-car-hd.glb`, `assets/rocket-car-blue-hd.glb` (tyres) | [Rubber 004](https://ambientcg.com/view?id=Rubber004) (ambientCG, 1K-JPG colour / displacement) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Rubber grain from the scan's displacement and colour, layered on the baked tread blocks, grooves and sidewall rings. |

## Built in this repo

The Standard meshes (`rocket-car.glb`, `rocket-car-blue.glb`, `soccer-ball.glb`) are original designer
GLBs with no third-party sources. They are unchanged by the HD set.

The HD set (`*-hd.glb`) is built from the Standard meshes and the CC0 sources above:

1. `python3 blender/fetch_hd_sources.py out/sources/05-rocket-car-hd` downloads the sources (kept out of git).
2. `blender --python blender/build_rocket_car_hd.py -- --out plugins/src/rocket-car-soccer --src out/sources/05-rocket-car-hd`
   runs in a visible Blender. For each car it:
   - re-imports the Standard GLB (decoded with `gltfpack -noq`), keeping every node name the drive articulates;
   - unwraps the paint, stripe and grille into one atlas;
   - bakes a panel-line normal (door, bonnet and deck shut lines, fuel-cap ring, hood pins) and the
     honeycomb grille, plus an ORM map (seam AO, paint / stripe / grille roughness and metal);
   - bakes the tread and sidewall normal along the Standard tyre profile;
   - wires the clearcoat paint (the coat normal follows the panel lines), carbon trim, tyres and
     machined metal rims.
   The ball is a new truncated-icosahedron mesh: 12 pentagons and 20 hexagons, pillowed panels with
   recessed seams and stitch rows. Pentagons and hexagons share one two-cell atlas.
3. The script exports with tangents, packs with gltfpack 0.24 (`-cc -kn -km`), re-imports each packed
   file to check mesh integrity, and writes `blender/build_rocket_car_hd_meta.json` (bytes, sha256,
   drawn triangles, image sizes, a decoded-texture GPU estimate).

Texture sizes are 512² or below (body normal 512², ORM and carbon 256², tyre 512×128, ball 512×256), so
the whole HD set decodes to about 8 MiB of textures, under half of the Standard set's ~17 MB.
