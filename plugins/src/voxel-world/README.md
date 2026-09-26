# Voxel World

Blocky procedural voxel terrain on the **plugin sky**. Greedy-meshed chunks (hidden-face removal, one atlas, one draw call per chunk) run in the sandbox iframe for GPU accounting; the visible stage is ray-marched in `sky/fragment.glsl` from host UBO slots written each frame.

All options, caps, presets, and **live-data bindings** are in `plugin.yml` and read only through **config.read** (`zoto.getConfig` / `onConfig`).

## Live data bindings (plugin.yml)

| Config key | Source (VizDataFrame) | Effect |
| --- | --- | --- |
| `bind_sysLoad_weather` | `sys.cpu` (0–1) | Scales rain/snow mix |
| `bind_packetField_torch` | new `packets[]` samples | Spawns torch glow when `field` exceeds threshold |
| `bind_sysFailed_failTint` | `sys.failed` (0–1) | Zoto fail red tint ahead of spectacle |

Idle uses `viz.idle.fixture: host` — metric shows **demo** on the OSD when `frame.demo` is set.

## Caps (plugin.yml config, fixed)

- `cap_maxChunks`: 8  
- `cap_maxViewDist`: 48  
- `cap_maxVertexBudget`: 65536  
- `cap_chunksPerFrame`: 2  

## Mosaic layout (screenshots on `main`)

View dropdown may black-tile until a host CSP fix lands; place the pack via saved anim:

**2×2 wall — one tile**

```json
{
  "anim": {
    "mosaic": "4",
    "mosaicTiles": ["plugin:voxel-world", "plugin:topology", "plugin:memory", "plugin:disk"]
  }
}
```

**4×4 wall — one tile**

```json
{
  "anim": {
    "mosaic": "8",
    "mosaicTiles": [
      "plugin:voxel-world", "plugin:topology", "plugin:memory", "plugin:disk",
      "plugin:cores", "plugin:gpu", "plugin:sockets", "plugin:watch"
    ]
  }
}
```

Persist under your zoto-viz profile or patch via MCP `set_settings` with the same `anim` fields.

## Consent

TypeScript frontend + GLSL sky require plugin consent (`consent_plugin` or Settings → auto-consent for shipped src).

## Screenshot pins

| Shot | Preset | Seed |
| --- | --- | --- |
| Classic | classic | 4242 |
| Snowy | snowy | 9001 |
| Desert | desert | 1337 |
| Night | night | 2048 |
| Archipelago | archipelago | 7777 |

Camera uses **frame time `t` only** (deterministic).

## Tests

```bash
./zoto-viz plugin validate plugins/src/voxel-world/
pytest tests/test_voxel_world_pack.py
cd web && pnpm exec vitest run --config ../plugins/src/voxel-world/vitest.config.mts
```

## Host API note

On-screen HUD for pack/skip/metric is drawn in the sky shader from UBO slots (no per-pack host branches). A future versioned host hook could expose skip counts directly to `ui.overlay`.
