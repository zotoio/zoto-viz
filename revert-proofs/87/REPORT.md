## Revert proof (PR #87 / A1)

**Proven code commit:** `f432472dee9e3e0baf6fcd9a9a25ef3b9bb0a928`  
**Proven tree (excludes `revert-proofs/`):** `7e28bc5a78bf38ee01c851afc8174ab7a5baa760`

```sh
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree f432472dee9e3e0baf6fcd9a9a25ef3b9bb0a928 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
# → 7e28bc5a78bf38ee01c851afc8174ab7a5baa760
```

| row | test | result |
| --- | --- | --- |
| 14-host-pack-src-guard | `pack-lint.test.ts` :: host importing plugins/src outside debt allowlist fails | RED: `AssertionError: expected 0 to be greater than 0` |
| 15-host-pack-src-allowlist-count | `pack-lint.test.ts` :: HOST_PACK_SRC_IMPORT_ALLOWLIST only shrinks | RED: `AssertionError: expected 7 to be +0 // Object.is equality` |

### Main merge note

`4c6e5087` second parent was **`3d38c536`** (tip of `origin/main` at merge time), not **`361364e0`** as intended. That brought `pinPluginTileSkies` on `planned ?? assignMosaicSkies(...)` (see `git diff 361364e0 3d38c536 -- web/src/graph/mosaic.ts`).

**`5019f4dd` (reverted on stack):** local workaround for `tsc` **TS2345** at `web/src/graph/mosaic.ts:990` — `Partial<Record<string, BackdropKind>>` not assignable to `Record<string, BackdropKind>` for `pinPluginTileSkies`. **`361364e0` typechecks** because it does not use that call shape. Gate mosaic restored from **`361364e0`** in **`f432472d`**; re-land `3d38` mosaic + main fix PR when told.

### Parity vs `361364e0` (see PR body table)

Stack pytest **457/0** after moving `bad_underscore` to **#60**.
