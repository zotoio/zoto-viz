# Revert rows — PR #130

Realism three packs + host mesh lane teardown, pack-asset stale cookie, GLB URL normalization.

| Row | Guard |
| --- | --- |
| `host-mesh-clear-no-dispose` | `HostMeshLane.clear()` disposes loaded templates (`createHostMeshBridge` → `mountPack`) |
| `host-mesh-clear-no-mixer-stop` | `clearAssetLive` stops skinned `AnimationMixer`s |
| `host-mesh-inflight-no-epoch` | Stale GLTF loads discarded after `clear()` (`loadEpoch`) |
| `host-mesh-clear-no-template-map-clear` | Second `clear()` is idempotent (`templates.clear()`) |
| `pack-asset-stale-cookie-fallback` | `pack_asset_session_ids` accepts live process CSRF without header |
| `host-mesh-strip-assets-prefix` | `assetUrl` strips `assets/` for monitor API paths |

Performance Pedant counts: `N_LOADED_MESHES=3`, `M_LIVE_MIXERS=2` in `host-mesh-lane.test.ts`.

Run all rows: `node scripts/revert-proof.mjs 130`
