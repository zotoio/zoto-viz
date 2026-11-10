# Bonsai assets

The four GLBs are built by `blender/build_bonsai.py` (Blender 5.2, run with the GUI visible) from
CC0 scans and photo textures fetched and prepared by `blender/fetch_sources.py`, then compressed
with gltfpack 0.24 (`-cc -kn -km`: meshopt, named nodes and materials kept). No KTX2, no Draco.

```
.venv/bin/python plugins/src/bonsai/blender/fetch_sources.py
blender --gpu-backend vulkan --window-geometry 1400 0 1400 900 \
    --python plugins/src/bonsai/blender/build_bonsai.py -- --out plugins/src/bonsai
```

The build rewrites `plugin.yml` `assets:` (sha256, bytes, triangles), copies `assets/env-hd.jpg`,
and writes `frontend/bonsai-data.ts` (pad centres and radii, a ground height grid for falling
leaves, the camera) and `blender/build_bonsai_meta.json` (per-GLB non-manifold / degenerate face
counts for the solid meshes, all 0, and decoded texture bytes). Builds are byte-identical run to run.

How it is made:

- **Trunk, roots and branches**: a Python skeleton of chains (trunk, six surface roots, eight
  branches with secondaries, twigs into every pad) swept by geometry nodes (Mesh to Curve,
  Catmull-Rom resample, Set Curve Radius, Curve to Mesh) with the Poly Haven *Japanese Zelkova
  Bark* scan wrapped along the length; the trunk flares into the roots and caps are filled.
- **Leaf pads**: noise-deformed domes in three shells; Distribute Points on Faces (Poisson) +
  Instance on Points places small leaf cards cut from the Poly Haven *Periwinkle Plant* scan
  (real leaf alpha), aligned to the dome normal with twist and tilt. HD cards are 3 x 2 grids
  cupped and drooped. Each leaf carries COLOR_0 data, not colour: r = baked AO, g = its pad
  ((pad + 0.5) / 16), b = its density rank. The host scenery reads that to thin each pad with
  the active-talker density, turn leaves one by one to their autumn tile, and sway the pads.
- **Leaf atlas** (4 x 2 tiles): three green leaves, two petals for blossoms, and their autumn
  twins half the atlas to the right (yellow, red, orange). Autumn tiles keep the scanned leaves'
  luminance and veins, re-centred on an autumn hue; the frontend instances tint blossoms and
  falling leaves.
- **Slab**: the Poly Haven *Namaqualand Boulder 05* photogrammetry scan, decimated (2 400 tris
  Standard, 9 000 HD), flattened to a slab with its scan UVs and texture.
- **Moss**: a geometry-nodes carpet grown on the slab's upward faces around the trunk foot and in
  noise patches, lifted along the normal with the ambientCG *Moss002* map.
- **Board and bench**: an oval display board with feet in Poly Haven *Dark Wood*, on a bench of
  Poly Haven *Japanese Cedar Planks*; a soft contact-shadow card under the board.
- **AO**: 24 fixed cosine-weighted hemisphere rays per vertex against the slab, moss, board and
  tree (BVH ray casts in Python), baked into COLOR_0; deterministic.

## Files

| asset | what | bytes | triangles |
| --- | --- | ---: | ---: |
| `bonsai-base.glb` | bench, oval board, boulder slab, moss carpet, contact shadow | 98 072 | 3 202 |
| `bonsai-tree.glb` | trunk + roots + branches + twigs, 2 x 2 leaf cards on 12 pads, blossom and falling-leaf templates | 295 384 | 10 748 |
| `bonsai-base-hd.glb` | HD base: bevelled board and bench, 9 000-tri slab, subdivided moss, normal maps | 366 632 | 22 423 |
| `bonsai-tree-hd.glb` | HD tree: rounder sweeps, cupped 3 x 2 leaf cards in denser pads, 1024 px atlas, bark normal map | 774 444 | 27 816 |
| `env-hd.jpg` | `role: environment`: Poly Haven *Chinese Garden* (tonemapped, 512 x 256) for HD image-based lighting | 44 744 | — |

Standard total 393 456 bytes; HD total 1 185 820 bytes; plugin total 1 579 276 bytes.

Texture memory once decoded (RGBA8 with mips, `workBudget.maxGpuBytes` 8 388 608):
Standard 2 359 293 bytes; HD 8 257 532 bytes including the environment image (the host's PMREM
of it is renderer-owned).

## Standard vs HD

- **Standard**: 256 px colour maps (512 x 256 leaf atlas), 2 x 2 flat leaf cards, slimmer sweeps,
  scene lights only.
- **HD**: 512-1024 px colour maps, glTF normal maps on bark, slab and moss, cupped and drooped
  3 x 2 leaf cards at tighter spacing (4 568 leaves vs 3 335), bevelled board and bench,
  subdivided moss, and the garden HDRI as image-based lighting (host `role: environment`).

## Sources (all CC0 1.0)

| source | author | URL | used for |
| --- | --- | --- | --- |
| Japanese Zelkova Bark (`japanese_zelkova_bark`) | Charlotte Baglioni | https://polyhaven.com/a/japanese_zelkova_bark | trunk, roots, branches; normal map (HD) |
| Periwinkle Plant (`periwinkle_plant`) | Amal Kumar | https://polyhaven.com/a/periwinkle_plant | leaf and petal alpha cards (atlas) |
| Namaqualand Boulder 05 (`namaqualand_boulder_05`) | Dario Barresi, Jenelle van Heerden | https://polyhaven.com/a/namaqualand_boulder_05 | stone slab (scan mesh, colour, normal HD) |
| Dark Wood (`dark_wood`) | Dario Barresi, Dimitrios Savva, Rico Cilliers | https://polyhaven.com/a/dark_wood | display board |
| Japanese Cedar Planks (`japanese_cedar_planks`) | Charlotte Baglioni, Rico Cilliers | https://polyhaven.com/a/japanese_cedar_planks | bench |
| Chinese Garden (`chinese_garden`, HDRI) | Andreas Mischok | https://polyhaven.com/a/chinese_garden | `env-hd.jpg` HD lighting; Blender preview lighting |
| Moss002 | ambientCG (Lennart Demes) | https://ambientcg.com/view?id=Moss002 | moss carpet; normal map (HD) |

The sky (`sky/fragment.glsl`) is procedural: a soft-focus hedge, far canopy and still bokeh.
