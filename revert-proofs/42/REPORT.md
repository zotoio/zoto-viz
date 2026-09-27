# PR #42 split A — revert proof report

- **Base:** `main`
- **Branch:** `cursor/wall-duplicate-pack-tiles-d355`
- **Stack A1.5:** #86 pack-mirror letterbox + coalesce (separate PR)

## Size (vs `main`, excluding `revert-proofs/`)

Run: `git diff origin/main --stat -- . ':(exclude)revert-proofs'`

## Gates (`web/`, Node 22, `PATH=/workspace/.venv/bin:$PATH`)

```bash
cd web && pnpm exec tsc --noEmit && pnpm exec tsc -p tsconfig.test.json --noEmit && pnpm build
PATH="/workspace/.venv/bin:$PATH" pnpm exec vitest run
cd .. && PATH="/workspace/.venv/bin:$PATH" .venv/bin/pytest -o addopts=
```

## Revert rows (14 sidecars)

| row | kind | test |
|-----|------|------|
| device-px-ratio-change-1-to-2-revert | vitest | render-host-layout-dpr-getter (b) |
| device-px-ratio-change-resize-without-cap-revert | vitest | render-host-layout-dpr-getter (c) |
| device-px-ratio-getter-window-prop-read-revert | vitest | render-host-layout-dpr-getter (a) |
| device-px-ratio-rearm-stale-revert | vitest | render-host-layout-dpr-getter (e) |
| device-px-ratio-read-stray | lint | lint-brand-casts > lint gate: no stray devicePixelRatio reads in production |
| pack-mirror-brand-cast | lint | lint-brand-casts > lint gate: brand casts only in mint modules |
| pack-mirror-capture-rounding | vitest | render-host-fb-viewport |
| render-host-dispose-layout-dpr-unsub-revert | vitest | render-host-dispose-layout-dpr |
| render-host-gpu-viewport-css-dpr2-cap-revert | vitest | render-host-gpu-viewport-css |
| render-host-gpu-viewport-css-revert | vitest | render-host-gpu-viewport-css |
| render-host-layout-dpr-feed-dpr2-revert | vitest | render-host-layout-dpr-surfaces |
| render-host-layout-dpr-legacy-stage3d-175-revert | vitest | render-host-layout-dpr-surfaces |
| render-host-set-pixel-ratio-auto-tune-revert | vitest | render-host-set-pixel-ratio |
| render-host-software-present-brand-revert | vitest | render-host-software-present |

Lint rows: patch reverts a rule in `lint-brand-casts-core.mjs`; patched red is `expected +0 to be 1 // Object.is equality` on the in-test sample gate (see sidecar `expectedRed`). Production tree uses `expect(violations).toEqual([])` with `file:rule` lines.

## Scope

Design **(b)** viewport: layout DPR cap 1.5, `render-host-device-px-ratio.ts`, `pack-mirror-rect` brands, `render-host-gl-adapter`, lint. Pack-mirror letterbox/coalesce on **#86** only.
