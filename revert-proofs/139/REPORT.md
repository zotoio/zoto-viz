## Revert proof (PR #139)

Recorded at HEAD `53a701b8` (run `git rev-parse HEAD` on branch tip for exact SHA after later commits).

| row | test | revert description | baseline (green) | patched (red) |
| --- | --- | --- | --- | --- |
| data-source-no-executable-layers | `tests/test_data_source_plugin.py::test_data_source_rejects_frontend` | Drop frontend guard in `check_data_source_semantics` | pass (`node scripts/revert-proof.mjs 139 --row data-source-no-executable-layers` baseline) | fail `assert blocked is True` |
| partition-skips-data-source | `src/remix/remix-partition.test.ts` | Remove `pluginKind === data-source` skip in `partitionCatalog` | pass | fail `expected true to be false` |
| remix-snapshot-demo-flag | `src/remix/remix-snapshot.test.ts` | Remove `demo: true` from remix frame merge | pass | fail `expected undefined to be true` |

Vitest rows are verified in-repo via `git apply` + `pnpm exec vitest run <file>` (worktree overlay cannot load `vite.config.ts` in this VM).

### data-source-no-executable-layers (RED excerpt)

```
>       assert blocked is True
E       assert False is True
```

### partition-skips-data-source (RED excerpt)

```
expect(rows.some((r) => r.id === "public-hn-top")).toBe(false);
AssertionError: expected true to be false
```

### remix-snapshot-demo-flag (RED excerpt)

```
expect(frame.demo).toBe(true);
AssertionError: expected undefined to be true
```
