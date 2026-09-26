# Pack guardrails PR — diff inventory (vs `main`)

## Removed from the branch (does not belong in review)

| Item | Action |
|------|--------|
| `revert-proofs/35/red/*.txt` | **Removed** — regenerated local failure logs; run `./revert-proofs/35/run-all-red.sh` |
| `node_modules/`, `web/dist/`, `plugins/*.zip`, screenshots | **Not in diff** (never committed) |
| `#33` / `#38` stray zips or build output | **Not in diff** |
| `cypher-cic.zip` / `syscon.zip` | **Untouched** (only `plugins/src/*/frontend/index.ts` in group C) |

Kept on purpose (not junk):

- `plugins/sdk/host-lint-fixtures/**`, `pack-lint-fixtures/**` — lint/host CI fixtures
- `plugins/sdk/pack-bundle-fixtures/**` — boundary install tests
- `plugins/sdk/starter-regression/pre-9f41244/**` — starter draw regression pin (used by `starter-pack-pipeline.ts`)
- `revert-proofs/35/*.{patch,json}` + `verify-row.sh` — install/retry revert proofs (PR B)

## Grouped line counts (`git diff origin/main...HEAD`)

Counts from `scripts/pack-guardrails-split-manifest.json` (after removing `red/*.txt`).

| Group | Scope | Files | +lines | −lines | Net |
|-------|--------|------:|-------:|-------:|----:|
| **(a) SDK, resolver & lint** | `plugins/sdk/**`, pack boundary/SDK service, lint CLI/tests, starter/talker SDK, CI workflows, docs, shared web tooling | 124 | 5444 | 48 | **5396** |
| **(b) Install pipeline & Retry** | `plugin_install`, blocks, retry UX/API, monitor routes, revert-proofs/35, install tests | 87 | 4806 | 39 | **4767** |
| **(c) `getVizZoto()` — 17 packs** | `plugins/src/*/frontend/index.ts` only | 17 | 49 | 90 | **−41** |

**Combined net ≈ 10 122 lines** (churn ≈ 10 3xx) — **above the ~3000-line split threshold**.

## Split decision

**Three stacked PRs** (A → B → C):

- **PR A** (`cursor/pr-a-sdk-resolver-6122`): group (a); **`LEGACY_DECLARE_ZOTO_PACK_IDS`** pins the 17 shipped ids (not a downgraded rule). `plugins/src/pack-lint-legacy-probe/` is the 18th fixture; `revert-proofs/56/01-*` goes red if the probe is allowlisted.
- **PR B** (`cursor/pack-guardrails-6122` / #35): group (b) on top of A — install pipeline, Retry, `revert-proofs/35/`.
- **PR C** (`cursor/pr-c-viz-zoto-packs-6122`): group (c) on top of A — 17 pack swaps + baseline cleanup for migrated packs.

Each PR carries its own `revert-proofs/<n>/` rows and full `tsc` / `vitest` / `pytest` at merge time.
