# PR #101 export body

**Labels:** `host-change` ( `web/src/plugins/viz-pack-host.ts` — hn-term `termNow` uses `frame.t` instead of wall clock )

## viz-pack-runtime-esbuild (commit `e8458f2`)

Already landed in **`e8458f2`** on this branch (parent of `7460aeb`):

| Location | What |
|----------|------|
| `web/src/plugins/viz-pack-runtime-esbuild.test.ts` L10–18 | `projectPython` = `<repo>/.venv/bin/python`, `requireProjectPython()` |
| same file L83–84, L112 | zip-unpack test calls `requireProjectPython(ctx)` and `execFileSync(python, …)` |
| `.github/workflows/ci.yml` L39–42 | `web` job: `python -m venv .venv` + `.venv/bin/pip install -r requirements.txt` before `pnpm test:coverage` |

Vitest runs only in the **`web`** CI job (`pnpm test:coverage`). Other jobs (`python`, `build`, `dogfood`, `docs`) do not run vitest.

### Exact esbuild test outcomes (`pnpm exec vitest run src/plugins/viz-pack-runtime-esbuild.test.ts`)

| Scenario | Outcome |
|----------|---------|
| No `.venv`, `CI` unset | **1 passed**, **1 skipped** — skip note **`no project venv`** |
| No `.venv`, `CI=1` | **1 passed**, **1 failed** — **`Error: no project venv in CI`** |
| `.venv` + `requirements.txt` | **2 passed** |

## fat-LAN live soak

Fake time only; exact **120** delivered / **0** skipped per pack. No real-time vitest assertions (see deferred list).

### Revert rows (`revert-proofs/101/`)

| Row patch | Production change reverted | Red (anchored test) |
|-----------|---------------------------|---------------------|
| `termNow-performance-now.patch` | `termNow()` reads `performance.now()` again | `fat-LAN live soak: …` → **`Error: fat-LAN soak must not read real time`** (see `revert-proofs/101.json`) |

The in-test **`revert: fat-LAN soak cannot read performance.now / Date.now`** is a normal guard test, **not** a revert row.

### 20-run matrix (cloud VM)

| Mode | Meaning | Result |
|------|---------|--------|
| **UNPATCHED** | Branch tip, no revert patch | **20/20** pass — **120** delivered per pack every run |
| **PATCHED** | `git apply revert-proofs/101/termNow-performance-now.patch` | **20/20** fail — byte-identical failure block (SHA-256 `6559ddfd2dffe9dc3951d6693c758db054b1cbcc90e857a270e92c3d277eae2a` over `Failed Tests` … `[1/1]` slice) |

## Deferred to Andrew's local GPU run

Removed from **`fat-LAN live soak`** vitest (not replaced with ranges or `toBeGreaterThan`):

- `console.log(formatDogfoodReport(result))` — live timing / skip-rate report
- `expect(result.fixture.devices).toBeGreaterThanOrEqual(300)` — deferred (replaced with exact **420**)
- `expect(result.fixture.flows).toBeGreaterThanOrEqual(1000)` — deferred (replaced with exact **1200**)
- `expect(result.packs.length).toBeGreaterThanOrEqual(3)` — deferred (replaced with exact `VIZ_DEMO_PACKS` length)
- `expect(result.packs.map(...)).toEqual(expect.arrayContaining([...]))` — deferred (replaced with exact order)
- `expect(pack.buildMs.p95).toBeLessThan(VIZ_FRAME_BUDGET_MS + 0.01)` — **deferred to Andrew's local GPU run**
- `expect(pack.withinBudget).toBe(true)` — **deferred to Andrew's local GPU run**
- `expect(result.allWithinBudgetOrHonestSkips).toBe(true)` — **deferred to Andrew's local GPU run**

## Hunk table (`main` → branch)

| ID | File | Summary |
|----|------|---------|
| H1 | `.github/workflows/ci.yml` | Web job creates `.venv` and installs requirements |
| H2 | `web/src/plugins/viz-pack-runtime-esbuild.test.ts` | `requireProjectPython` + `.venv/bin/python` for zip compile |
| H3 | `web/src/plugins/viz-pack-host.ts` | `termNow` → `frame.t` (**host-change**) |
| H4 | `web/src/plugins/dogfood.test.ts` | `withFatLanSoakFakeTime` helper + throw stubs |
| H5 | `web/src/plugins/dogfood.test.ts` | Soak asserts exact counts only |
| H6 | `web/src/plugins/dogfood.test.ts` | Guard test `revert: fat-LAN soak cannot read…` (not a revert row) |

### Remove-one-hunk sweep

| Remove | Local signal | Survivor? |
|--------|--------------|-----------|
| H1 only | CI workflow only; local `CI=1` esbuild still fails without venv (test code unchanged) | N/A locally — **required in GHA** |
| H2 only | `CI=1` without venv: no `no project venv in CI` guard; uses `python3` (passes if system PyYAML present) | **Survivor** on machines with global `yaml` — guard hunk still required for CI contract |
| H3 only | Soak fails **`fat-LAN soak must not read real time`** | **No survivor** |
| H4+H5+H6 (restore main `dogfood.test.ts`) | Main-style soak **passes** on calm VM | **Survivor** for count-only under load (119 vs 120); fake-time hunks required for cloud policy |

No hunks are optional for the stated CI + no-real-time goals.

## Full vitest (`cd web && pnpm exec vitest run`, `.venv` present)

| Ref | Test files | Tests | Failed |
|-----|------------|-------|--------|
| `main` | 104 passed, 2 skipped (106) | 663 passed, 3 skipped (666) | **0** |
| branch | 104 passed, 2 skipped (106) | 664 passed, 3 skipped (667) | **0** |

Branch adds **1** test: `revert: fat-LAN soak cannot read performance.now / Date.now`.
