# Revert-proofs archive (catch-up option **b**)

Catch-up consolidation **does not ship** per-PR `revert-proofs/<N>/` trees (except what already exists on pod baseline `f332f102` — see `git ls-files revert-proofs`). Auditors replay rows from each PR’s frozen tip via **`refs/pull/<N>/head`**.

| PR | Frozen head (4:29pm) | Replay ref |
|----|----------------------|------------|
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
| 91 | `728cef11` | `refs/pull/91/head` |
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

## Catch-up option **(b)** — tracked tree vs pod baseline `f332f102`

After merges, `git ls-files revert-proofs` on the catch-up head must be **empty** or **byte-identical** to the same listing at **`f332f102`**. Catch-up restores baseline folders only: **`102/`**, **`112/`**, **`95/`** (113 files). Merged PRs **must not** leave their `revert-proofs/<N>/` trees on the branch — replay those rows from **`refs/pull/<N>/head`**.

No `revert-proofs/48/` on catch-up — **#48** `head-tree-exclude` / own-proofs-folder rows **PASS** (product `REVERT_PROOF_TREE_KEY_EXCLUDE_REVERT_PROOFS` applies without shipping `revert-proofs/48/`).

## Scripts

- `scripts/check_pack_pr_boundary.py` — path rules only (string `revert-proofs/<pr>/`).
- `tests/test_pack_pr_boundary.py` — synthetic paths, not on-disk trees.
- `scripts/replay-revert-rows-117.py` — no-op when `revert-proofs/117/` is not **git-tracked**; run on `refs/pull/117/head`.

## Proofs only on GitHub refs (not in `git ls-files revert-proofs` on catch-up)

Every PR in the table above whose proof rows are not under baseline **`102`**, **`112`**, or **`95`** — including **#48**, **#104**, **#105**, **#117**, and all other open catch-up PRs with `revert-proofs/<N>/` on their frozen tips.
