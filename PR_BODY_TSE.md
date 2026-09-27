# PR #36 — TSE review notes

Merge-base for sweep: `3d38c536`. Product diff: **43 hunks** (`git diff 3d38c536..HEAD -U0`, excluding `revert-proofs/` and `PR_BODY*`).

Companion vitest-only new-file hunks **h16, h25, h26, h28, h29, h39** are omitted from the numbered table (same revert row as their product hunk). Table **h1–h37** maps the remaining hunks in order.

## Per-hunk sweep (h1–h37)

| ID | Hunk | File | Caught by row / test | Notes |
| --- | --- | --- | --- | --- |
| h1 | h01 | `plugins/sdk/plugin-sandbox.ts` | `plugin-sandbox-sdk-types` | vitest `plugin-sandbox-sdk.test.ts`; inverse applies |
| h2 | h02 | `schema/plugin.schema.json` | `plugin-schema-section-type` | pytest `test_plugin_config_field_section_rejects_non_string` |
| h3 | h03 | `schema/plugin.schema.json` | `plugin-schema-section-type` | schema description delta (same row) |
| h4 | h04 | `schema/plugin.schema.json` | `plugin-schema-section-type` | `pluginConfigList` / `pluginConfigField` defs |
| h5 | h05 | `tests/test_plugin_schema.py` | `plugin-schema-section-type` | pytest section validate/reject |
| h6 | h06 | `web/src/app/main.ts` | **Survivor** | import `pluginSpecForStoreId`; awaiting TSE harness |
| h7 | h07 | `web/src/app/main.ts` | **Survivor** | import config-sync guards |
| h8 | h08 | `web/src/app/main.ts` | **Survivor** | `onPluginFields` → guards + `setConfig` |
| h9 | h09 | `web/src/app/main.ts` | **Survivor** | `tsWatchStoreId` |
| h10 | h10 | `web/src/app/main.ts` | **Survivor** | `sandboxLoadedConfigStoreId()` |
| h11 | h11 | `web/src/app/main.ts` | **Survivor** | `loadTsPlugin` store id (path A) |
| h12 | h12 | `web/src/app/main.ts` | **Survivor** | `loadTsPlugin` store id (path B) |
| h13 | h13 | `web/src/app/main.ts` | **Survivor** | consent pending clears store id |
| h14 | h14 | `web/src/app/main.ts` | **Survivor** | load success sets store id |
| h15 | h15 | `web/src/app/main.ts` | **Survivor** | `settings.onPluginChange` guards + push |
| h16 | h17 | `web/src/core/modes.ts` | `modes-plugin-field-section` | vitest `modes-plugin-field.test.ts` (h16 = test file) |
| h17 | h18 | `web/src/graph/mosaic.ts` | **Survivor** | Blocker 1 deferred (planned-sky merge) |
| h18 | h19 | `web/src/graph/mosaic.ts` | **Survivor** | Blocker 1 deferred |
| h19 | h20 | `web/src/plugins/host.test.ts` | `host-setconfig-*` | vitest `host.test.ts` |
| h20 | h21 | `web/src/plugins/host.ts` | `host-setconfig-posts`, `host-setconfig-no-config-read`, `host-setconfig-empty-payload` | |
| h21 | h22 | `web/src/plugins/instances.test.ts` | `plugin-spec-for-store-id` | import block |
| h22 | h23 | `web/src/plugins/instances.test.ts` | `plugin-spec-for-store-id` | catalog tree case |
| h23 | h24 | `web/src/plugins/instances.ts` | `plugin-spec-for-store-id` | `pluginSpecForStoreId` |
| h24 | h27 | `web/src/plugins/plugin-config-sync.ts` | `on-plugin-change-config-guard`, `on-plugin-fields-config-guard`, `on-plugin-change-no-config-read`, `on-plugin-fields-no-config-read` | byte-revert patches; h26/h28 = tests |
| h25 | h30 | `web/src/plugins/plugin-ui.test.ts` | `field-*`, `section-*`, `unsectioned-not-collapsible` | h31–h32 continue same file |
| h26 | h31 | `web/src/plugins/plugin-ui.test.ts` | `field-*`, `section-*` | import/setup |
| h27 | h32 | `web/src/plugins/plugin-ui.test.ts` | `field-*`, `section-*` | `fillPluginFields` cases |
| h28 | h33 | `web/src/plugins/plugin-ui.ts` | `section-*`, `field-*` | section helpers |
| h29 | h34 | `web/src/plugins/plugin-ui.ts` | `field-*` | `fillPluginFields` signature |
| h30 | h35 | `web/src/plugins/plugin-ui.ts` | `section-*`, `unsectioned-not-collapsible` | collapsible sections |
| h31 | h36 | `web/src/plugins/plugin-ui.ts` | `field-*` | control wiring |
| h32 | h37 | `web/src/plugins/plugin-ui.ts` | `field-edited-label-string`, `field-unsaved-change-aria` | edited markers |
| h33 | h38 | `web/src/plugins/plugin-ui.ts` | `field-dirty-*` | dirty sync hooks |
| h34 | h40 | `web/src/plugins/plugin-visualisation.ts` | `plugin-visualisation-section-field` | h39 = test file |
| h35 | h41 | `web/src/plugins/plugin.ts` | `plugin-barrel-spec-for-store-id` | re-export `pluginSpecForStoreId` |
| h36 | h42 | `web/src/style.css` | **Survivor (visual-only)** | `field-dirty-css-selectors` exercises DOM; CSS ring is visual |
| h37 | h43 | `web/typecheck/plugin-sandbox.typecheck.ts` | `plugin-sandbox-sdk-types` | supplemental `pnpm typecheck` |

**Omitted companion hunks (covered by row above):** h16 `modes-plugin-field.test.ts`, h25 `plugin-barrel.test.ts`, h26 `plugin-config-sync.test.ts`, h28 `plugin-sandbox-config-push.test.ts`, h29 `plugin-sandbox-sdk.test.ts`, h39 `plugin-visualisation.test.ts`.

### Survivors (no dedicated revert patch)

| Hunks | Reason |
| --- | --- |
| h06–h15 (`main.ts`, 10 hunks) | Wiring for config push; guards covered by `plugin-config-sync.ts` + `plugin-sandbox-config-push.test.ts`; full `main.ts` harness deferred |
| h18–h19 (`mosaic.ts`) | Blocker 1 — planned-sky merge workaround; no revert row this pass |
| h42 (`style.css`) | Visual-only dirty ring; behaviour via `field-dirty-css-selectors` + `plugin-ui.test.ts` |

Inverse-apply check: product hunks with revert rows fail single-hunk reverse when the hunk is partial or new-file; survivors above are intentional.

## Guard byte-reverts (measured red)

`on-plugin-change-config-guard` and `on-plugin-fields-config-guard` are **single-line** inverses of the store-id guard (keep the `hasConfigRead` / `loadedConfigStoreId` `if` lines; only revert `return sandboxConfigPushAllowed(...)` or `return loadedConfigStoreId === iframeConfigStoreId`). Not the two-line `return hasConfigRead` / `return hasConfigRead && Boolean(loadedConfigStoreId)` stubs. `on-plugin-fields-no-config-read` restores `if (!loadedConfigStoreId) return false;` only. All three: `patch -p1 --dry-run` at zero offset.

## `revert-proofs/36` measured reds (apply patch → run test)

| Row | Red line |
| --- | --- |
| `field-dirty-always-on` | `AssertionError: expected true to be false // Object.is equality` |
| `field-dirty-css-selectors` | `AssertionError: expected false to be true // Object.is equality` |
| `field-dirty-default-clean` | `AssertionError: expected true to be false // Object.is equality` |
| `field-dirty-number-and-boolean` | `AssertionError: expected false to be true // Object.is equality` |
| `field-edited-label-string` | `AssertionError: expected 'Changed' to be 'Edited' // Object.is equality` |
| `field-unsaved-change-aria` | `AssertionError: expected 'Edited from default' to be 'Unsaved change' // Object.is equality` |
| `host-setconfig-empty-payload` | `AssertionError: expected undefined to deeply equal {}` |
| `host-setconfig-no-config-read` | `AssertionError: expected true to be false // Object.is equality` |
| `host-setconfig-posts` | `AssertionError: expected false to be true // Object.is equality` |
| `modes-plugin-field-section` | `AssertionError: expected 'import * as THREE from "three";\nimpo…' to contain 'section?: string'` |
| `on-plugin-change-config-guard` | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `on-plugin-change-no-config-read` | `AssertionError: expected true to be false // Object.is equality` |
| `on-plugin-fields-config-guard` | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `on-plugin-fields-no-config-read` | `AssertionError: expected true to be false // Object.is equality` |
| `plugin-barrel-spec-for-store-id` | `AssertionError: expected 'undefined' to be 'function' // Object.is equality` |
| `plugin-sandbox-sdk-types` | `AssertionError: expected '/**\n * Standalone zoto iframe host A…' to match /export interface ZotoVizPluginHost</` |
| `plugin-schema-section-type` | `E           AssertionError: section 123 must be rejected` |
| `plugin-spec-for-store-id` | `AssertionError: expected undefined to be 'apod' // Object.is equality` |
| `plugin-visualisation-section-field` | `AssertionError: expected [ { key: 'gain', …(3) }, …(1) ] to deeply equal [ ObjectContaining{…}, …(1) ]` |
| `section-details-open-default` | `AssertionError: expected false to be true // Object.is equality` |
| `section-summary-edited-collapsed` | `AssertionError: expected undefined to be 'Edited' // Object.is equality` |
| `unsectioned-not-collapsible` | `AssertionError: expected 1 to be +0 // Object.is equality` |
