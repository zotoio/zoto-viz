# Revert-proofs archive (#128 catch-up)

[Contributing — regression tests](./contributing.md#regression-tests) describes the day-to-day process. This page is the map for **catch-up PRs consolidated in [#128](https://github.com/zotoio/zoto-viz/pull/128)** whose `revert-proofs/<N>/` trees were **not** left on `main`.

## Policy after option **(a)**

- **New PRs** (after the catch-up lands): merge your `revert-proofs/<PR>/` folder onto `main` with the product change, same as before #128.
- **Catch-up rows below**: proofs live only on the frozen GitHub ref — fetch `refs/pull/<N>/head` (or use the **proven commit** SHA in the table). `git ls-files revert-proofs` on `main` keeps only the pre-catch-up baseline folders **`102/`**, **`112/`**, and **`95/`** (see `git ls-files revert-proofs`).

Replay on a machine with the repo cloned:

```bash
git fetch origin pull/<N>/head:refs/pull/<N>/head
node scripts/revert-proof.mjs <N> --replay
```

The CI self-test (`scripts/revert-proof-ci-selftest.sh`) builds its **own** temp fixture repo and does **not** read `revert-proofs/` from the workspace checkout.

## Catch-up PRs — proof location

Each row had a `revert-proofs/<N>/` tree on its PR branch. That tree is **not** on `main`; use **`refs/pull/<N>/head`** (points at the proven commit when the ref is fetched).

| PR | Proven commit (frozen PR tip) | Where to replay |
|----|-------------------------------|-----------------|
| 17 | `e078a313` | `refs/pull/17/head` |
| 23 | `99403e2a` | `refs/pull/23/head` |
| 24 | `e1015977` | `refs/pull/24/head` |
| 25 | `c2ae9034` | `refs/pull/25/head` |
| 31 | `579a8d64` | `refs/pull/31/head` |
| 35 | `064e37db` | `refs/pull/35/head` (absorbed by #60/#87 on catch-up) |
| 36 | `2a324846` | `refs/pull/36/head` |
| 37 | `738732c2` | `refs/pull/37/head` |
| 40 | `3c7ce2b2` | `refs/pull/40/head` |
| 42 | `97cb811c` | `refs/pull/42/head` |
| 43 | `1a6616ac` | `refs/pull/43/head` |
| 47 | `787c47cb` | `refs/pull/47/head` |
| 48 | `7de11b01` | `refs/pull/48/head` |
| 53 | `1d0819f4` | `refs/pull/53/head` |
| 55 | `f2f95f4e` | `refs/pull/55/head` |
| 56 | `8bcae43c` | `refs/pull/56/head` |
| 60 | `9744d26c` | `refs/pull/60/head` |
| 61 | `398f40be` | `refs/pull/61/head` |
| 62 | `cd0d8658` | `refs/pull/62/head` |
| 63 | `f5356000` | `refs/pull/63/head` |
| 65 | `d08ba475` | `refs/pull/65/head` |
| 67 | `0a361e8f` | `refs/pull/67/head` |
| 68 | `00c6ab83` | `refs/pull/68/head` |
| 69 | `3d866557` | `refs/pull/69/head` |
| 70 | `a5df8c10` | `refs/pull/70/head` |
| 71 | `8c00d084` | `refs/pull/71/head` |
| 73 | `83bfa56b` | `refs/pull/73/head` |
| 74 | `5029e2bc` | `refs/pull/74/head` |
| 75 | `b19fa7a6` | `refs/pull/75/head` |
| 76 | `859ae499` | `refs/pull/76/head` |
| 77 | `4c8a40a2` | `refs/pull/77/head` |
| 79 | `8694047e` | `refs/pull/79/head` |
| 81 | `ce1c637e` | `refs/pull/81/head` |
| 82 | `75d52f1d` | `refs/pull/82/head` |
| 83 | `ced85fad` | `refs/pull/83/head` |
| 85 | `5ae86dc9` | `refs/pull/85/head` |
| 86 | `dd4ca422` | `refs/pull/86/head` |
| 87 | `469a2c57` | `refs/pull/87/head` |
| 88 | `2ba676ec` | `refs/pull/88/head` |
| 89 | `dee4f7eb` | `refs/pull/89/head` |
| 90 | `40c90ace` | `refs/pull/90/head` |
| 91 | `518c0597` | `refs/pull/91/head` |
| 92 | `a9bf8e1a` | `refs/pull/92/head` |
| 93 | `edd3eaa2` | `refs/pull/93/head` |
| 94 | `36d9039c` | `refs/pull/94/head` |
| 96 | `301ebc75` | `refs/pull/96/head` |
| 101 | `a69a925d` | `refs/pull/101/head` |
| 103 | `d2ca5a14` | `refs/pull/103/head` |
| 104 | `fe37a909` | `refs/pull/104/head` |
| 105 | `8ad331a5` | `refs/pull/105/head` |
| 106 | `1bdd8c3c` | `refs/pull/106/head` |
| 107 | `d9c27b55` | `refs/pull/107/head` |
| 108 | `d8fac576` | `refs/pull/108/head` |
| 109 | `0b5c8142` | `refs/pull/109/head` |
| 110 | `15c39c4b` | `refs/pull/110/head` |
| 111 | `d52a5630` | `refs/pull/111/head` |
| 113 | `281f8f19` | `refs/pull/113/head` |
| 114 | `73a04b23` | `refs/pull/114/head` |
| 115 | `ba059863` | `refs/pull/115/head` |
| 116 | `908447fd` | `refs/pull/116/head` |
| 117 | `9eb8558b` | `refs/pull/117/head` |
| 121 | *(absorbed, closed)* | — |

Proven commits are the **frozen PR tips** recorded at catch-up consolidation (4:29pm Sydney, 2026-09-27). To inspect files without replay: `git show <sha>:revert-proofs/<N>/…`.

## On `main` today

- **Shipped on `main`:** `revert-proofs/102/`, `revert-proofs/112/`, `revert-proofs/95/` only.
- **Not on `main`:** every `revert-proofs/<N>/` in the table above (including **#48**, **#104**, **#105**, **#117**, and the rest of the catch-up set).

## Related checks

- `scripts/check_pack_pr_boundary.py` — pack PRs may touch only `revert-proofs/<their PR>/`.
- `tests/test_pack_pr_boundary.py` — path rules only (no on-disk trees required).
- `scripts/revert-proof-ci-selftest.sh` — head/base vitest bundle; temp fixtures, fail-closed on missing replay records.
