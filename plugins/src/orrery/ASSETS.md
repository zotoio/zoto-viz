# Orrery assets

All six GLBs are built by `blender/build_orrery.py` (Blender 5.2, run with the GUI visible) from
CC0 photo textures fetched and prepared by `blender/fetch_sources.py`, then compressed with
gltfpack 0.24 (`-cc -kn -km`: meshopt, named nodes and materials kept). No KTX2, no Draco.

```
python3 plugins/src/orrery/blender/fetch_sources.py
blender --gpu-backend vulkan --window-geometry 1400 0 1400 900 \
    --python plugins/src/orrery/blender/build_orrery.py -- --out plugins/src/orrery
```

The build rewrites `plugin.yml` `assets:` (sha256, bytes, triangles), `frontend/orrery-data.ts`
and `blender/build_orrery_meta.json` (per-GLB non-manifold / degenerate face counts, all 0).
Re-imported into Blender, the only flagged faces are 132 near-zero-area slivers in
`orrery-machine-hd` (already present in the raw export, not introduced by gltfpack); the
boundary edges and duplicate vertices it reports are the glTF splits at UV and normal seams.
Builds are byte-identical run to run.

## Files

| asset | what | bytes | triangles |
| --- | --- | ---: | ---: |
| `orrery-study.glb` | walnut desk, leather blotter, books, banker's lamp, walnut plinth, contact shadow | 65 708 | 1 162 |
| `orrery-machine.glb` | brass base plate, zodiac ring, column, sun, gear train, escapement, arm templates | 76 700 | 6 940 |
| `orrery-planets.glb` | planet-0..6 unit-sphere templates (planet-6 carries its ring) | 56 316 | 4 464 |
| `orrery-study-hd.glb` | HD study: bevelled walnut, brass blotter corners and plinth trim, normal + roughness maps | 449 924 | 6 926 |
| `orrery-machine-hd.glb` | HD machine: crossed-out wheels, perlage plate, hairspring, balance screws, 72-tick ring, env probe | 279 684 | 25 000 |
| `orrery-planets-hd.glb` | HD planets: 48x24 spheres, 384 px maps, clear coat | 352 416 | 16 992 |

Standard total 198 724 bytes; HD total 1 082 024 bytes; plugin total 1 280 748 bytes.

Texture memory once decoded (RGBA8 with mips): Standard about 2.5 MB, inside the 8 MB
`workBudget.maxGpuBytes`. HD about 27 MB, over that cap: HD is the opt-in desktop set
(`modelSet: hd`), the same as the other packs' HD sets.

## Standard vs HD

- **Standard**: 128-256 px colour maps only, gear outlines at 4 samples per tooth, solid wheels,
  12 zodiac ticks, brass at metalness 0.55 lit by the scene lights only.
- **HD**: 512-1024 px colour maps plus normal and packed roughness/metal maps, gear outlines at
  8 samples per tooth with crossed-out spokes (exact Mesh Boolean), perlage-finished plate and
  wheels, hairspring, balance-rim screws, 72 + 12 zodiac ticks, bevelled desk and plinth,
  clear-coated stone planets, and `env-probe`: the Poly Haven *Fireplace* HDRI (tonemapped,
  512 x 256) that the host scenery turns into every material's reflection map.

## Sources (all CC0 1.0)

| source | author | URL | used for |
| --- | --- | --- | --- |
| Black Walnut Veneer 02 (`black_walnut_veneer_02`) | Jenelle van Heerden | https://polyhaven.com/a/black_walnut_veneer_02 | desk, plinth (darkened); normal + roughness (HD) |
| Leather Red 02 (`leather_red_02`) | Rob Tuytel | https://polyhaven.com/a/leather_red_02 | blotter, oxblood book; recoloured green / navy book covers |
| Aerial Rocks 02 (`aerial_rocks_02`) | Rob Tuytel | https://polyhaven.com/a/aerial_rocks_02 | planet-1 "terra" |
| Marble Cliff 02 (`marble_cliff_02`) | Amal Kumar | https://polyhaven.com/a/marble_cliff_02 | planet-2 "ares" |
| Snow Field Aerial (`snow_field_aerial`) | Rob Tuytel | https://polyhaven.com/a/snow_field_aerial | planet-5 "glacier" |
| Fireplace (`fireplace`, HDRI) | Greg Zaal | https://polyhaven.com/a/fireplace | HD study reflection probe; Blender preview lighting |
| Metal048B | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Metal048B | brass (gold scan re-tinted to brass, luminance kept); sun |
| Metal051A | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Metal051A | perlage normal + roughness on plate and wheels (HD) |
| Onyx010 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Onyx010 | planet-0 "jove" (banded) |
| Onyx013 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Onyx013 | planet-4 "nox" |
| Marble012 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Marble012 | planet-3 "luna"; recoloured green glass lamp shade |
| Travertine009 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Travertine009 | planet-6 "saturn"; book page edges |

Originals are downloaded to `out/sources/orrery/raw/` (gitignored) and are not committed; the
prepared maps live only inside the GLBs.
