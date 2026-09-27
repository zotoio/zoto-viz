# PR #36 — TSE review notes

## `main.ts` survivors (awaiting integration harness)

These hunks ship in `web/src/app/main.ts` and are **not** covered by a `revert-proofs/36/*.patch` row (guards are exercised via `plugin-config-sync.ts` + `plugin-sandbox-config-push.test.ts` instead):

| Hunk | Behaviour |
| --- | --- |
| `settings.onPluginChange` | Calls `allowOnPluginChangeConfigPush` + `pluginSpecForStoreId` before `sandbox.setConfig` |
| `onPluginFields` | Refreshes iframe config via `allowOnPluginFieldsConfigPush` + `pluginSpecForStoreId` / `sandboxLoadedConfigStoreId` |
| `sandboxLoadedConfigStoreId()` | Derives loaded store id from `tsWatchStoreId` + `config.read` |
| `loadTsPlugin` | Maintains `tsWatchStoreId` alongside `tsWatchId` on load/unload paths |

Rows `on-plugin-change-config-guard`, `on-plugin-fields-config-guard`, `on-plugin-change-no-config-read`, and `on-plugin-fields-no-config-read` target `plugin-config-sync.ts` (and sandbox push tests), not `main.ts` directly.

## `plugin-sandbox-sdk-types` row removed

`plugins/sdk/plugin-sandbox.ts` contract is covered by `web/typecheck/plugin-sandbox.typecheck.ts` included in `web/tsconfig.json` (`pnpm typecheck` in CI). The prior revert row only produced **TS2305** (missing export rename), not a behavioural contract failure, so the patch/json row was deleted.
