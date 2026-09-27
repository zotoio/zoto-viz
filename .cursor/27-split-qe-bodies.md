# #27 split QE — paste sections (9:31 send-back + TSE + QE rules 1–2)

Paste between `=====PR94/92/93 BODY START/END=====` on each PR. **9:31 send-back** (inline one-hunk sweep tables, live vitest row gates, full pytest/vitest, `expect.hasAssertions()`, deleted tests, stack ancestry, #88 on #94 only) **still stands**; add the blocks below for that PR.

Automation:

```bash
python3 scripts/tse_gate_bc.py   # TSE (b)(c) + QE rule 2
python3 scripts/qe_gate_pr27.py  # QE rule 2 tables only
```

---

## Shared — TSE gates (a)(b)(c)

### (a) Preflight before one-hunk sweep

| Split | HEAD | Vitest | Pytest | Env-only deselects |
|-------|------|--------|--------|-------------------|
| 27a / #94 | `4a1e647d` | 698 passed, 3 skipped | 433 passed | none |
| 27b / #92 | `e4d64961` | 701 passed, 4 skipped | 433 passed | none |
| 27c / #93 | `6678a61b` | 733 passed, 4 skipped | 442 passed | none |

### (b) Unique `.patch` bytes

```bash
sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64
# (empty)
```

### (c) Row gate vs `patchedAssertion`

`python3 scripts/tse_gate_bc.py` — 16 + 5 + 18 rows OK at split HEADs `4a1e647d` / `e4d64961` / `6678a61b`.

---

## Shared — stack ancestry

```text
6520b01 (main) → 4a1e647d (27a) → e4d64961 (27b) → 6678a61b (27c)
```

---

=====PR94 BODY START (QE rules 1–2 + hunk→row map)=====

### QE rule 1 — failure buckets @ HEAD `4a1e647d`

Machine: cloud agent VM, same commands as main comparison (`pnpm exec vitest run` in `web/`, `pytest -q` at repo root with `.venv`).

| Category | Requirement | This PR @ HEAD |
|----------|-------------|----------------|
| **(a) Env-only** | Fails on `origin/main` (`6520b01`) with **same test name** and **same error text** — paste both | **(none)** — full suites green on main and on `4a1e647d` |
| **(b) PR snapshot** | Snapshot updated in PR; list changed entries | **(none)** — no vitest/pytest snapshot failures at HEAD |
| **(c) Nondeterministic** | Fixed seed + 20/20 identical runs, or test deleted and named | **(none)** — no flaky inventory; nothing deleted for nondeterminism |

**Suite @ HEAD:** vitest **698 passed**, 3 skipped; pytest **433 passed**.

**Suite @ main (`6520b01`):** vitest **663 passed**, 3 skipped (106 files); pytest **433 passed**.

No uncategorized “noise” / “flaky” wording — zero failures to classify.

### QE rule 2 — one hunk ↔ one row ↔ one red target

No two kept rows may revert the **same production hunk** (same reverted `-` line set) and go red on the **same vitest test** without a **distinct** `patchedAssertion`. Hunk id = SHA256 prefix of `file` + reverted `-` lines (`hunk_fp`).

**Hunk sweep + revert row map (#94, 16 rows):**

| Production hunk (`file`, `hunk_fp`, first `-` line) | Revert row | Row-gate test | `patchedAssertion` (bytes) |
|---|---|---|---|
| `viz-host.ts` `543b9e78694c` — `const contractVersion: PackVizContractVersion = versionPar…` | `viz-contract-missing` | `viz-host.test.ts` / sidecar regex | `AssertionError: expected 2 to be 1 // Object.is equality` |
| `viz-host.ts` `f8dac9061923` — `return { blocked: \`viz.contract ${raw} is not supported; u…` | `viz-contract-unknown` | `viz-host.test.ts` | `AssertionError: expected { state: 'ready', contract: { …` |
| `viz-host.ts` `4de285d0bc51` — `return merged;` | `viz-contract-v1` | `viz-host.test.ts` | `AssertionError: expected 2 to be 1 // Object.is equality` |
| `viz-host.ts` `2d1f5407f4a9` — `return applyVizFrameContractV2(merged, state, resolveVizFr…` | `viz-contract-v2` | `viz-host.test.ts` | `AssertionError: expected 1 to be 2 // Object.is equality` |
| `viz-frame-collect.ts` `9c28bcaa34f9` — `lastZeroPassVisitCount = 0;` | `viz-frame-collect-alloc` | `viz-collect-equivalence.test.ts` | `AssertionError: expected 19174 to be 6 // Object.is equality` |
| `viz-frame-collect.ts` `32300ad13c92` — `maxLinks,` | `viz-frame-collect-equivalence` | `viz-collect-equivalence.test.ts` | `AssertionError: frame 0: linksDropped (expected 8, got 9…` |
| `viz-frame-collect.ts` `32300ad13c92` — `maxLinks,` | `viz-frame-collect-index-r1-cap8` | `viz-frame-collect-index.test.ts` | `AssertionError: expected 12 to be 8 // Object.is equality` |
| `viz-frame-collect.ts` `da7d5060003e` — `export const VIZ_LINK_IDLE_DROP_FRAMES = 3600;` | `viz-frame-collect-index-r1-idle-drop` | `viz-frame-collect-index.test.ts` | `AssertionError: expected 1 to be 3600 // Object.is equality` |
| `viz-frame-collect.ts` `6f0e82cc7260` — `let idx = byDst.get(dst);` | `viz-frame-collect-index-r1-zero-pass` | `viz-frame-collect-index.test.ts` | `AssertionError: expected 200 to be +0 // Object.is equality` |
| `viz-host.ts` `853861177c23` — `return tieBreak(a, b) < 0;` | `viz-frame-collect-index-r2-tiebreak` | `viz-frame-collect-index.test.ts` | `AssertionError: expected [ '10.0.0.1>10.0.0.4@88.5', …` |
| `viz-frame-collect.ts` `0e5a1556a673` — `slot.rate = 0;` | `viz-frame-collect-index-r4-slot-reset` | `viz-frame-collect-index.test.ts` | `AssertionError: expected [ { src: '10.0.0.1', …` |
| `viz-frame-collect.ts` `6f0e82cc7260` — `let idx = byDst.get(dst);` | `viz-frame-collect-index-r7b-pool-sets` | `viz-frame-collect-index.test.ts` | `AssertionError: expected 200 to be +0 // Object.is equality` |
| `viz-frame-collect.ts` `9217f1fd991c` — `if (!aIn \|\| !bIn \|\| fl.a === fl.b) continue;` | `viz-frame-collect-index-r7c-talker-guard` | `viz-frame-collect-index.test.ts` | `AssertionError: expected [ '10.0.0.1>10.0.0.2@42' ] to d…` |
| `viz-frame-collect.ts` `be6ef94ce30a` — `zeroLinkRatesForFrame();` | `viz-frame-collect-pool` | `viz-collect-equivalence.test.ts` | deep-equal links `…` (see sidecar) |
| `viz-link-render.ts` `ac221aeb5ec1` — `` return `${src}\0${dst}`; `` | `viz-link-render-r6a-rank` | `viz-frame-collect-index.test.ts` | `…#0` identity assertion |
| `viz-link-render.ts` `279b72a6fefd` — `let h = 2166136261;` (×4 `-` lines) | `viz-link-render-r6b-rank` | `viz-frame-collect-index.test.ts` | `…#1` render key assertion |

**Collision check:** `python3 scripts/qe_gate_pr27.py` — all 16 rows: distinct `(hunk_fp, testFile, testName)`; shared hunks (`32300ad13c92`, `6f0e82cc7260`) pair with **different tests** or **different assertions**.

### #88 note (#94 only)

V2 monolith / tick delivery stays on **#88**; #94 is collector + contract tests + revert rows only.

=====PR94 BODY END=====

---

=====PR92 BODY START (QE rules 1–2 + hunk→row map)=====

### QE rule 1 — failure buckets @ HEAD `e4d64961`

| Category | This PR @ HEAD |
|----------|----------------|
| **(a) Env-only** (same name + error on `6520b01`) | **(none)** |
| **(b) PR snapshot** | **(none)** |
| **(c) Nondeterministic** (seed×20 or deleted) | **(none)** |

**Suite @ HEAD:** vitest **701 passed**, 4 skipped; pytest **433 passed**. **@ main:** vitest 663 passed; pytest 433 passed.

### QE rule 2 — hunk → row map (#92, 5 rows)

| Production hunk (`hunk_fp`, first `-` line) | Revert row | Row-gate test (`cypher-cic-session.test.ts`) | `patchedAssertion` |
|---|---|---|---|
| `settings.ts` `361cf710b4bc` — `if (opts?.persist === false) {` | `cypher-cic-block-save-during-session` | collapse/restore (sidecar regex) | `expected '0' to be '1'` |
| `settings.ts` `b415e5063ac5` — `const on = opts?.onFromMemory` | `cypher-cic-session-chat-leak` | chat leak test | `expected '1' to be '0'` |
| `cypher-cic-panels.ts` `ca2ccc351cb6` — `setFeedOn(readPersistedFeedOn(), { p…` | `cypher-cic-session-collapse-restore` | collapse/restore | `expected false to be true` |
| `cypher-cic-panels.ts` `2a212d67436d` — `setFeedOn(!settings.feedSettings.on);` | `cypher-cic-session-f-press` | header **f** test | `expected '0' to be '1'` |
| `cypher-cic-panels.ts` `a5da85217f7e` — `hideFeed) settings.setFeedOn(false, { persist: f…` | `cypher-cic-settings-persist` | collapse/restore | `expected '0' to be '1'` |

**Note:** `block-save` and `settings-persist` share the **same vitest title** but **different hunks** (`361cf710b4bc` vs `a5da85217f7e`) — allowed; not same hunk + same test collision.

**Collision check:** 5/5 distinct `(hunk_fp, testName)` pairs.

=====PR92 BODY END=====

---

=====PR93 BODY START (QE rules 1–2 + hunk→row map)=====

### QE rule 1 — failure buckets @ HEAD `6678a61b`

| Category | This PR @ HEAD |
|----------|----------------|
| **(a) Env-only** | **(none)** |
| **(b) PR snapshot** | **(none)** |
| **(c) Nondeterministic** | **(none)** |

**Suite @ HEAD:** vitest **733 passed**, 4 skipped; pytest **442 passed**. **@ main:** vitest 663 passed; pytest 433 passed.

### QE rule 2 — hunk → row map (#93, 18 rows)

| Production hunk (`hunk_fp`, preview) | Revert row | Row-gate test file | Distinct assertion |
|---|---|---|---|
| `9075e7bb87f6` DEGRADED template | `hud-degraded-label` | `viz-hud.test.ts` | prefix copy |
| `f33a7f2639df` separator hidden | `hud-degraded-separator` | `viz-hud.test.ts` | child count 3 vs 4 |
| `8c7fb151138a` failedUnits sysFail | `hud-degraded-tcp-units` | `viz-hud.test.ts` | unit copy |
| `f7619074cff2` empty parts → null | `hud-failure-badge-hides-healthy` | `viz-hud.test.ts` | badge null |
| `9075e7bb87f6` (same line, different test) | `hud-failure-badge-shows` | `viz-hud.test.ts` | non-empty strip |
| `b67e062adf91` stageFailEl text | `hud-idle-failed-match` | `viz-hud.test.ts` | strip vs stage match |
| `cca58ba9b318` stage pill visible | `hud-stage-fail-pill` | `viz-hud.test.ts` | stage pill copy |
| `cfcc9a6fdfb4` stage pill hidden | `hud-stage-pill-cleared` | `viz-hud.test.ts` | hidden flag |
| `c73d107a57b5` EMPTY_VIZ_LINKS | `viz-frame-empty-links-freeze` | `viz-frame-empty-links.test.ts` | freeze contract |
| `9c59c2f246ca` pack-deliver try | `viz-frame-empty-links-isolation` | `viz-frame-empty-links.test.ts` | isolation |
| `fb5cd69c77f8` per-frame bind | `viz-frame-host-per-frame-opts` | `viz-frame-host-tick.test.ts` | parseSourceBind |
| `7ac68bc41aa5` delete frame.links | `viz-frame-links-off-absent` | `viz-frame-collect.test.ts` | links undefined |
| `287564f20bb6` frame.links = links | `viz-frame-links-on-empty` | `viz-frame-collect.test.ts` | empty array |
| `0f2c5c972556` sourceBind return | `viz-frame-scope-per-frame-bind` | `viz-frame-scope.test.ts` | bind parse once |
| `8a0d73b9b924` copyWorkIntoPack | `viz-v1-adapter-fresh-frame` | `viz-v1-frame-adapter.test.ts` | per-pack frame |
| `ab42252d6cf1` allocV1PackFrame | `viz-v1-adapter-shared-frame` | `viz-v1-frame-adapter.test.ts` | talker isolation |
| `8d6a61ed55f3` talkersBuf.length | `viz-v1-adapter-talkers-alias` | `viz-v1-frame-adapter.test.ts` | alias length |
| `b7dc63b85afd` viewOpts snapshot | `viz-v1-adapter-view-opts-snapshot` | `viz-v1-frame-adapter.test.ts` | opts stable |

Full columns (file paths + byte assertions): run `python3 scripts/qe_gate_pr27.py` and paste the **27c** table from output.

**Collision check:** 18/18 distinct `(hunk_fp, testFile, testName)`; label/show rows share `9075e7bb87f6` but **different tests**.

=====PR93 BODY END=====
