## Revert proof (PR #60)

Re-proved on head `24520cb9f16d0b106175013f2451a14d03f51102` (2026-09-27): patches apply at zero offset; unpatched tests pass; patched tests fail as below.

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | src/plugins/pack-lint.test.ts :: pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto must block declare const zoto on packs not on LEGACY_DECLARE_ZOTO_PACK_IDS. | `pnpm exec vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard"` | RED (expected) |
| 12-talker-slots | src/plugins/starter-template.test.ts :: pack starter template > talker slots stay stable across reorder | Talker slot assignment ignores reorder. | `pnpm exec vitest run src/plugins/starter-template.test.ts -t "pack starter template > talker slots stay stable across reorder"` | RED (expected) |

### Non-regression (no revert row; covered by vitest/pytest in PR #60)

| suite | tests | notes |
| --- | ---: | --- |
| plugins/sdk/talker-slots.test.ts | 24 | SDK slot resize/assign invariants + reference parity |
| web/src/plugins/starter-template.test.ts | 11 | starter template mapping, sim, scan, shader contract |
| web/src/plugins/starter-pack-ci.test.ts | 6 | lint, service compile (9556-byte bundle), draw/regression smokes |
| web/src/plugins/plugin-sky-smoke-render.test.ts | 2 | SwiftShader WebGL2 availability + mini shader smoke |
| web/src/plugins/pack-host-bundle.test.ts | 3 | host srcdoc + getVizZoto bundle under iframe |
| web/src/plugins/pack-bundle-resolve.test.ts | 3 | bundle-pack-entry boundary resolver fixtures |
| tests/test_plugin_compile_node.py | 1 | compile_typescript invokes bundle-pack-entry.mjs via cursor_agent.node_bin |

**Total:** 50 automated cases in this PR (49 vitest + 1 python compile wiring). Starter draw/regression tests require python3 + esbuild on PATH (`skipIf` only when those are missing).

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
