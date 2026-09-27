# PR #42 split A — revert proof report

- **Base:** `6520b014472c05f831ac5204429be2affb8473cb` (`main`)
- **Stack A:** `cursor/wall-duplicate-pack-tiles-d355`
- **Stack A1.5:** `#86` `cursor/host-pixel-lifecycle-revert-rows-d355-e7d4` (pack-mirror letterbox + coalesce production and harness)
- **Stack A2:** `#81` `cursor/pack-mirror-readback-harness-d355` (frame-alloc / coalesce unit tests on the mirror stack)

## Size (vs `origin/main`, excluding `revert-proofs/`)

Run after push: `git diff origin/main --stat -- . ':(exclude)revert-proofs'`

## Commands (`web/`)

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm build
pnpm exec vitest run
pnpm lint
```

## Scope (this PR)

Design **(b)** viewport: `RenderHost` device-px canvas, renderer `getPixelRatio()` 1, layout DPR cap 1.5 via `render-host-device-px-ratio.ts`, `pack-mirror-rect` brands, `render-host-gl-adapter`, lint (`lint-brand-casts.mjs`), stage3d/feed/pane-change routing.

Pack-mirror letterbox, coalesce, lifecycle presenter, and pixel-material helpers ship on **#86** only.

## Revert rows (A)

| Row | expectedRed (patched) |
|-----|------------------------|
| `render-host-gpu-viewport-css-revert` | `expected [ 3, 40, 226, 136 ] to deeply equal [ 2, 87, 151, 91 ]` |
| `render-host-gpu-viewport-css-dpr2-cap-revert` | `expected 2 to be 1.5 // Object.is equality` |
| `pack-mirror-capture-rounding` | `expected { x: 1, y: 87, w: 152, h: 92, …(1) } to deeply equal { x: 2, y: 87, w: 151, h: 91, …(1) }` |
| `pack-mirror-brand-cast` | lint: stray `as DeviceRect` in `render-host-gl-adapter.ts` |
| `device-px-ratio-read-stray` | lint: stray `devicePixelRatio` read in `fps.ts` |

**Dropped from A (moved to #86 or removed):** all letterbox/coalesce/mosaic-tile rows, `render-host-fb-viewport-h241` (clamp moved to #86), `present-pack-args-identity` (#81).
