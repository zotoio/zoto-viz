## Revert proof (PR #60)

**Proven code commit:** `9f520e623ea5408659eb268ef1ffbebe307df626`  
**Proven tree:** `176f7d43a8fae8c4f0d04a88cf5f7db298d13b48`

(SHAs from `git rev-parse <commit>` and `git rev-parse <commit>^{tree}` on the proven code revision.)

Patches apply at zero offset; unpatched node passes; patched node fails with the sidecar `patchedFailure` line.

| row | test | revert description | result |
| --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | `src/plugins/pack-lint.test.ts` :: pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto blocks declare const zoto off allowlist | RED (expected) |
| 02-pack-id-hyphen-slug | `tests/test_plugin_id_pattern.py::test_schema_rejects_nonconforming_plugin_ids[bad_underscore]` | Hyphen-only pack id schema (no `_` in slug) | RED: `AssertionError: DID NOT RAISE ValueError` |
| 03-plugin-sky-swiftshader-launch | `src/plugins/plugin-sky-smoke-render.test.ts` :: plugin sky smoke render > plugin sky smoke browser launch opts in SwiftShader for GPU-less CI | `ignoreDefaultArgs: ['--disable-software-rasterizer']` + SwiftShader args on `chromium.launch` | RED: `AssertionError: expected undefined to deeply equal [ '--disable-software-rasterizer' ]` |
| 12-talker-slots | `src/plugins/starter-template.test.ts` :: pack starter template > talker slots stay stable across reorder | Talker slot assignment ignores reorder | RED (expected) |

**Row 02 (not a byte-revert within #60):** widening to `^[a-z][a-z0-9_-]{0,31}$` landed in **`daf696a`** (`fix(pr56): …`, PR **#56** / guardrails stack) and is already on the A2 merge-base (**#87 / A1**). PR **#60** narrows those schema lines to `^[a-z0-9][a-z0-9-]*$`; the revert patch is a real regression guard, not zero-net on #60.

### Non-regression (proven commit)

Parity: `cd service/cursor-bridge && pnpm install`, repo `.venv` (Python 3.12) with `requirements.txt`, `cd web && pnpm install` for main worktree scans.

| suite | result |
| --- | --- |
| `python3 -m pytest -o addopts=` (proven tree) | **443 passed**, 0 failed |
| `python3 -m pytest -o addopts=` (main `6520b01`, same parity) | **433 passed**, 0 failed |
| `pnpm exec vitest run` (`web/`) | 777 passed, 0 failed, 3 skipped |
| `starter-pack-ci.test.ts` + `plugin-sky-smoke-render.test.ts` | 9/9 passed |

### 01-legacy-zoto-allowlist

```
AssertionError: expected 0 to be greater than 0
    at web/src/plugins/pack-lint.test.ts:317:41
```

### 12-talker-slots

```
AssertionError: expected [] to deeply equal [ 'a', 'b' ]
    at web/src/plugins/starter-template.test.ts:43:44
```
