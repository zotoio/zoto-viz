# Assets

## Third-party sources

| File | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `assets/env-hd.jpg` | [Ninomaru Teien](https://polyhaven.com/a/ninomaru_teien) (Poly Haven HDRI, 1k `.hdr`) | Greg Zaal | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | HD image-based lighting only (`role: environment`). Converted with `blender/hdri_to_env.py <in>.hdr assets/env-hd.jpg --width 1024` (median 0.18, knee 0.7, JPEG q86): 1024×512 sRGB equirect, 269 194 bytes. |

## Built in this repo

The meshes (`koi-pond-scape.glb`, `koi-*.glb`, `koi-*-hd.glb`, `lily-pads*.glb`, `pond-rocks*.glb`) are
built by the deterministic Blender scripts in `blender/` (`build_pond.py`, `upgrade_koi_hd.py`) from
procedural geometry, vertex colours and the noise-generated textures in `blender/textures/`. No
third-party licences apply to them.
