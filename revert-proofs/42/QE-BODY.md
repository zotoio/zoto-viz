## PR #42 — layout DPR / viewport (base `361364e0`)

**Do not merge `main` @ `3d38c536`** until the mosaic TS2345 fix PR has merged (per maintainer).

### Head record

| | commit |
|---|--------|
| **Merge `main` @ `361364e0`** | `f2c833ba7140e90be6a639347727baa0b8efffa1` |
| **Proven (code)** | `e63a9b4358ebb3bd90e7d4246ded937e05144de6` |
| **Final tip (branch `HEAD`)** | `95032a0c4e11fd9041c3a870ad3fadc0e49179db` |

**`provenTree` (proven commit, excluding `revert-proofs/`):**

```bash
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree e63a9b4358ebb3bd90e7d4246ded937e05144de6 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
```

```
97b1c600caa73a77494a559c98fd182176e55aab
```

(Filtered key was `b3e347a6…` for earlier proven `5add37eb`; it changes when the proven commit moves.)

**HEAD.json at tip:** `finalCommit` must equal `git rev-parse HEAD` (currently `95032a0c…`). If it differs (sync commits store the parent hash), run once:

```bash
TIP=$(git rev-parse HEAD)
TREE=$(git rev-parse "${TIP}^{tree}")
jq --arg c "$TIP" --arg t "$TREE" '.finalCommit=$c | .finalTree=$t' revert-proofs/42/HEAD.json > revert-proofs/42/HEAD.json
git add revert-proofs/42/HEAD.json && git commit -m "chore(42): HEAD.json finalCommit sync"
```

### Size (vs `361364e0`, excluding `revert-proofs/`)

**2326** insertions, **55** deletions (**33** files).

### Parity (clean worktree, fresh `uv` 3.12 venv, `pytest -o addopts=`)

Setup each side: `uv venv .venv --python 3.12`; `uv pip install -r requirements.txt pip aiohttp PyYAML`; `PATH` includes a `systemd-inhibit` shim (`exec true`); `pnpm install --frozen-lockfile` in `web/`, `service/cursor-bridge/`, `docs/`; strip untracked `plugins/**/node_modules`.

| ref | full `pytest -o addopts=` | `pnpm exec vitest run` | `pnpm typecheck` | `pnpm build` | `test_scan_zip_catalog` ×20 (isolated) |
|-----|---------------------------|-------------------------|------------------|--------------|------------------------------------------|
| **`361364e0`** | **449 passed**, 0 failed, 0 skipped | **705** passed, 3 skipped | pass | pass | **20/20** pass |
| **proven `e63a9b43`** | **449 passed**, 0 failed, 0 skipped | **739** passed, 3 skipped | pass | pass | **20/20** pass |

### Brand rows (no source-text replay)

| area | resolution | what the revert row runs |
|------|------------|---------------------------|
| **`pane-change.ts` pack-mirror brands** | **Deleted** — file matches `361364e0`; no row (revert did not yield a production `tsc` contract red). Removed the `CanvasChangeProbe` `@ts-expect-error` block from `test-support/pack-mirror-rect.boundary.ts`. | — |
| **`render-host-software-present-brand-revert`** | **`tsc` row** — patch returns an unbranded object from software `present()`. | `pnpm exec tsc --noEmit` on production `tsconfig`. **Red:** `src/graph/render-host.ts(307,7): error TS2322: Type '{ x: number; y: number; w: number; h: number; }' is not assignable to type 'Viewport'.` |

Optional (not replayed): `render-host-software-present.test.ts` → `host.present(...)` + `expect(isDeviceRect(vp!)).toBe(true)` (runtime branding).

### Revert rows

**27** sidecars; **0** `*-tsc-revert` padding; replay **27/27** OK.
