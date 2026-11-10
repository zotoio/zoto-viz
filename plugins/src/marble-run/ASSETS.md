# Assets

## Third-party sources

| File | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Carpentry Shop 02](https://polyhaven.com/a/carpentry_shop_02) (Poly Haven HDRI, 1k `.hdr`) | Greg Zaal | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | HD image-based lighting only (`role: environment`); the glass marbles, rails and brass reflect it. Converted with `../koi-pond/blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 512`: 512×256 sRGB equirect, 50 352 bytes. |
| `assets/marble-track-hd.glb` (`base`) | [Wood Table 001](https://polyhaven.com/a/wood_table_001) (Poly Haven texture, 1k diffuse / GL normal / roughness) | Dimitrios Savva (photography), Rico Cilliers (processing) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Re-laid as eight oiled walnut planks with staggered butt joints (`walnut_albedo`, `walnut_normal`, `walnut_mr`). Each plank samples the photo at native density with its own offset and tone. |
| `assets/marble-track-hd.glb` (`pegboard`, `posts`, `stands`) | [Oak Veneer 01](https://polyhaven.com/a/oak_veneer_01) (Poly Haven texture, 1k diffuse) | Jenelle van Heerden | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `oak_albedo`: oak dowels and stands, and a darker stained back panel. |
| `assets/marble-track-hd.glb` (`rails`, `lift-rod`, `ties`, `lift-thread`, `funnel-rim`, `bell`, `xylo-bar-*`) | [Metal 009](https://ambientcg.com/view?id=Metal009) (ambientCG, 1K-JPG colour / roughness) | ambientCG | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Brushed-metal grain (`metal_albedo`, `metal_mr`). It is tinted cool for the steel rails and rod, warm for the brass, and in the Standard bar colours for the clear-coated xylophone bars. |

## Built in this repo

`marble-track.glb` (Standard) and `frontend/track-data.ts` (the marble centre path) are built by
`blender/build_track.py` from procedural geometry and flat colours. No third-party licences apply.
The HD set leaves both byte-identical.

`marble-track-hd.glb` (HD) is the same track with the same node names, bounds (within the bevels)
and path, built from the CC0 sources above:

1. `blender/fetch_hd_sources.py out/sources/04-marble` downloads the sources (kept out of git).
2. `blender/prep_hd_textures.py out/sources/04-marble` bakes them into JPEG maps under `<sources>/baked/`.
3. `blender/build_track_hd.py -- --out . --src out/sources/04-marble` (visible Blender) runs
   `build_track.py` unchanged. It aborts unless the rebuilt `track-data.ts` matches the shipped one.
   It then UV-unwraps every part (rails along their arc length), bevels the base, panel, posts,
   stands and bars, assigns the PBR materials, and exports. The export is packed with gltfpack 0.24
   (`-cc -kn -km -ke`), re-imported to check it, and recorded in `blender/build_track_hd_meta.json`
   (bytes, sha256, triangles, GPU bytes).
4. `blender/check_track_hd.py` (visible Blender) imports both packed GLBs and checks the HD set is
   the same track: per-part bounds, UVs on textured parts, no NaN vertices.

### Why 512 maps, not 1k

The pack's `maxGpuBytes` (8 MiB) covers decoded textures (RGBA8 + mips) plus the HD environment's
PMREM. A single 1k map decodes to 5.6 MB, so the HD set uses four 512² maps and two 256² maps
(6.29 MB) and a 512-wide environment (1.57 MB PMREM): 7.86 MB in total. The planks tile the 512
map at the photo's native density, so the board keeps 1k-level grain.
