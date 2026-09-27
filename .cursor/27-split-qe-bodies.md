# #27 split QE — paste sections (9:31 send-back + TSE gates a–c)

Use between `=====PR94/92/93 BODY START/END=====` markers on #94 / #92 / #93. Everything from the **9:31 send-back** (inline hunk→row tables, row gates with live vitest lines, full pytest/vitest, `expect.hasAssertions()`, deleted tests, stack ancestry, #88 note on #94 only) still applies; **add the TSE blocks below at every split head**.

Automation: `python3 scripts/tse_gate_bc.py` (gates **b** and **c**). Preflight **(a)** is documented per head below.

---

## TSE gate (a) — preflight before one-hunk sweep

Run **full** suites at the split **production** HEAD (not revert-proof commits), list failures that are **environment-only** (missing deps, network, etc.), **deselect** those from the sweep, then run the one-hunk production sweep.

| Split | HEAD | `pnpm exec vitest run` (web/) | `pytest -q` (repo root, `.venv`) | Env-only failures (deselected) |
|-------|------|-------------------------------|----------------------------------|--------------------------------|
| **27a / #94** | `4a1e647d` | **698 passed**, 3 skipped (701) | **433 passed** | **(none)** |
| **27b / #92** | `e4d64961` | **701 passed**, 4 skipped (705) | **433 passed** | **(none)** |
| **27c / #93** | `6678a61b` | **733 passed**, 4 skipped (737) | **442 passed** | **(none)** |

No sweep rows were deselected for unrelated red at any head.

---

## TSE gate (b) — no padding / unique patches

At repo root (any stack branch with full `revert-proofs/27/`):

```bash
sha256sum revert-proofs/27/*.patch | sort | uniq -D -w64
```

**Required output:** *(empty — no duplicate hashes)*

Verified on branch `cursor/viz-frame-contract-v27c-afd6` @ `9b37da5e` — command printed nothing.

Each row’s `.patch` removes or changes production code the split adds (no inject-only rows; no reverts of code already on `main`). Enforced in `scripts/tse_gate_bc.py` via minus-line presence in HEAD production files.

---

## TSE gate (c) — measured red vs `patchedAssertion`

```bash
python3 scripts/tse_gate_bc.py
```

**27a @ `4a1e647d`:** 16/16 OK (viz-contract ×4, collect ×10, link-render ×2).

**27b @ `e4d64961`:** 5/5 OK (all `cypher-cic-*` rows).

**27c @ `6678a61b`:** 18/18 OK (hud ×8, viz-frame-empty/host/scope/links ×6, viz-v1-adapter ×4).

No sidecar/measured mismatches; nothing to paste side-by-side.

**Collect row fix (27a):** `viz-frame-collect-index-r1-zero-pass` and `viz-frame-collect-index-r7b-pool-sets` now use **distinct** single-hunk patches (skip index lookup via `undefined as number | undefined` vs `void 0`); `r7b` sidecar `patchedAssertion` aligned to measured `AssertionError: expected 200 to be +0 // Object.is equality`.

---

## Stack ancestry (paste on all three PRs)

```text
6520b01 (main) → 4a1e647d (27a) → e4d64961 (27b) → 6678a61b (27c)
git merge-base --is-ancestor 4a1e647d e4d64961  # 0
git merge-base --is-ancestor e4d64961 6678a61b  # 0
```

TSE revert-proof stack commits (revert-proofs only):

- **27a:** `e2424bbb` — collect pool/alloc/r1/r7b patches + `scripts/tse_gate_bc.py`
- **27b:** `8da66aab` merge 27a; `cfee41e3` — cypher sidecars/patches
- **27c:** merge 27b; `9b37da5e` — hud + v1-adapter shared-frame patches

---

## #88 note (#94 / 27a only)

Frame contract v2 / pack delivery for monitor tick remains on **#88** (`cursor/viz-frame-contract-v2-afd6`); **#94** lands collector + contract tests + revert rows only — do not re-litigate v2 monolith scope on #94.

---

## Per-PR pointers

| PR | Branch | Rows in `revert-proofs/27/` for this split |
|----|--------|-----------------------------------------------|
| #94 | `cursor/viz-frame-contract-v27a-afd6` | 16 rows (see gate (c) 27a list) |
| #92 | `cursor/viz-frame-contract-v27b-afd6` | 5 cypher rows |
| #93 | `cursor/viz-frame-contract-v27c-afd6` | 18 rows (see gate (c) 27c list) |

Paste **(a)(b)(c)** blocks above into each PR body after the 9:31 hunk/row tables for that split’s HEAD.
