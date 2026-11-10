# Assets

## Third-party sources

| File | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Ninomaru Teien](https://polyhaven.com/a/ninomaru_teien) (Poly Haven HDRI, 1k `.hdr`) | Greg Zaal | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | HD image-based lighting only (`role: environment`). Converted with `blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 1024` (median 0.18, knee 0.7, JPEG q86): 1024×512 sRGB equirect, 269 194 bytes. |
| `assets/pond-rocks-hd.glb` | [Rock Moss Set 02](https://polyhaven.com/a/rock_moss_set_02) (Poly Haven photo-scanned model, 1k glTF) | Kless Gyzen | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | The seven scanned rocks, decimated and placed at the Standard accent-rock, bank-clump and fountain anchors (`pond-rocks`, `bank-stones`, `fountain`). One 1k albedo + 1k normal + 512 roughness atlas from the scan's own maps; a vertex tint darkens stone below the waterline. |
| `assets/koi-pond-scape-hd.glb` | [Ganges River Pebbles](https://polyhaven.com/a/ganges_river_pebbles) (Poly Haven texture, 1k diffuse / GL normal / roughness) | Amal Kumar | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | The pond bed (`substrate`), on the Standard bed's shoreline. Albedo wet-darkened; normal and roughness resized from the scan maps. |
| `assets/lily-pads-hd.glb` (pads) | [Leaf 001](https://ambientcg.com/view?id=Leaf001) (ambientCG, 1K-JPG colour / opacity / displacement / roughness) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Polar-warped into a round pad with radial veins (`pad_albedo`, `pad_normal` from the leaf displacement, `pad_mr`). Notched, rim-curled pads at the Standard lily anchors. |
| `assets/lily-pads-hd.glb` (lotus) | [Flower Set 001](https://ambientcg.com/view?id=FlowerSet001) (ambientCG, 1K-JPG colour / opacity) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Petal grain (high-pass of a photographed petal) tinted pink / white, the daisy disc as the stamen ring and receptacle; `petal_normal` from the grain. |

## Built in this repo

The Standard meshes (`koi-pond-scape.glb`, `koi-*.glb`, `lily-pads.glb`, `pond-rocks.glb`) are built by
the deterministic Blender scripts in `blender/` (`build_pond.py`, `upgrade_koi_hd.py`) from procedural
geometry, vertex colours and the noise-generated textures in `blender/textures/`. No third-party
licences apply to them.

The HD set (`*-hd.glb`) is built from the CC0 sources above:

1. `blender/fetch_hd_sources.py out/sources/02-koi-hd-scans` downloads the sources (kept out of git).
2. `blender/prep_hd_textures.py` bakes them into 1k (or smaller) JPEG/PNG maps under `<sources>/baked/`.
3. `blender/build_koi_hd_scans.py` (visible Blender) builds the GLBs, packs them with gltfpack 0.24
   (`-cc -kn -km`), re-imports each packed file to check it, and writes
   `blender/build_koi_hd_scans_meta.json` (bytes, sha256, triangles).

The HD koi (`koi-*-hd.glb`) keep the Standard koi mesh, rig and `swim` clip; their maps are re-baked
from the Standard koi textures (stronger scale normal, scale-edge albedo, glossier roughness, ray-
thinned translucent fins) and the body gains a clearcoat. There is no CC0 koi photo source among the
allowed libraries, so no third-party licence applies to them either.
