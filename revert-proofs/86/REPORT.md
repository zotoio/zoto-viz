# PR #86 — revert proof report

- **Base:** `cursor/wall-duplicate-pack-tiles-d355` @ `80be948`
- **Branch:** `cursor/host-pixel-lifecycle-revert-rows-d355-e7d4`

## Per-hunk sweep vs `80be948`

Measured remove-one-hunk sweep (production hunks only): **102** hunks — **56** CAUGHT, **45** SURVIVED, **1** obsolete (fixture path relocated). Full table lives in the PR body artifact (`pr86-body.md` on the agent run), not in-repo.

## Hygiene: no pack-mirror sandbox scaffolding

`SandboxBitmapGl` was **deleted outright** from `pack-mirror-gl.ts` (not moved to `test-support`, no stub). No revert row referenced it. Pack-mirror tests use production types only (`PackMirrorRegistry`, `PackTexturePresenter`, `renderPrimary` / lifecycle paths). `pack-mirror-quadrant-fixture.ts` was also removed (unused). Graphics-context / sandbox readback harness work stays out of #86 until Andrew’s design lands.
