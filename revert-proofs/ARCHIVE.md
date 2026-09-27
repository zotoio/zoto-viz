# revert-proofs archive (catch-up consolidation)

Per catch-up policy **option (b)**, per-PR `revert-proofs/<N>/` trees are **not** shipped on `cursor/catchup-consolidation`. Auditors replay rows from GitHub using each PR’s frozen tip and `refs/pull/<N>/head`.

| PR | Frozen tip (merge into catch-up) | Replay ref |
|----|-----------------------------------|------------|
| 36 | `2a32484624f4055ed75e1d3c465995b35f7a5863` | `refs/pull/36/head` |
| 42 | `85a052f4` | `refs/pull/42/head` |
| 48 | *(not in catch-up)* | `refs/pull/48/head` |
| 60 | `9744d26c` | `refs/pull/60/head` |
| 73 | `83bfa56b` | `refs/pull/73/head` |
| 83 | `ced85fad` | `refs/pull/83/head` |
| 86 | `dd4ca422` | `refs/pull/86/head` |
| 87 | `469a2c57` | `refs/pull/87/head` |
| 88 | `2ba676ec` | `refs/pull/88/head` |
| 91 | `728cef11` | `refs/pull/91/head` |
| 103 | `b1d764f2` | `refs/pull/103/head` |
| 110 | `15c39c4b` | `refs/pull/110/head` |
| 113 | `281f8f19` | `refs/pull/113/head` |
| 114 | `73a04b23` | `refs/pull/114/head` |
| 115 | `ba059863` | `refs/pull/115/head` |
| 116 | `908447fd` | `refs/pull/116/head` |
| 117 | `9eb8558b` | `refs/pull/117/head` |

## In-repo references kept

- `scripts/check_pack_pr_boundary.py` — validates `revert-proofs/<pr>/` paths on pack PRs (string rules only).
- `tests/test_pack_pr_boundary.py` — fixture paths under `revert-proofs/` as **test strings**, not shipped trees.
- `scripts/replay-revert-rows-117.py` — expects `revert-proofs/117/` at a PR checkout; run against `refs/pull/117/head`, not this branch.

## Expected red

- **#48** own-folder / base-gate checks may still fail on catch-up because `revert-proofs/48/` is intentionally absent here (replay from GitHub).
