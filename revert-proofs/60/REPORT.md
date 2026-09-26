## Revert proof (PR #60)

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | src/plugins/pack-lint.test.ts :: pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto must block declare const zoto on packs not on LEGACY_DECLARE_ZOTO_PACK_IDS. | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard" | RED (expected) |
| 12-talker-slots | src/plugins/starter-template.test.ts :: pack starter template > talker slots stay stable across reorder | Talker slot assignment ignores reorder. | web/node_modules/.bin/vitest run src/plugins/starter-template.test.ts -t "pack starter template > talker slots stay stable across reorder" | RED (expected) |

### Non-regression (no revert row; covered by vitest/pytest in PR #60)

| suite | tests | notes |
| --- | ---: | --- |
| plugins/sdk/talker-slots.test.ts | 24 | SDK slot resize/assign invariants + reference parity |
| web/src/plugins/starter-template.test.ts | 11 | starter template mapping, sim, scan, shader contract |
| web/src/plugins/starter-pack-ci.test.ts | 6 | lint, service compile (9556-byte bundle), draw/regression smokes |
| web/src/plugins/pack-host-bundle.test.ts | 3 | host srcdoc + getVizZoto bundle under iframe |
| web/src/plugins/pack-bundle-resolve.test.ts | 3 | bundle-pack-entry boundary resolver fixtures |
| tests/test_plugin_compile_node.py | 1 | compile_typescript invokes bundle-pack-entry.mjs via cursor_agent.node_bin |

**Total:** 48 automated cases in this PR (47 vitest + 1 python compile wiring). Draw/regression CI cases skip when python/playwright deps are missing.

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
