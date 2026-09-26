# Pack starter template

Copy this folder into `plugins/src/<id>/`, rename `plugin.yml` / `visualisation.yml` ids, and run pack lint — it must pass with no baseline entry.

CI exercises this template via `web/src/plugins/starter-pack-ci.test.ts` (temp copy, zip, compile, bundle, lint). Unit tests live in `web/src/plugins/starter-template.test.ts`.

- Type-only imports from `plugins/sdk/viz-contract` and `plugins/sdk/viz-pack-host`; cast `globalThis.zoto` to `VizPackZotoHost` (no inline `declare const zoto`).
- Config only via `onConfig`; never call `getConfig()` from `onFrame`.
- Tile pixel size: the host iframe does **not** expose mosaic tile dimensions today (`init` sends config + viz contract only). The starter uses `VIZ_PACK_TILE_FALLBACK` until a host field exists.
- HUD text is packed into buffer slot 0 for the sky corner chip (do not touch `parent.document` / `#viz-hud`).

<!-- TODO: settings scaffold with presets in plugin.yml, randomise/undo, and a host-derived "Custom" label suffix — needs per-instance defaults on the host. -->
