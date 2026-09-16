# Spec Assessment: Src-Master Plugin Catalog

**Target**: `specs/20260916-src-master-plugin-catalog/spec-src-master-plugin-catalog-20260916.md`
**Assessed**: 2026-09-16
**Verdict**: Approve

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 4/5 | Thorough coverage of scan merge, gitignore, test rewrites, CLI/MCP, sample, and docs. One gap: `scan(explicit_root)` merge semantics unspecified (see issue #3). |
| Feasibility | 4/5 | Each subtask is achievable. Subtask 01 carries significant scope risk (11 deliverables, 8+ test files) but is implementable with care. |
| Structure | 5/5 | Clean 3-phase dependency graph. No circular deps, no unnecessary serialisation. Phase 2 parallelism (02 ‖ 03) is well-separated. |
| Specificity | 4/5 | Highly specific: exact function names, file paths, error wording, and "do not" boundaries. Minor ambiguity in test fixture split details for subtask 01. |
| Risk Awareness | 3/5 | Good parallel-execution warnings and cross-subtask awareness. Missing: explicit rollback plan, gradual rollout consideration, and stale-cache cleanup guidance. |
| Convention Compliance | 4/5 | Follows repo conventions for module layout, test naming, docs structure, and gitignore style. `dist/` as pack output is standard. Docstring update for `paths.py` is specified. |
| **Overall** | **4.1/5** | **Approve** |

Weighted: (0.25 × 4) + (0.20 × 4) + (0.20 × 5) + (0.15 × 4) + (0.10 × 3) + (0.10 × 4) = 4.10

## Findings

### Strengths

- **Deliberate reversal, not a contradiction.** The spec clearly frames the shift from committed-zip-as-catalog to src-as-catalog and explains *why* (zlib drift, default scanner ignoring src, generated artefacts shouldn't be in git). The zip contract itself is preserved as the interchange format.
- **Collision semantics are unambiguous.** Src wins, zip is skipped, error is recorded. Force does not override. This is a single, clear rule with no edge-case branching.
- **Sample fixture is architecturally clean.** A single all-features fixture under `examples/plugins/` — not in the live catalog, not duplicating core plugins, and the only place pack byte-identity is asserted.
- **Phase structure maximises parallelism.** Subtasks 02 and 03 have zero overlap (different files, different service modules, different test files). The spec explicitly warns 03 about the pack CLI destination being unstable during parallel execution.
- **Subtask 04 as a final gate.** Running the full pytest + vitest suite only after all behaviour changes land is the correct ordering — it catches integration issues from 01–03 without duplicate work.
- **The cpu-pong cleanup is included.** The duplicate `plugins/src/cpu-pong/` (id `cpupong`) would cause a same-id-within-src error after the merge. Deleting it in 01 prevents a wall of errors on first scan.
- **Codebase assumptions verified.** All referenced functions (`scan`, `_scan_roots`, `_scan_zips`, `_scan_trees`, `pack_tree`, `cli_pack`, `install_plugin_zip`, `dirty_tree_paths`, `MIGRATE_HINT`, `catalog_ids`) exist at the stated locations. Current default `scan()` is zip-only as claimed. `plugin pack` outputs to `plugins/<id>.zip` with no `-o` flag. MCP `install_plugin_zip` has `force` but no src-collision guard. Existing tests require zip-stem == src dir names and pack byte-identity, as claimed.

### Issues

| # | Severity | Subtask | Finding | Recommendation |
|---|----------|---------|---------|----------------|
| 1 | HIGH | 01 | **Oversized subtask.** 11 deliverable items spanning `service/plugins.py`, `service/paths.py`, `.gitignore`, and 8+ test files (`test_plugin_catalog`, `test_paths`, `test_plugin_frontend`, `test_plugin_sky`, `test_plugin_backend`, `test_plugins`, `test_mcp`, `test_plugin_cli`, `test_plugin_migration`). Risk of the executing agent exhausting context or making cascading errors across unrelated test fixtures. | Consider splitting into 01a (scan merge + gitignore + paths docstrings + `cpu-pong` cleanup) and 01b (test fixture rewrites), both in Phase 1 with 01b depending on 01a. This limits blast radius per agent session. |
| 2 | MEDIUM | — | **No rollback plan.** The scan merge changes the default `scan()` return shape for every consumer (monitor, `GET /api/plugins`, `plugin list`). If a bug reaches the running monitor, zero plugins are visible until the fix is deployed. No rollback guidance in the index or any subtask. | Add a one-paragraph rollback note to the spec index: "Revert the `scan()` merge in `service/plugins.py` and un-ignore `plugins/*.zip` in `.gitignore`. Re-generate zips with `plugin pack` for every `plugins/src/<id>/`." |
| 3 | MEDIUM | 01 | **`scan(explicit_root)` merge semantics unspecified.** Subtask 01 defines the merge for `scan()` (no args) but says only "Keep the YAML/tree fallback: `scan(root)` on a directory with *neither* src nor zips." It does not specify what `scan(root)` does when the root contains *both* `plugins/src/` and `plugins/*.zip` — that path falls through to `_scan_roots`'s current zip-first logic, which would bypass src entirely. Three tests (`test_doom_view_wraps_arcade_id`, `test_lan_pulse_frontend_backend_declarative_datasource`, `test_former_modes_are_menu_plugins`) currently call `scan(PLUGINS)`, which is an explicit root. | Clarify in 01's deliverables: either (a) `scan(explicit_root)` also merges when it finds src + zips, or (b) those three tests are rewritten to call `scan()` (no args) via `ZOTO_VIZ_REPO_ROOT`. The executing agent will likely discover this during test fixture splits, but specifying the intent prevents a wrong guess. |
| 4 | LOW | 01 | **Stale `.runtime/` caches unaddressed.** After gitignoring zips and making src the default, `plugins/.runtime/<id>/` for src plugins (unpacked by the prior zip-only scan) is stale. It won't cause errors (the merge loads src trees directly), but it wastes disk and could confuse `ls` debugging. | Optional: add a "clean stale runtime caches" step to subtask 01, or document that `.runtime/` is self-healing (zip-triggered only). |
| 5 | LOW | 03 | **Byte-identity regression coverage reduced.** `test_pack_is_reproducible` currently asserts byte-identity for all 20 core plugins. After the spec, only `examples/plugins/sample.zip` is asserted. If a Python/zlib upgrade changes DEFLATE output, the regression won't be caught until the sample happens to differ. | Acceptable trade-off (src is canonical, zips are generated). Document this intent in the sample test or in `docs/contributing.md`. |
| 6 | LOW | 01 | **`test_plugin_catalog.py` line 33 assertion `assert zips` ("committed plugins/*.zip catalog is empty")** will fail immediately if zips are deleted before tests run. Subtask 01 says delete zips and also rewrite the test, but if the executing agent deletes zips first and runs targeted pytest before the test rewrite, it will see a confusing failure. | Note the ordering constraint in Implementation Notes: rewrite `test_plugin_catalog.py` before (or atomically with) deleting the zips. |

### Dependency Graph

The mermaid graph exactly matches the manifest:

```
S01 --> S02,  S01 --> S03,  S02 --> S04,  S03 --> S04
```

- No missing edges. Subtask 02 needs 01's gitignored zips and scan merge; subtask 03 needs 01's scan to verify sample isn't cataloged; subtask 04 needs 02+03 for docs and suite.
- No unnecessary serialisation. 02 and 03 are correctly parallel (different service modules, different test files, different deliverable paths).
- Phase assignments (1, 2, 2, 3) are consistent with dependency ordering.
- Lower IDs never depend on higher IDs.

**One potential improvement:** if issue #1 is accepted and subtask 01 is split into 01a + 01b, the graph becomes `01a → 01b → {02, 03} → 04` or `{01a → 01b, 01a → 02, 01a → 03} → 04` depending on whether test rewrites must complete before 02/03 start. The current monolithic 01 avoids this complexity at the cost of scope risk.

### Risk Summary

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Subtask 01 agent context exhaustion | Medium | High | Split 01 into scan-merge + test-rewrite subtasks (issue #1) |
| `scan()` runtime bug hides all plugins | Low | High | Add rollback guidance to spec index (issue #2) |
| `scan(explicit_root)` test failures | Medium | Medium | Specify merge vs zip-first for explicit roots (issue #3) |
| Stale `.runtime/` caches after transition | Low | Low | Self-healing; optional cleanup note |
| Cross-machine zlib drift undetected | Low | Low | Acceptable; document in sample test |
| Ordering of zip deletion vs test rewrite | Medium | Low | Note ordering constraint in 01's Implementation Notes (issue #6) |

## Recommendation

**Approve.** The spec is well-structured, highly specific, and addresses a real architectural debt (generated zips as the committed catalog). The 3-phase dependency graph is clean, and the collision semantics are unambiguous.

The two actionable improvements before executing are: (1) consider splitting subtask 01 to de-risk the largest work unit, and (2) clarify `scan(explicit_root)` merge semantics so the executing agent doesn't have to guess whether three existing tests should keep calling `scan(PLUGINS)` or switch to `scan()`. A one-paragraph rollback note in the index would round out risk coverage.

None of these issues are blockers — the spec is executable as-is, but addressing them reduces the chance of a fix-list loop during adversarial verification.

## Fixes applied (2026-09-16)

Operator accepted all six recommended spec-file fixes after this assessment:

1. Split former subtask 01 into **01 catalog merge** + **02 test fixtures**. CLI/MCP is now **03**, sample **04**, docs **05**. Graph: `01 → {02, 03, 04} → 05`.
2. Added a **Rollback** section to the spec index.
3. Specified that `scan(explicit_root)` **also merges** when src is present (`scan(PLUGINS)` sees src).
4. Noted leftover `.runtime/<id>/` is unused for src rows (self-healing; no mandatory delete).
5. Documented sample-only pack byte-identity as an intentional coverage reduction.
6. Ordered catalog-test rewrite **before or atomically with** zip deletion.

Spec status set to **Ready for Review**.
