# Revert-proofs archive (#128 catch-up)

[Contributing — regression tests](./contributing.md#regression-tests) describes the day-to-day process.

## Policy after option **(a)**

- **New PRs**: merge `revert-proofs/<PR>/` on `main` with the product change.
- **Catch-up audit set (61 PRs)**: consolidated in [#128](https://github.com/zotoio/zoto-viz/pull/128); most proof trees are **not** on `main`. Use **`refs/pull/<N>/head`** and the **proven commit** below, or **no revert proof**.
- **On `main`:** baseline `revert-proofs/102/`, `112/`, `95/` only.

```bash
git fetch origin pull/<N>/head:refs/pull/<N>/head
node scripts/revert-proof.mjs <N> --replay
```

CI `scripts/revert-proof-ci-selftest.sh` uses **temp fixtures** (not checkout `revert-proofs/`).

## Catch-up audit table (61 PRs)

| PR | Summary | Proven commit / proof |
|----|---------|------------------------|
| #6 | Honest viz skip accounting | **no revert proof** |
| #12 | Ship Backrooms plugin | **no revert proof** |
| #13 | zoto/viz-test skill | **no revert proof** |
| #14 | viz-test visible Chrome / golden idle | **no revert proof** |
| #15 | Autoconsent for plugin source review | **no revert proof** |
| #16 | Remote plugin catalog + screensaver inhibit | **no revert proof** |
| #17 | Backrooms pack: presentTick director drive and pack-local sfx | `e078a313` — `refs/pull/17/head` |
| #23 | Adaptive render-scale governor (per-tile, host uniforms, off by default) | `99403e2a` — `refs/pull/23/head` |
| #24 | Fractal 3D zoom plugin (pod binding) | `e1015977` — `refs/pull/24/head` |
| #25 | Sandbox CSP bootstrap, mosaic consent order, and panel view teardown | `c2ae9034` — `refs/pull/25/head` |
| #31 | Empty-panel tile health: detect blank tiles and heal automatically | `579a8d64` — `refs/pull/31/head` |
| #36 | Fractal-zoom host | `2a324846` — `refs/pull/36/head` |
| #37 | Mode switch coordinator, pack-consent, host sky compile tests | `738732c2` — `refs/pull/37/head` |
| #40 | ci(test): gate on every needs.result via toJSON + jq | `3c7ce2b2` — `refs/pull/40/head` |
| #42 | Layout DPR / viewport (design b) — capped layout device pixel ratio | `97cb811c` — `refs/pull/42/head` |
| #43 | Per-view host golden merge with demo labels (idle) | `1a6616ac` — `refs/pull/43/head` |
| #47 | Tetris host-idle fixture feed and viz clock merge | `787c47cb` — `refs/pull/47/head` |
| #48 | Revert-proof runner: string reds, strict apply, E2E self-test | `7de11b01` — `refs/pull/48/head` |
| #53 | Keep settings drawer on screen at laptop widths (#51) | `1d0819f4` — `refs/pull/53/head` |
| #55 | Pack guardrails PR C: getVizZoto() across 17 packs | `f2f95f4e` — `refs/pull/55/head` |
| #60 | Split A2 of #35 — host mosaic / catalog | `9744d26c` — `refs/pull/60/head` |
| #61 | Pack mirror readback harness + renderer gate (stack B) | `398f40be` — `refs/pull/61/head` |
| #62 | Backend plugin settings schema and validation (#38 split A) | `cd0d8658` — `refs/pull/62/head` |
| #67 | Manifest-blocked catalog (#38 split B) | `0a361e8f` — `refs/pull/67/head` |
| #68 | Staging settings_check (#38 split C) | `00c6ab83` — `refs/pull/68/head` |
| #69 | Split E: host wiring + item 14 (#38) | `3d866557` — `refs/pull/69/head` |
| #70 | Settings drawer UI (#38 split D2) | `a5df8c10` — `refs/pull/70/head` |
| #71 | Plugin settings engine (#38 split D1) | `8c00d084` — `refs/pull/71/head` |
| #73 | Wall duplicate pack tiles + revert proofs | `83bfa56b` — `refs/pull/73/head` |
| #74 | ci(#45a): pack-boundary secure gate and CI needs hardening | `5029e2bc` — `refs/pull/74/head` |
| #75 | workBudget policy and sandbox init delivery (#45c) | `b19fa7a6` — `refs/pull/75/head` |
| #76 | Count-budget dogfood gates (#45b) | `859ae499` — `refs/pull/76/head` |
| #77 | Marble-run workBudget consumer (#45d) | `4c8a40a2` — `refs/pull/77/head` |
| #79 | Sandbox MessageChannel boot and pack-asset frontend (33b) | `8694047e` — `refs/pull/79/head` |
| #81 | Pack mirror readback harness (42-A2) | `ce1c637e` — `refs/pull/81/head` |
| #82 | Backdrop: photo cache prune, crossfade, reduced-motion video | `75d52f1d` — `refs/pull/82/head` |
| #83 | Stale CSRF refresh + wall restart notice | `ced85fad` — `refs/pull/83/head` |
| #85 | test: revert-proof integration self-test suite (stacked on #48) | `5ae86dc9` — `refs/pull/85/head` |
| #86 | Pack mirror lifecycle rows on stacked #42 fixes | `dd4ca422` — `refs/pull/86/head` |
| #87 | Split A1 of #35 | `469a2c57` — `refs/pull/87/head` |
| #88 | Shader failure fallback: host pack hook, shared 5s refresh | `2ba676ec` — `refs/pull/88/head` |
| #91 | PR B: pack install retry UX + safe zip boundary | `728cef11` — `refs/pull/91/head` |
| #92 | Cypher CIC session panels + settings (#27b) | `a9bf8e1a` — `refs/pull/92/head` |
| #93 | Adapters, HUD, scope/tick, empty-links (#27c) | `edd3eaa2` — `refs/pull/93/head` |
| #94 | Viz frame collector + link index (#27a) | `36d9039c` — `refs/pull/94/head` |
| #96 | Dogfood soak 52a: nixie wall clocks, mosaic host, render path | `301ebc75` — `refs/pull/96/head` |
| #101 | test(dogfood): deterministic fat-LAN live soak under fake timers | `a69a925d` — `refs/pull/101/head` |
| #103 | Pane consent, switch-pane-view, main wiring (#33b rebuild) | `d2ca5a14` — `refs/pull/103/head` |
| #104 | revert-proof / workflow CI chain (excluded from #128 merge) | `fe37a909` — `refs/pull/104/head` |
| #105 | revert-proof / workflow CI chain (excluded from #128 merge) | `8ad331a5` — `refs/pull/105/head` |
| #106 | revert-proof / workflow CI chain (excluded from #128 merge) | `1bdd8c3c` — `refs/pull/106/head` |
| #107 | Dogfood soak 52b (replaces #98) | `d9c27b55` — `refs/pull/107/head` |
| #108 | Dogfood soak 52c (replaces #97) | `d8fac576` — `refs/pull/108/head` |
| #109 | Pane mosaic hooks, settings live pick (#33a upper) | `0b5c8142` — `refs/pull/109/head` |
| #110 | B-stage: StagedPack validator path (option a) | `15c39c4b` — `refs/pull/110/head` |
| #111 | dogfood soak 52n: nixie-clock pack changes | `d52a5630` — `refs/pull/111/head` |
| #113 | Media-ask dialog focus | `281f8f19` — `refs/pull/113/head` |
| #114 | Pack install blocks and bundle boundaries (91b) | `73a04b23` — `refs/pull/114/head` |
| #115 | MCP plugin install pipeline parity (91c) | `ba059863` — `refs/pull/115/head` |
| #116 | Mosaic duplicate pack tiles, plugin-wall, host bindings (PR-B) | `908447fd` — `refs/pull/116/head` |
| #117 | main.ts entry harness and revert-proof rows | `9eb8558b` — `refs/pull/117/head` |

## #128 branch pins (not in the 61-PR audit set)

- **33a** — Rebuild branch (dep for #79) (frozen tip —)
- **skies-10** — Photo sky JPEG assets (frozen tip `1e36cdb6`)

## Other #128 exclusions

- **#35** — closed; absorbed as **#60** + **#87**.
- **#63** — not shipped on catch-up.
- **#121** — superseded on catch-up.

## Related checks

- `scripts/check_pack_pr_boundary.py` — only `revert-proofs/<own PR>/` on pack PRs.
- `revert-proofs/131/` on this CI fix PR — strict QE rows for fail-closed replay and option-b isolation.
