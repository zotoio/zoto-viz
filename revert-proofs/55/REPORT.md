## Revert proof (PR #55)

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-legacy-allowlist-empty | src/plugins/pack-lint.test.ts :: pack lint guardrails > LEGACY_DECLARE_ZOTO_PACK_IDS is empty after getVizZoto pack migration (PR C) | LEGACY_DECLARE_ZOTO_PACK_IDS must stay empty after all shipped packs use getVizZoto(). | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > LEGACY_DECLARE_ZOTO_PACK_IDS is empty after getVizZoto pack migration (PR C)" | RED (expected) |
| 02-pack-viz-zoto-resolver-import | src/plugins/pack-lint.test.ts :: pack lint guardrails > shipped pack entries import getVizZoto via plugins/sdk/viz-zoto (PR C) | Shipped packs must value-import getVizZoto from the plugins/sdk/viz-zoto resolver specifier. | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > shipped pack entries import getVizZoto via plugins/sdk/viz-zoto (PR C)" | RED (expected) |
| 14-host-pack-src-guard | src/plugins/pack-lint.test.ts :: pack lint guardrails > host importing plugins/src outside debt allowlist fails with pack-source message | Host reverse boundary must block plugins/src imports outside HOST_PACK_SRC_IMPORT_ALLOWLIST. | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > host importing plugins/src outside debt allowlist fails with pack-source message" | RED (expected) |
| 15-host-pack-src-allowlist-count | src/plugins/pack-lint.test.ts :: pack lint guardrails > HOST_PACK_SRC_IMPORT_ALLOWLIST only shrinks (pinned debt count) | HOST_PACK_SRC_IMPORT_ALLOWLIST count is pinned so debt can only shrink. | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > HOST_PACK_SRC_IMPORT_ALLOWLIST only shrinks (pinned debt count)" | RED (expected) |

### 01-legacy-allowlist-empty

```
AssertionError: expected [ 'backrooms' ] to deeply equal []
```

### 02-pack-viz-zoto-resolver-import

```
AssertionError: expected '…' to match /from "plugins\\/sdk\\/viz-zoto"/
```

### 14-host-pack-src-guard

```
AssertionError: expected 0 to be greater than 0
```

### 15-host-pack-src-allowlist-count

```
AssertionError: expected 6 to be 7 // Object.is equality
```
