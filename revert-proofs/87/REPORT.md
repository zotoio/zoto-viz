## Revert proof (PR #87 / A1)

**Proven code commit:** `5019f4dd3993961538907f7b90edb1b5b5935b00`  
**Proven tree (excludes `revert-proofs/`):** `499afb833a7dcb45ad0f94ed87b7f1844d0e7b0f`

```sh
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree 5019f4dd3993961538907f7b90edb1b5b5935b00 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
# → 499afb833a7dcb45ad0f94ed87b7f1844d0e7b0f
```

| row | test | result |
| --- | --- | --- |
| 14-host-pack-src-guard | `pack-lint.test.ts` :: host importing plugins/src outside debt allowlist fails | RED: `AssertionError: expected 0 to be greater than 0` |
| 15-host-pack-src-allowlist-count | `pack-lint.test.ts` :: HOST_PACK_SRC_IMPORT_ALLOWLIST only shrinks | RED: `AssertionError: expected 7 to be +0 // Object.is equality` |

### Merge `origin/main` @ `361364e0`

Normal merge `4c6e5087`; follow-up `f8b41c44` (legacy zoto allowlist + baseline), `5019f4dd` (mosaic `tsc`).

### Parity vs `361364e0`

| ref | pytest | vitest | `tsc` / build |
| --- | --- | --- | --- |
| **main `361364e0`** | 449 / 0 | 705 + 3 skip | OK |
| **proven `5019f4dd3993961538907f7b90edb1b5b5935b00`** | 457 passed, **1 failed** (`bad_underscore`; strict schema in stacked **#60**) | 771 + 3 skip | OK |
