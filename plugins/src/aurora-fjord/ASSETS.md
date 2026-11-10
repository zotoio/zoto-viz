# Aurora Fjord assets

All four GLBs and the HD environment image are built by `blender/build_fjord.py` (Blender 5.2,
run with the GUI visible) from CC0 Poly Haven scans fetched and prepared by
`blender/fetch_sources.py`, then compressed with gltfpack 0.24 (`-cc -kn -km`: meshopt, named
nodes and materials kept; the shore files add `-vp 16`, because 14-bit positions over the
1.25 km shore step about 7.5 cm and fold the roof trim and the boulder scans). No KTX2, no Draco.

```
.venv/bin/python plugins/src/aurora-fjord/blender/fetch_sources.py
blender --factory-startup --python plugins/src/aurora-fjord/blender/build_fjord.py -- --out plugins/src/aurora-fjord
```

The build rewrites `plugin.yml` `assets:` (sha256, bytes, triangles), `frontend/fjord-data.ts`
(camera, cabin and shore positions) and `blender/build_fjord_meta.json` (per-GLB loose /
non-manifold / degenerate counts, all 0). Builds are byte-identical run to run. The HD fir card is
rendered in Cycles by the build (`--rebuild-card` re-renders it; otherwise the cached render under
`out/sources/aurora-fjord/build/` is reused). `fetch_sources.py` converts the HDRI with koi-pond's
`blender/hdri_to_env.py` (a build-time script, not a runtime import).

`blender/mesh_integrity_check.py` re-imports the shipped GLBs (decoded first with
`gltfpack -noq`, since Blender's importer cannot read meshopt). After welding the glTF seam
splits it checks for loose vertices, wire edges, non-manifold edges, degenerate faces and
non-finite positions (all must be 0), that the named nodes are present, and that nothing but the
terrain's shore skirt and the boulders bedded in the shallows (at most 1.5 m) sits under the
water. The host discards everything below the waterline.

## Files

| asset | what | bytes | triangles |
| --- | --- | ---: | ---: |
| `fjord-terrain.glb` | fjord walls, cabin shelves and the peaks at the head as one heightfield cut at the waterline; photo-mean tints per vertex over one neutral rock detail map | 126 700 | 11 000 |
| `fjord-shore.glb` | 8 plank-and-slate cabins (256 px photo atlas), `cabin-window-0..7`, 380 two-tier cone pines tinted from the fir render, mossy boulders | 130 220 | 12 301 |
| `fjord-terrain-hd.glb` | HD heightfield at twice the resolution, rock / snow / forest-floor / shingle scans picked per face by height and slope, rock normal map | 466 192 | 31 999 |
| `fjord-shore-hd.glb` | HD shore: the same cabins with a 512 px atlas, 700 crossed fir cards rendered from the fir scan (alpha-clipped, bent normals), scanned boulders with a normal map | 371 456 | 18 777 |
| `env-hd.jpg` | HD `role: environment` image: the *Lakeside Night* HDRI, tonemapped, 256 x 128 equirect | 6 125 | - |

Standard total 256 920 bytes; HD total 843 773 bytes (GLBs 837 648 + environment 6 125); plugin
total 1 100 693 bytes.

The host scenery draws every lane mesh twice (the land and its reflection in the water):
Standard 46 602 and HD 101 552 triangles drawn, under the 120 000 `workBudget.maxTriangles`.

Texture memory once decoded (RGBA8 with mips; for the environment image the host keeps only its
PMREM, one 336 x 256 half-float target, and frees the equirect). `tests/test_aurora_fjord_pack.py`
checks it against the 8 MiB (8 388 608 B) `workBudget.maxGpuBytes`:

| set | textures | PMREM | total |
| --- | ---: | ---: | ---: |
| Standard | 699 050 | 0 | 699 050 |
| HD | 6 291 453 | 688 128 | 6 979 581 |

The reflection shares the lane's geometry and textures, so it adds no texture memory.

## Standard vs HD

- **Standard**: a 150 x 170 heightfield decimated to 11 000 triangles, coloured per vertex from
  the mean colours of the rock, snow, forest-floor and shingle photos over one 256 px neutral
  rock detail map. Cabins carry the plank / slate / trim atlas at 256 px; pines are two-tier
  cones; boulders are tinted. Lit by the scenery's moon, sky fill and aurora wash only.
- **HD**: a 300 x 340 heightfield (32 000 triangles) with four scanned ground materials chosen
  per face, a rock normal map, the 512 px cabin atlas, 700 fir impostor cards rendered from the
  Poly Haven fir scan (three crossed planes each, bent normals so they shade as a crown), the
  mossy boulder scan with its normal map, and `env-hd.jpg` as image-based light.

Neither set has a water mesh. The sky shader draws the open water and its mirror of the sky and
aurora; the host scenery adds the land's reflection, window streaks and ripples.

## Sources

| source | kind | used for | author(s) | licence |
| --- | --- | --- | --- | --- |
| [Aerial Rocks 02](https://polyhaven.com/a/aerial_rocks_02) (`aerial_rocks_02`) | texture | rock colour + normal (HD), neutral rock detail (Standard), rock tint | Rob Tuytel | CC0 1.0 |
| [Snow Field Aerial](https://polyhaven.com/a/snow_field_aerial) (`snow_field_aerial`) | texture | snow (HD), snow tint | Rob Tuytel | CC0 1.0 |
| [Forest Ground 04](https://polyhaven.com/a/forest_ground_04) (`forest_ground_04`) | texture | forest floor (HD), forest tint | Rico Cilliers, Rob Tuytel | CC0 1.0 |
| [River Small Rocks](https://polyhaven.com/a/river_small_rocks) (`river_small_rocks`) | texture | shore shingle (HD), shore tint | Rico Cilliers, Rob Tuytel | CC0 1.0 |
| [Weathered Plank Siding](https://polyhaven.com/a/weathered_plank_siding) (`weathered_plank_siding`) | texture | cabin walls and trim (atlas) | Dimitrios Savva | CC0 1.0 |
| [Roof Slates 02](https://polyhaven.com/a/roof_slates_02) (`roof_slates_02`) | texture | cabin roofs (atlas) | Rob Tuytel | CC0 1.0 |
| [Fir Sapling](https://polyhaven.com/a/fir_sapling) (`fir_sapling`) | model | rendered into the HD fir cards; Standard pine tint | Rico Cilliers, Rob Tuytel | CC0 1.0 |
| [Rock Moss Set 02](https://polyhaven.com/a/rock_moss_set_02) (`rock_moss_set_02`) | model | shore boulders (mesh, colour, normal) | Kless Gyzen | CC0 1.0 |
| [Lakeside Night](https://polyhaven.com/a/lakeside_night) (`lakeside_night`) | HDRI | `env-hd.jpg` | Greg Zaal, Jarod Guest | CC0 1.0 |

The fjord heightfield itself is procedural (`field()` in `build_fjord.py`: valley profile,
crags, peaks and shelves). It is painted only with the scans above, with no flat code colours.

## Data

Live Kp comes from the host's `noaa-kp` source (NOAA SWPC planetary K-index,
`services.swpc.noaa.gov/products/noaa-planetary-k-index.json`, US Government public domain; the
host polls it at most every 10 minutes and caches the last reading). The pack never fetches
anything itself. `frontend/fixtures/noaa-kp-headlines.json` is the host's projection of the
recorded SWPC response in `tests/fixtures/noaa-kp/`, used by the pack tests with no network.
