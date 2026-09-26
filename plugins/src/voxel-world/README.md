# Voxel World

Stage-only **blocky voxel** landscape for zoto-viz. Terrain, textures, trees, water, clouds, and animals are **procedural** (generated in the GLSL sky shader and TypeScript director). No external images or trademarked names.

## View

Select **Voxel World** (`plugin:voxel-world`). The host golden LAN fixture keeps the board lit on a fresh install; the pack does not require live graph traffic.

## Presets

| Preset | Feel |
| --- | --- |
| Classic | Midday flyover, temperate hills |
| Snowy Peaks | Boreal snow, gentle walk |
| Desert | Arid sunset, sparse life |
| Night Torches | Orbit a hamlet with torch glow |
| Archipelago | Islands, rain, candy palette |
| Custom | Your sliders only |

Use **randomise**, **undo**, and **reset** on This view (next to arcade controls).

## Options

Seed, biome mix, view distance (16–48), time of day, day cycle speed, weather, camera mode (fly / walk / orbit village), camera speed, fog, texture style, mob count (0–6), clouds, and colour palette.

Reduced system motion (`prefers-reduced-motion`) slows camera paths automatically.

## Layout

```
plugin.yml
visualisation.yml
frontend/index.ts      # accent colours only; host writes buffers
frontend/world.ts      # camera, options, caps, presets
sky/fragment.glsl      # voxel ray march + sky
```

Hard caps: view distance 48, mobs 6, 96 ray steps, 8 chunk columns — safe on mosaic walls.
