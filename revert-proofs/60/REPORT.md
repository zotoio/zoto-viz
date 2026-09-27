## Revert proof (PR #60)

**Proven code commit:** `5a55851222d298a253b19b559d65fcd39b33351c`  
*(post-merge `361364e0` + pack-lint baseline + legacy allowlist for six main packs)*

**Proven tree (excludes `revert-proofs/`):** `79a5594e8637a99ef8f3d934248ceb7c024a316f`

Proven tree from:

```sh
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree 5a55851222d298a253b19b559d65fcd39b33351c && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
# → 79a5594e8637a99ef8f3d934248ceb7c024a316f
```

Patches apply at zero offset; unpatched node passes; patched node fails with the sidecar `patchedFailure` line.

| row | test | revert description | result |
| --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | `src/plugins/pack-lint.test.ts` :: off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto blocks declare const zoto off allowlist | RED: `AssertionError: expected +0 to deeply equal 1` |
| 02-pack-id-hyphen-slug | `tests/test_plugin_id_pattern.py::test_schema_rejects_nonconforming_plugin_ids[bad_underscore]` | Top-level `properties.id` hyphen-only pattern | RED: `E       Failed: DID NOT RAISE ValueError` |
| 03-plugin-sky-swiftshader-launch | `src/plugins/plugin-sky-smoke-render.test.ts` :: plugin sky smoke browser launch opts in SwiftShader for GPU-less CI | SwiftShader launch `ignoreDefaultArgs` | RED: `AssertionError: expected undefined to deeply equal [ '--disable-software-rasterizer' ]` |
| 04-pack-id-mode-id-hyphen-slug | `tests/test_plugin_id_pattern.py::test_schema_rejects_nonconforming_mode_id[bad_underscore]` | `mode_id` hyphen-only pattern | RED: `E       Failed: DID NOT RAISE ValueError` |
| 05-pack-id-instance-id-hyphen-slug | `tests/test_plugin_id_pattern.py::test_schema_rejects_nonconforming_plugin_instance_id[bad_underscore]` | Instance `id` hyphen-only pattern | RED: `E       Failed: DID NOT RAISE ValueError` |
| 12-talker-slots | `src/plugins/starter-template.test.ts` :: talker slots stay stable across reorder | Talker slot assignment ignores reorder | RED: `AssertionError: expected [] to deeply equal [ 'a', 'b' ]` |

### Merge `origin/main` @ `361364e0`

Normal merge commit `338911cf` (no rebase). **PR #60 not merged** in the batch (branch continues). Follow-up: `683e00d5` (pack-lint baseline), `5a558512` (six new main packs on `LEGACY_DECLARE_ZOTO_PACK_IDS`, test count 23).

**Pack boundary (#112):** `python3 scripts/check_pack_pr_boundary.py origin/main HEAD --pr 60` → not a pack PR (no `plugins/src/<pack>/` changes on this branch); no split.

### Post-merge re-sweep (merge-touched ∩ PR production paths)

Full row replay on all six rows after merge tip — **still RED** on patches.

| file (merge ∩ PR) | disposition |
| --- | --- |
| `plugins/sdk/legacy-zoto-pack-allowlist.ts` | **Caught** — row **01** (allowlist length assertion updated 17→23; guard unchanged) |
| `plugins/sdk/pack-lint-baseline.json` | **Caught** — full `pack-lint.test.ts` / vitest after merge |
| `web/package.json` (`typecheck` script) | **Survived** — full vitest + pytest green with hunk reverted to `aa3bfba`; CI convenience only |
| `web/tsconfig.json` (`typecheck/**/*.ts` include) | **Survived** — same measured sweep |
| Other intersection paths (main-delivered packs + starter/sdk) | **Caught** via existing rows / full suites at `5a558512` |

Prior survivor **H007** `pack-label.ts` unchanged (visual-only).

### Parity gate (QE)

Fresh `uv` 3.12 venv (`pip`, `aiohttp`, `requirements.txt`), `/usr/bin` on `PATH`, `pnpm install` in `web/`, `service/cursor-bridge/`, `docs/` (and starter SDK path where main worktree needs it). **Gate ref: `main` @ `361364e0`.** **#60 stacked on #87 / A1.**

| ref | `pytest -o addopts=` | `vitest run` (`web/`) | `tsc --noEmit` | `pnpm build` (`web/`) |
| --- | --- | --- | --- | --- |
| **main `361364e0`** | **449 passed**, 0 failed | **705 passed**, 3 skipped | OK | OK |
| **proven `5a558512`** | **461 passed**, 0 failed | **819 passed**, 3 skipped | OK | OK |

Extra (A1 merge-base `aa3bfba`): pytest 441 passed, 1 failed (`bad_underscore`); vitest 727 passed, 3 skipped.

### Pytest raw reds (`pytest -vv`, patched rows 02/04/05)

```
E       Failed: DID NOT RAISE ValueError
```
