## Revert proof (PR #60)

**Proven code commit:** `b136ca12e9c5719509b563a0bd81274464b469a7`  
**Proven tree (excludes `revert-proofs/`):** `72fe32cd3744f953276b954719e18a21a725f241`

Proven tree from:

```sh
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree b136ca12e9c5719509b563a0bd81274464b469a7 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
# → 72fe32cd3744f953276b954719e18a21a725f241
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

### Parity gate (QE)

Fresh `uv` 3.12 venv (`pip`, `aiohttp`, `requirements.txt`), `/usr/bin` on `PATH`, `pnpm install` in `web/`, `service/cursor-bridge/`, `docs/`. **#60 is stacked on #87**; `main` at `7c5e686f` already includes #87 relative to the A1-only line.

| ref | `pytest -o addopts=` | `vitest run` | `tsc --noEmit` (`web/`) | `pnpm build` (`web/`) |
| --- | --- | --- | --- | --- |
| **main `7c5e686f`** (gate) | **443 passed**, 0 failed | 701 passed, 3 skipped | OK | OK |
| **proven `b136ca12`** | **445 passed**, 0 failed | 777 passed, 3 skipped | OK | OK |

Extra (A1 merge-base `aa3bfba`): pytest 441 passed, 1 failed (`bad_underscore`); vitest 727 passed, 3 skipped.

### Pytest raw reds (`pytest -vv`, patched rows 02/04/05)

```
E       Failed: DID NOT RAISE ValueError
```
