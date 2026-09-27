# PR #86 — revert proof report

- **Base:** `cursor/wall-duplicate-pack-tiles-d355` @ `80be948`
- **Branch:** `cursor/host-pixel-lifecycle-revert-rows-d355-e7d4`

## Per-hunk sweep vs `80be948`

See `SWEEP-HUNKS.md` (134 hunks, one line per hunk).

## Hygiene: no pack-mirror sandbox scaffolding

`SandboxBitmapGl` was **deleted outright** from `pack-mirror-gl.ts` (not moved to `test-support`, no stub). No revert row referenced it. Pack-mirror tests use production types only (`PackMirrorRegistry`, `PackTexturePresenter`, `renderPrimary` / lifecycle paths). `pack-mirror-quadrant-fixture.ts` was also removed (unused). Graphics-context / sandbox readback harness work stays out of #86 until Andrew’s design lands.
