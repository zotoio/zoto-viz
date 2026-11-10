# Orrery assets

All six GLBs and the HD environment image are built by `blender/build_orrery.py` (Blender 5.2, run with the GUI visible) from
CC0 photo textures fetched and prepared by `blender/fetch_sources.py`, then compressed with
gltfpack 0.24 (`-cc -kn -km`: meshopt, named nodes and materials kept). No KTX2, no Draco.

```
python3 plugins/src/orrery/blender/fetch_sources.py
blender --gpu-backend vulkan --window-geometry 1400 0 1400 900 \
    --python plugins/src/orrery/blender/build_orrery.py -- --out plugins/src/orrery
```

The build rewrites `plugin.yml` `assets:` (sha256, bytes, triangles), `frontend/orrery-data.ts`
and `blender/build_orrery_meta.json` (per-GLB non-manifold / degenerate face counts, all 0).
Builds are byte-identical run to run.

`blender/mesh_integrity_check.py` re-imports the shipped GLBs (decoded first with
`gltfpack -noq`, since Blender's importer cannot read meshopt) and, after welding the glTF
seam splits, reports 0 loose vertices, wire edges, non-manifold edges, degenerate or sliver faces
across all six files, and checks every HD planet samples its own atlas cell. HD gears are
beauty-triangulated before export: the exporter's fan triangulation of the toothed faces made
needles that gltfpack's position grid flattened.

## Files

| asset | what | bytes | triangles |
| --- | --- | ---: | ---: |
| `orrery-study.glb` | walnut desk, leather blotter, books, banker's lamp, walnut plinth, contact shadow | 65 708 | 1 162 |
| `orrery-machine.glb` | brass base plate, zodiac ring, column, sun, gear train, escapement, arm templates | 76 700 | 6 940 |
| `orrery-planets.glb` | planet-0..6 unit-sphere templates (planet-6 carries its ring) | 56 316 | 4 464 |
| `orrery-study-hd.glb` | HD study: bevelled walnut desk and plinth, leather with a normal map, book pages | 221 496 | 2 586 |
| `orrery-machine-hd.glb` | HD machine: crossed-out wheels, perlage plate, hairspring, balance screws, 72-tick ring, all brass (blotter corners, plinth trim and feet, lamp base and arm) | 228 696 | 29 328 |
| `orrery-planets-hd.glb` | HD planets: 48x24 spheres sharing one 512 px atlas (seven planets + ring band), clear coat | 184 632 | 16 992 |
| `env-hd.jpg` | HD `role: environment` image: the *Fireplace* HDRI, tonemapped, 512 x 256 equirect | 31 546 | - |

Standard total 198 724 bytes; HD total 666 370 bytes (GLBs 634 824 + environment 31 546); plugin
total 865 094 bytes.

Texture memory once decoded (RGBA8 with mips; for the environment image the host keeps only its
PMREM, one 384 x 512 half-float target, and frees the equirect), checked by
`tests/test_orrery_pack.py` against the 8 MiB (8 388 608 B) `workBudget.maxGpuBytes`:

| set | textures | PMREM | total |
| --- | ---: | ---: | ---: |
| Standard | 3 407 866 | 0 | 3 407 866 |
| HD | 6 378 834 | 1 572 864 | 7 951 698 |

To fit HD, every texture is 256 or 512 px and each image ships once: the scanned roughness and
metal maps and the brass and walnut normals were near-constant, so their means became material
factors; the oxblood blotter and the green and navy books share one neutral leather scan tinted
by `baseColorFactor`; every brass part lives in the machine GLB so the brass map loads once.

## Standard vs HD

- **Standard**: 128-256 px colour maps only, gear outlines at 4 samples per tooth, solid wheels,
  12 zodiac ticks, brass at metalness 0.55 lit by the scene lights only.
- **HD**: 256-512 px colour maps plus leather and perlage normal maps, gear outlines at
  8 samples per tooth with crossed-out spokes (exact Mesh Boolean), perlage-finished plate and
  wheels, hairspring, balance-rim screws, 72 + 12 zodiac ticks, bevelled desk and plinth,
  clear-coated stone planets, full brass metalness, and `env-hd.jpg`: the Poly Haven *Fireplace*
  HDRI (tonemapped, 512 x 256), the pack's `role: environment` image that the host turns into
  the HD scene's image-based lighting.

## Sources (all CC0 1.0)

| source | author | URL | used for |
| --- | --- | --- | --- |
| Black Walnut Veneer 02 (`black_walnut_veneer_02`) | Jenelle van Heerden | https://polyhaven.com/a/black_walnut_veneer_02 | desk, plinth (darkened) |
| Leather Red 02 (`leather_red_02`) | Rob Tuytel | https://polyhaven.com/a/leather_red_02 | blotter, oxblood book; recoloured green / navy book covers (HD: one neutral scan, tinted, plus its normal map) |
| Aerial Rocks 02 (`aerial_rocks_02`) | Rob Tuytel | https://polyhaven.com/a/aerial_rocks_02 | planet-1 "terra" |
| Marble Cliff 02 (`marble_cliff_02`) | Amal Kumar | https://polyhaven.com/a/marble_cliff_02 | planet-2 "ares" |
| Snow Field Aerial (`snow_field_aerial`) | Rob Tuytel | https://polyhaven.com/a/snow_field_aerial | planet-5 "glacier" |
| Fireplace (`fireplace`, HDRI) | Greg Zaal | https://polyhaven.com/a/fireplace | HD environment image (`env-hd.jpg`); Blender preview lighting |
| Metal048B | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Metal048B | brass (gold scan re-tinted to brass, luminance kept); sun |
| Metal051A | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Metal051A | perlage normal on plate and wheels (HD) |
| Onyx010 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Onyx010 | planet-0 "jove" (banded) |
| Onyx013 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Onyx013 | planet-4 "nox" |
| Marble012 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Marble012 | planet-3 "luna"; recoloured green glass lamp shade |
| Travertine009 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Travertine009 | planet-6 "saturn"; book page edges |

Originals are downloaded to `out/sources/orrery/raw/` (gitignored) and are not committed; the
prepared maps live only inside the GLBs.
