# Assets

## Built in this repo (Standard)

`assets/aquarium-scape.glb` is built by the deterministic Blender script `blender/build_scape.py` from
procedural geometry and vertex colours (seeded noise, no image textures): the sand bed, the
freshwater and reef scapes, and one swim template per fish species. The water, glass, bubbles,
caustics and the room behind the tank are GLSL and TypeScript. No third-party licences apply to
the Standard set.

## Third-party sources (HD)

The HD model set (view setting `modelSet: hd`) adds `assets/aquarium-scape-hd.glb` and
`assets/env-hd.jpg`. Every source is CC0 1.0
([licence](https://creativecommons.org/publicdomain/zero/1.0/)); nothing is redistributed as
downloaded. Each source is resized, graded and baked into the maps listed.

| Used in | Source | Author | Licence | What it became |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Lebombo](https://polyhaven.com/a/lebombo) (Poly Haven HDRI, 1k `.hdr`) | Greg Zaal | CC0 1.0 | HD image-based lighting only (`role: environment`): a sunlit living room, the room the tank stands in. Converted with `blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 1024` (median 0.18, knee 0.7, JPEG q86): 1024×512 sRGB equirect, 41 597 bytes. |
| `fresh-rocks` | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) (Poly Haven photo-scanned model, 1k glTF) | Kless Gyzen | CC0 1.0 | The scanned stones, decimated (420–950 tris each), stood taller and angular as seiryu at the Standard anchors (the first is the fish territory rock). The scan's albedo is cooled to blue-grey (`stone_albedo` 512, `stone_normal` 256). |
| `fresh-driftwood` | [Dry Branches Medium 01](https://polyhaven.com/a/dry_branches_medium_01) (Poly Haven photo-scanned model, 1k glTF) | Rico Cilliers | CC0 1.0 | The long crooked branch on the Standard trunk line and the short one as its low limb, decimated (1 700 and 900 tris), thick end on the sand, thickened and arched like the Standard trunk. The scan's albedo is darkened and warmed to soaked driftwood (`wood_albedo` 512, `wood_normal` 256). Java fern roots are picked from the branch's upper faces. |
| `reef-rocks` | [Moon Rock 01](https://polyhaven.com/a/moon_rock_01) (Poly Haven photo-scanned model, 1k glTF, LOD0) | Rico Cilliers, Greg Zaal, Jenelle van Heerden, Dario Barresi | CC0 1.0 | A pitted, porous rock used as reef live rock: three decimated copies (1 300 tris), two stood on end. The albedo is the scan's colour × its AO, warmed to limestone, with coralline-algae blotches on the exposed faces (`liverock_albedo` 512, `liverock_normal` 256). |
| `substrate` | [Ground 080](https://ambientcg.com/view?id=Ground080) (ambientCG, 1K-JPG colour / AO / normal) | ambientCG | CC0 1.0 | The freshwater sand bed: colour × AO, made tileable (`sand_albedo` 512, `sand_normal` 256). |
| `reef-sand` | [Ground 093 A](https://ambientcg.com/view?id=Ground093A) (ambientCG, 1K-JPG colour / AO / normal) | ambientCG | CC0 1.0 | Rippled pale aragonite sand laid just above the bed in the reef tank (`reefsand_albedo` 512, `reefsand_normal` 256). |
| `fresh-plant-vallisneria` | [Foliage 001](https://ambientcg.com/view?id=Foliage001) (ambientCG, 1K-JPG colour / opacity / displacement) | ambientCG | CC0 1.0 | Eight photographed grass blades, each cut out and straightened into a strip of the plant atlas (`plants_albedo` 1024×512, `plants_normal` 512×256). Every ribbon card follows its blade's measured outline, so no alpha is needed. |
| `fresh-plant-fern` | [Leaf Set 013](https://ambientcg.com/view?id=LeafSet013) (ambientCG, 1K-JPG colour / opacity / displacement) | ambientCG | CC0 1.0 | Two photographed leaves in the plant atlas, used as java fern fronds with their own outlines. |
| `fresh-plant-rotala` | [Leaf Set 022](https://ambientcg.com/view?id=LeafSet022) (ambientCG, 1K-JPG colour / opacity / displacement) | ambientCG | CC0 1.0 | Four photographed small leaves in the plant atlas, used as rotala leaf pairs (vertex-tinted copper-red toward the crown). |
| `fresh-plant-moss` | [Moss 002](https://ambientcg.com/view?id=Moss002) (ambientCG, 1K-JPG colour / AO / normal) | ambientCG | CC0 1.0 | Moss mounds (`moss_albedo`, `moss_normal` 256). |
| `reef-coral-staghorn`, `reef-coral-brain`, `reef-anemone` | [Sponge 002](https://ambientcg.com/view?id=Sponge002) (ambientCG, 1K-JPG colour / AO / normal) | ambientCG | CC0 1.0 | Porous coral surface, luminance only (`coral_albedo`, `coral_normal` 256). Each coral's colour comes from its vertex tint. |
| `reef-coral-fan`, fish | [Leather 008](https://ambientcg.com/view?id=Leather008) (ambientCG, 1K-JPG colour / displacement) | ambientCG | CC0 1.0 | The leather's cell seams, thresholded from its displacement, give the gorgonian sea-fan lattice (`fan_lattice.png` 256, alpha mask). Its cells also give the fish-scale relief (albedo detail, and a normal derived from the displacement) that is baked into the fish atlases. |

### Fish

The HD fish keep the Standard swim templates exactly: the same geometry, node names
(`fish-<species>`, `<species>-body|-fins|-eyes`), identity transforms and float positions, so
the host's swim bend, fin motion and instancing are unchanged. Each species gets a side-view tile
in a 1024×512 albedo atlas and a 512×256 normal atlas. Each tile is baked from that species'
Standard colour pattern multiplied by the Leather 008 scale relief. The fins sample the same
tile, and the eyes stay vertex-coloured.

## Build (HD)

1. `python3 blender/fetch_hd_sources.py out/sources/03-aquarium-hd-scans` downloads the sources
   (kept out of git).
2. `python3 blender/prep_hd_textures.py out/sources/03-aquarium-hd-scans` bakes them
   (deterministic, PIL + numpy) into ≤ 1k JPEG/PNG maps plus `plant_profiles.json` under
   `<sources>/baked/`.
3. `blender --factory-startup --python blender/build_scape_hd.py -- --out plugins/src/aquarium --src out/sources/03-aquarium-hd-scans`
   (a visible Blender) builds the scape. It ray-casts AO into the vertex colours of the beds,
   stone, wood and live rock, then bakes the fish atlases and exports. It packs the GLB with
   gltfpack 0.24 (`-cc -kn -km -vpf`; positions stay float because the host's sway and swim
   shaders read local units), re-imports the packed file to check it, and writes
   `blender/build_scape_hd_meta.json` (bytes, sha256, triangles, per-part triangles, checks).
