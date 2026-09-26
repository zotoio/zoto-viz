## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| letterbox-bottom-left | src/graph/pack-mirror-letterbox.test.ts :: pack mirror letterbox > places letterbox inner viewport with bottom-left origin | Letterbox inner rect uses bottom-left GL coordinates. | web/node_modules/.bin/vitest run src/graph/pack-mirror-letterbox.test.ts -t "pack mirror letterbox > places letterbox inner viewport with bottom-left origin" | RED (expected) |
| material-needs-update | src/graph/pack-mirror-lifecycle.test.ts :: PackTexturePresenter > keeps material.version stable over 300 draws with the same texture | Material needsUpdate only when map reference changes. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "PackTexturePresenter > keeps material.version stable over 300 draws with the same texture" | RED (expected) |
| mirror-frame-scope-sync | src/graph/render-host-frame-loop.test.ts :: RenderHost mirror frame loop > 300 frames without layout change: one scope sync, zero sorts, stable viewport instance | Pack/sandbox scope Maps and view sort run only when tile picks change, not every frame. | web/node_modules/.bin/vitest run src/graph/render-host-frame-loop.test.ts -t "RenderHost mirror frame loop > 300 frames without layout change: one scope sync, zero sorts, stable viewport instance" | RED (expected) |
| one-mirror-per-pack | src/graph/pack-mirror-lifecycle.test.ts :: PackMirrorSession resource lifecycle > two pack keys get two targets; dropping one duplicate leaves the other | Separate mirror session per pack group key. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "PackMirrorSession resource lifecycle > two pack keys get two targets; dropping one duplicate leaves the other" | RED (expected) |
| renderer-gate-ci-env | src/graph/pack-mirror-renderer-gate.test.ts :: pack mirror renderer gate > CI web job exports ZOTO_VIZ_EXPECT_RENDERER for SwiftShader readback | CI sets ZOTO_VIZ_EXPECT_RENDERER explicitly instead of inferring SwiftShader from CI/VM. | web/node_modules/.bin/vitest run src/graph/pack-mirror-renderer-gate.test.ts -t "pack mirror renderer gate > CI web job exports ZOTO_VIZ_EXPECT_RENDERER for SwiftShader readback" | RED (expected) |
| samples-gated-on-antialias | src/graph/pack-mirror-lifecycle.test.ts :: PackMirrorSession resource lifecycle > samples=4 only when context antialias is true | MSAA samples follow context antialias flag. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "PackMirrorSession resource lifecycle > samples=4 only when context antialias is true" | RED (expected) |
| sandbox-bitmap-close-order | src/graph/sandbox-bitmap-close.test.ts :: sandbox bitmap close order > closes bitmap only after presentBitmapMirror draws | Sandbox ImageBitmap stays open through GPU upload/present. | web/node_modules/.bin/vitest run src/graph/sandbox-bitmap-close.test.ts -t "sandbox bitmap close order > closes bitmap only after presentBitmapMirror draws" | RED (expected) |
| sandbox-bitmap-finally-close | src/graph/render-host-sandbox-bitmap.test.ts :: RenderHost sandbox bitmap present > closes a 1×1 ImageBitmap exactly once after presentBitmapMirror | presentBitmapMirror always closes ImageBitmap in a finally block (including sub-2px software skip). | web/node_modules/.bin/vitest run src/graph/render-host-sandbox-bitmap.test.ts -t "RenderHost sandbox bitmap present > closes a 1×1 ImageBitmap exactly once after presentBitmapMirror" | RED (expected) |
| sandbox-gpu-teardown | src/graph/pack-mirror-lifecycle.test.ts :: sandbox bitmap GPU scope sync > ten 2↔1 tile toggles balance creates/disposes; one tile leaves no sandbox GPU | Sandbox GPU mirrors teardown when tile count drops below two. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "sandbox bitmap GPU scope sync > ten 2↔1 tile toggles balance creates/disposes; one tile leaves no sandbox GPU" | RED (expected) |
| setSize-only-on-resize | src/graph/pack-mirror-lifecycle.test.ts :: PackMirrorSession resource lifecycle > 300 steady frames: 0 setSize; one resize: exactly 1 setSize | RenderTarget uses setSize on resize instead of reallocating every frame. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "PackMirrorSession resource lifecycle > 300 steady frames: 0 setSize; one resize: exactly 1 setSize" | RED (expected) |
| teardown-dispose-counts | src/graph/pack-mirror-lifecycle.test.ts :: PackMirrorSession resource lifecycle > teardown disposes RT, geometry, and material; single tile creates nothing | Dropping below two tiles disposes RT and quad resources. | web/node_modules/.bin/vitest run src/graph/pack-mirror-lifecycle.test.ts -t "PackMirrorSession resource lifecycle > teardown disposes RT, geometry, and material; single tile creates nothing" | RED (expected) |

### letterbox-bottom-left

```
AssertionError: expected 'import * as THREE from "three";\nimpo…' to contain 'const iy = dst.y + (dst.h - innerTd.y…'
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-letterbox.test.ts:11:17
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### material-needs-update

```
AssertionError: expected 300 to be 1 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:217:32
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### mirror-frame-scope-sync

```
AssertionError: expected 301 to be 1 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/render-host-frame-loop.test.ts:98:53
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### one-mirror-per-pack

```
AssertionError: expected 1 to be 2 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:170:57
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### renderer-gate-ci-env

```
AssertionError: expected 'name: ci\n\non:\n  push:\n  pull_requ…' to match /ZOTO_VIZ_EXPECT_RENDERER:\s*swiftshad…/
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-renderer-gate.test.ts:29:16
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### samples-gated-on-antialias

```
AssertionError: expected +0 to be 4 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:128:27
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### sandbox-bitmap-close-order

```
AssertionError: expected 11766 to be greater than 11788
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/sandbox-bitmap-close.test.ts:14:19
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### sandbox-bitmap-finally-close

```
AssertionError: expected +0 to be 1 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/render-host-sandbox-bitmap.test.ts:40:20
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### sandbox-gpu-teardown

```
AssertionError: expected 1 to be +0 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:194:52
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### setSize-only-on-resize

```
AssertionError: expected +0 to be 1 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:116:57
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### teardown-dispose-counts

```
AssertionError: expected +0 to be 1 // Object.is equality
    at /tmp/revert-proof-wt-workspace-71895/web/src/graph/pack-mirror-lifecycle.test.ts:139:54
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71895/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```
