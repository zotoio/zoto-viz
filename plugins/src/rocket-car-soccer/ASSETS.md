# Assets

The car and ball designs are original. They carry no real car brand, logo or league marking.

## Third-party sources (HD set only)

| File | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Orlando Stadium](https://polyhaven.com/a/orlando_stadium) (Poly Haven HDRI, 1k `.hdr`) | Dimitrios Savva (photography), Greg Zaal (processing) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | HD image-based lighting only (`role: environment`). Converted with `../koi-pond/blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 512` (median 0.18, knee 0.7, JPEG q86): 512×256 sRGB equirect, 26 120 bytes. |
| `assets/soccer-ball-hd.glb` | [Leather White](https://polyhaven.com/a/leather_white) (Poly Haven texture, 1k diffuse / GL normal / roughness) | Rob Tuytel | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Leather grain normal and roughness on every panel at its 300 mm scan scale, blended over the baked seams and stitches. The colour is untextured: white hexagons and black pentagons are two materials. |
| `assets/rocket-car-hd.glb`, `assets/rocket-car-blue-hd.glb` (carbon trim) | [Fabric 004](https://ambientcg.com/view?id=Fabric004) (ambientCG, 1K-JPG colour / GL normal / roughness) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | The photographed twill weave, contrast-lifted and cooled into a 128² carbon-fibre tile. It is box-projected onto the Standard `car_trim_carbon` faces (splitter, wing end plates) under a 0.9 clearcoat. |
| `assets/rocket-car-hd.glb`, `assets/rocket-car-blue-hd.glb` (tyres) | [Rubber 004](https://ambientcg.com/view?id=Rubber004) (ambientCG, 1K-JPG colour / displacement) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Rubber grain from the scan's displacement and colour, layered on the baked tread blocks, grooves and sidewall rings. |

## Built in this repo

The Standard meshes (`rocket-car.glb`, `rocket-car-blue.glb`, `soccer-ball.glb`) are original designer
GLBs with no third-party sources. They are unchanged by the HD set.

The HD set (`*-hd.glb`) is built from the Standard meshes and the CC0 sources above:

1. `python3 blender/fetch_hd_sources.py out/sources/05-rocket-car-hd` downloads the sources (kept out of git).
2. `blender --python blender/build_rocket_car_hd.py -- --out plugins/src/rocket-car-soccer --src out/sources/05-rocket-car-hd`
   runs in a visible Blender. For each car it:
   - re-imports the Standard GLB (decoded with `gltfpack -noq`), keeping every node name the drive articulates;
   - unwraps the paint, stripe and grille into one atlas (undersides packed at 0.3 scale);
   - bakes the livery in object space, so it runs across UV seams: team colour over a graphite lower
     body with a white pinline, twin white roof-to-tail stripes with dark pinlines, and a white door
     panel carrying a plain race number (orange 7, blue 4);
   - bakes a panel-line normal (door, bonnet and deck shut lines, fuel-cap ring, hood pins) and the
     honeycomb grille, plus an ORM map (seam AO, paint / stripe / white / graphite roughness and metal);
   - raycasts thin emissive light strips onto the chassis (a side-skirt run each side and two tail
     bars) as a separate `light_strips` child of `chassis`, in the team colour;
   - bakes the tread and sidewall normal along the Standard tyre profile;
   - wires the clearcoat paint (the coat normal follows the panel lines), carbon trim, tyres,
     polished metal rims, and glowing hubs, calipers, headlights and tail-lights.
   The ball is a new truncated-icosahedron mesh: 12 pentagons and 20 hexagons, pillowed panels with
   deep recessed seams and stitch rows. Hexagons are white and pentagons black (two materials sharing
   one normal and ORM atlas); a `COLOR_0` vertex ramp darkens each panel toward its seam.
3. The script exports with tangents, packs with gltfpack 0.24 (`-cc -kn -km`), re-imports each packed
   file to check mesh integrity, and writes `blender/build_rocket_car_hd_meta.json` (bytes, sha256,
   drawn triangles, image sizes, and the GPU estimate below).

Texture sizes are 512² or below (body livery 512², body normal and ORM 256², carbon 128², tyre normal
512×128, ball normal 512×256 and ORM 256×128). Decoded with mips, the three GLBs take 6 815 736 bytes;
the `env-hd` PMREM adds 1 572 864, for 8 388 600 bytes against the 8 388 608 `maxGpuBytes` ceiling. The
Standard set is about 17 MB.
