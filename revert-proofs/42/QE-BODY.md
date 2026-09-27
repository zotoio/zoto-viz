## PR #42 — layout DPR / viewport (post–`361364e0` merge)

### Head record

| | commit | tree |
|---|--------|------|
| **Merge `main` @ `361364e0`** | `f2c833ba7140e90be6a639347727baa0b8efffa1` | (merge) |
| **Proven (code tip)** | `5add37eb4df2dce6f79e4bc37800417c9ed73f05` | filtered below |
| **Final (record + `HEAD.json`)** | `3a87d0f9f67dcf0eac117f4f2ed7616ce252f878` | see `revert-proofs/42/HEAD.json` |

**`provenTree` (proven commit, excluding `revert-proofs/`):**

```bash
GIT_INDEX_FILE=$(mktemp) sh -c 'git read-tree 5add37eb4df2dce6f79e4bc37800417c9ed73f05 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
```

```
b3e347a66e2664323b008f1175e6974413900fad
```

Baseline for parity / sweep: **`361364e0`**. Per-hunk sweep: `/opt/cursor/artifacts/pr42-sweep-hunks.md` (**38** hunks after dropping the lint wrapper file, **0** survivors). **`scene.ts` merge hunks:** caught.

**#112 pack boundary:** `plugins/src/*` packs touched vs `361364e0`: **0** — no split.

### Survivors closed (pre-review)

| survivor | resolution |
|----------|------------|
| `web/scripts/lint-brand-casts.mjs` wrapper-only hunk | **Deleted** — CLI entry moved into `lint-brand-casts-core.mjs`; `pnpm lint` → `node scripts/lint-brand-casts-core.mjs` (real path unchanged). |
| `pane-change.ts` import + `DeviceRect` / `GlRect` / `ProbeLine` hunks | **One row** `pane-change-pack-mirror-brands-revert` — patch reverts the whole branding block (import folded with sibling hunks); vitest source-contract test in `pane-change.test.ts`. |

### Size (vs `361364e0`, excluding `revert-proofs/`)

**2362** insertions, **59** deletions (**34** files). (Full diff including `revert-proofs/`: **3012** insertions — under ~3000 code cap when proofs excluded.)

### Parity (Python 3.12, `uv`, `-o addopts=`)

```bash
export PATH="$PWD/.venv/bin:/usr/bin:$PATH"
pytest -o addopts=
cd web && pnpm exec vitest run && pnpm typecheck && pnpm build
```

| ref | `pnpm exec vitest run` | `pnpm typecheck` | `pnpm build` | `test_scan_zip_catalog` ×20 (isolated) |
|-----|------------------------|------------------|--------------|----------------------------------------|
| **`361364e0`** | **705** passed, **3** skipped (**109** files) | pass | pass | **20/20** pass |
| **proven `5add37eb`** | **740** passed, **3** skipped (**126** files) | pass | pass | **20/20** pass |

Isolated scan: `pytest -o addopts= tests/test_plugins.py::test_scan_zip_catalog` (20 consecutive runs, exit-code per run).

Full `pytest` on this VM (unrelated harness flake possible): **448–449** passed on branch; baseline worktree may show `test_cursor_harness` failures — not part of the row contract above.

### Revert hygiene

- **Half-revert `*-tsc-revert` rows:** **0** remaining (**26** deleted earlier).
- **Row count:** **28** (`revert-proofs/42/*.json` except `HEAD.json`).
- **Sidecars:** vitest rows use full `AssertionError: …` lines; lint rows use full `src/...:line:col: rule-id` lines (via `pnpm lint`).
- **`hasAssertions`:** present in all **new** PR test files under `web/src` (including `pane-change.test.ts` brand block); `CanvasChangeProbe` keeps the legacy early-return when `getContext("2d")` is missing.

### Revert rows — exact reds (28)

| row | runner | exact `expectedRed` |
|-----|--------|---------------------|
| `arcade-fit-layout-dpr-capped-revert` | vitest | `AssertionError: expected 150 to be 125 // Object.is equality` |
| `device-px-ratio-change-1-to-2-revert` | vitest | `AssertionError: expected +0 to be 1 // Object.is equality` |
| `device-px-ratio-change-resize-without-cap-revert` | vitest | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `device-px-ratio-getter-window-prop-read-revert` | vitest | `AssertionError: expected 1200 to be +0 // Object.is equality` |
| `device-px-ratio-read-stray` | lint | `src/graph/render-host.ts:126:17: device-px-ratio-read` |
| `device-px-ratio-rearm-raw-dppx-revert` | vitest | `AssertionError: expected false to be true // Object.is equality` |
| `device-px-ratio-rearm-stale-revert` | vitest | `AssertionError: expected +0 to be 1 // Object.is equality` |
| `layout-backing-device-px-floor-revert` | vitest | `AssertionError: expected 49 to be 50 // Object.is equality` |
| `look-stage-layout-dpr-set-pixel-ratio-revert` | vitest | `AssertionError: expected "vi.fn()" to be called with arguments: [ 1.25 ]` |
| `pack-mirror-brand-cast` | lint | `src/graph/render-host.ts:307:17: brand-cast` |
| `pack-mirror-capture-rounding` | vitest | `AssertionError: expected [ 1.5, 87, 151.5, 91.5 ] to deeply equal [ 2, 87, 151, 91 ]` |
| `pack-mirror-device-edges-x1-ceil-revert` | vitest | `AssertionError: expected [ +0, +0, 3, 2 ] to deeply equal [ +0, +0, 2, 2 ]` |
| `pack-mirror-device-edges-y1-trunc-revert` | vitest | `AssertionError: expected [ +0, 1, 2, 1 ] to deeply equal [ +0, 1, 2, 2 ]` |
| `pane-change-pack-mirror-brands-revert` | vitest | `AssertionError: expected false to be true // Object.is equality` |
| `pong-fit-layout-dpr-capped-revert` | vitest | `AssertionError: expected 72 to be 60 // Object.is equality` |
| `render-host-constructor-refresh-canvas-height-revert` | vitest | `AssertionError: expected 1 to be 150 // Object.is equality` |
| `render-host-dispose-layout-dpr-unsub-revert` | vitest | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `render-host-gpu-viewport-css-constructor-pr-revert` | vitest | `AssertionError: expected 1st "vi.fn()" call to have been called with [ 1 ]` |
| `render-host-gpu-viewport-css-dpr2-cap-revert` | vitest | `AssertionError: expected 2 to be 1.5 // Object.is equality` |
| `render-host-gpu-viewport-css-resize-gpu-revert` | vitest | `AssertionError: expected [ 3, 41, 227, 137 ] to deeply equal [ 2, 87, 151, 91 ]` |
| `render-host-layout-dpr-feed-dpr2-revert` | vitest | `AssertionError: expected 200 to be 150 // Object.is equality` |
| `render-host-layout-dpr-legacy-stage3d-175-revert` | vitest | `AssertionError: expected 175 to be 150 // Object.is equality` |
| `render-host-refresh-canvas-height-max1-revert` | vitest | `AssertionError: expected +0 to be 1 // Object.is equality` |
| `render-host-resize-gpu-max1-revert` | vitest | `AssertionError: expected +0 to be 1 // Object.is equality` |
| `render-host-set-pixel-ratio-auto-tune-revert` | vitest | `AssertionError: expected 1.25 to be 1 // Object.is equality` |
| `render-host-software-canvas-width-revert` | vitest | `AssertionError: expected 400 to be 250 // Object.is equality` |
| `render-host-software-present-brand-revert` | vitest | `AssertionError: expected false to be true // Object.is equality` |
| `scene-base-dpr-renderhost-cap-revert` | vitest | `AssertionError: expected "vi.fn()" to be called with arguments: [ 1.25 ]` |

Replay: **28/28** OK (`python3 /tmp/replay-rows.py`).

### TSC padding rows removed (26)

All former `*-tsc-revert` half-reverts removed; no tsc contract rows. Import/declaration hunks covered by behavioural vitest/lint rows and the per-hunk sweep (see artifact table).
