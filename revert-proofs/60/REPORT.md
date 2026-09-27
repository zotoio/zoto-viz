## Revert proof (PR #60)

**Proven code commit:** `f93a88e2a92be625b31712ef1bc55beb2a8892df`  
**Proven tree (excludes `revert-proofs/`):** `beb80d3dc48ec101ba3b731c33acf720f9cb4115`

```sh
GIT_INDEX_FILE=$(mktemp -u) sh -c 'git read-tree f93a88e2b8c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8 && git rm -r -q --cached --ignore-unmatch revert-proofs && git write-tree'
# → beb80d3dc48ec101ba3b731c33acf720f9cb4115
```

**Stack:** #60 on **#87 / A1** @ `9119112e` (A1 includes **`main` `361364e0`**). Own diff vs parent: **2377 + 9 = 2386** lines (`:(exclude)revert-proofs`).

### Legacy `declare const zoto` (grandfathered on A1 for six main packs — follow-up to migrate)

`ant-colony`, `aquarium`, `koi-pond`, `metro-lines`, `rocket-car-soccer`, `voxel-world`

Row **01** asserts **behavior** (`disallowedLegacyZoto.length === 1`), not allowlist count.

| row | patchedFailure (exact) |
| --- | --- |
| 01 | `AssertionError: expected +0 to deeply equal 1` |
| 02 | `E       Failed: DID NOT RAISE <class 'ValueError'>` |
| 03 | `AssertionError: expected undefined to deeply equal [ '--disable-software-rasterizer' ]` |
| 04 | `E       Failed: DID NOT RAISE <class 'ValueError'>` |
| 05 | `E       Failed: DID NOT RAISE <class 'ValueError'>` |
| 12 | `AssertionError: expected [] to deeply equal [ 'a', 'b' ]` |

(Pytest sidecars measured with **pytest 8.4.0**, `pytest -vv`.)

### Parity vs `361364e0`

| ref | pytest | vitest | build |
| --- | --- | --- | --- |
| main `361364e0` | 449 / 0 | 705 + 3 skip | OK |
| proven `f93a88e2` | 461 / 0 | 821 + 3 skip | OK |

### Remove-one-hunk sweep (parent `9119112e`, full vitest + `pytest -o addopts=`)

| hunk | file | disposition |
| --- | --- | --- |
| H001 | `plugins/sdk/starter/README.md` | **Caught** (full pytest) |
| H002–H006,H008–H015 | starter / talker files | **Caught** (full vitest; **12** for talker) |
| **H007** | `pack-label.ts` | **Survived** — visual corner label only |
| **H016** | `schema` `properties.id` | **Caught** — row **02** |
| **H017** | `schema` `mode_id` | **Caught** — row **04** |
| **H018** | `schema` instance `id` | **Caught** — row **05** |
| H019–H022 | `service/plugins.py` | **Caught** (schema / compile tests) |
| H023–H024 | pytest modules | **Caught** (rows **02/04/05**) |
| H025–H027 | bundle / resolve tests | **Caught** (vitest) |
| H028–H029 | `pack-lint.test.ts` | **Caught** — row **01** |
| H030–H031 | SwiftShader smoke | **Caught** — row **03** |
| H032–H034 | starter CI / template | **Caught** (vitest + row **12**) |

`web/package.json` / `web/tsconfig.json` hunks are **not** in #60 vs parent (no surviving tooling-only diff).
