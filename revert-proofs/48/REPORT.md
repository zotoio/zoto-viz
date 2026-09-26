## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| production-only-guard | scripts/revert-proof.test.ts :: revert-proof runner (fixture repo) > (c) patch touching test files is rejected | Disable production-only patch validation | web/node_modules/.bin/vitest run scripts/revert-proof.test.ts -t "revert-proof runner (fixture repo) > (c) patch touching test files is rejected" | RED (expected) |
| stays-green-guard | scripts/revert-proof.dogfood.test.ts :: revert-proof dogfood guards > stays-green guard rejects patched green vitest runs | Remove stays-green failure guard so noop reverts are accepted | web/node_modules/.bin/vitest run scripts/revert-proof.dogfood.test.ts -t "revert-proof dogfood guards > stays-green guard rejects patched green vitest runs" | RED (expected) |

### production-only-guard

```
AssertionError: expected 'row touch-test: git apply --check fai…' to match /row touch-test.*test files/i
    at /tmp/revert-proof-wt-workspace-71849/scripts/revert-proof.test.ts:379:33
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### stays-green-guard

```
AssertionError: expected [Function] to throw an error
    at Proxy.<anonymous> (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/index.OVGXnVRj.js:2277:114)
    at Proxy.<anonymous> (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/index.OVGXnVRj.js:1934:14)
    at Proxy.methodWrapper (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/chai@6.2.2/node_modules/chai/index.js:1700:25)
    at /tmp/revert-proof-wt-workspace-71849/scripts/revert-proof.dogfood.test.ts:6:64
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-71849/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
```
