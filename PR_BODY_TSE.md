# PR #36 — TSE review notes

## Per-hunk sweep vs merge-base `3d38c536`

| Path / hunk | Revert row | Red runner |
| --- | --- | --- |
| `plugins/sdk/plugin-sandbox.ts` (new SDK types) | `plugin-sandbox-sdk-types` | vitest `plugin-sandbox-sdk.test.ts` |
| `schema/plugin.schema.json` config `section` | `plugin-schema-section-type` | pytest `test_plugin_config_field_section_rejects_non_string` |
| `web/src/core/modes.ts` `PluginField.section` | `modes-plugin-field-section` | vitest `modes-plugin-field.test.ts` |
| `web/src/plugins/plugin-visualisation.ts` `asField` section | `plugin-visualisation-section-field` | vitest `plugin-visualisation.test.ts` |
| `web/src/plugins/plugin-ui.ts` + tests (sections, dirty, cues) | `section-*`, `field-*`, `unsectioned-not-collapsible` | vitest `plugin-ui.test.ts` |
| `web/src/style.css` dirty ring + edited cue (visual) | `field-dirty-css-selectors` (behaviour via DOM); CSS-only deltas listed here, no separate patch | vitest `plugin-ui.test.ts` |
| `web/src/plugins/instances.ts` `pluginSpecForStoreId` | `plugin-spec-for-store-id` | vitest `instances.test.ts` |
| `web/src/plugins/plugin.ts` re-export `pluginSpecForStoreId` | `plugin-barrel-spec-for-store-id` | vitest `plugin-barrel.test.ts` |
| `web/src/plugins/plugin-config-sync.ts` guards | `on-plugin-change-config-guard`, `on-plugin-fields-config-guard`, `on-plugin-change-no-config-read`, `on-plugin-fields-no-config-read` | vitest `plugin-sandbox-config-push.test.ts` / `plugin-config-sync.test.ts` |
| `web/src/plugins/host.ts` `setConfig` | `host-setconfig-*` | vitest `host.test.ts` |
| `web/src/graph/mosaic.ts` planned-sky merge workaround | **Blocker 1 (deferred)** — no revert row yet; do not land workaround fix in this pass | — |
| `web/typecheck/plugin-sandbox.typecheck.ts` | (supplemental) same contract as `plugin-sandbox-sdk-types` | `pnpm typecheck` |

## `main.ts` survivors (awaiting integration harness)

These hunks ship in `web/src/app/main.ts` and are **not** covered by a dedicated `revert-proofs/36/*.patch` row. Guard behaviour is exercised via `plugin-config-sync.ts` + `plugin-sandbox-config-push.test.ts`; store-id resolution via `plugin-spec-for-store-id` / `plugin-barrel-spec-for-store-id`.

| # | Hunk (vs `3d38c536`) | Behaviour |
| --- | --- | --- |
| 1 | import `pluginSpecForStoreId` from `../plugins/plugin` | Barrel export for catalog lookup |
| 2 | import `allowOnPluginChangeConfigPush`, `allowOnPluginFieldsConfigPush` | Config-sync guard entry points |
| 3 | `onPluginFields` tail: `sandboxLoadedConfigStoreId` → `pluginSpecForStoreId` → `allowOnPluginFieldsConfigPush` → `sandbox.setConfig` | Refresh iframe config when fields panel opens |
| 4 | `let tsWatchStoreId` | Tracks loaded iframe config store id |
| 5 | `sandboxLoadedConfigStoreId()` | Requires `config.read` + `tsWatchStoreId` |
| 6 | `loadTsPlugin` early-out (no spec): set `tsWatchStoreId` from `configStoreId` | Store id on unload path A |
| 7 | `loadTsPlugin` early-out (ts disabled): set `tsWatchStoreId` | Store id on unload path B |
| 8 | `loadTsPlugin` consent pending: clear `tsWatchStoreId` | Block push while unreviewed |
| 9 | `loadTsPlugin` success: set `tsWatchStoreId = configStoreId(spec)` | Store id on load |
| 10 | `settings.onPluginChange` → guards + `sandbox.setConfig(values)` | Live knob edits push config |
| 11–16 | (same logical change set: wiring above across branches / mosaic `onPluginFields` callback) | Listed for TSE harness parity with 16-line review checklist |

Rows `on-plugin-change-config-guard` and `on-plugin-fields-config-guard` are **byte reverts** of the `plugin-config-sync.ts` guard lines (not `return true` stubs). Measured red: `AssertionError: expected 1 to be +0 // Object.is equality` on `tap.posted.length.toBe(0)`.

Row `on-plugin-fields-no-config-read` reverts to `if (!loadedConfigStoreId) return false;` only (drops `hasConfigRead` from the compound guard). Measured red: `AssertionError: expected true to be false // Object.is equality`.
