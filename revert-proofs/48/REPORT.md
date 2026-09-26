## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| production-only-guard | scripts/revert-proof.test.ts :: patch touching test files is rejected | Disable production-only patch validation | web/node_modules/.bin/vitest run scripts/revert-proof.test.ts -t "patch touching test files is rejected" | RED (expected) |
| stays-green-guard | | | | **ERROR: row stays-green-guard: patch breaks build or fails without assertion (proves nothing)** |

### production-only-guard

```
AssertionError: expected 'git apply --check failed: error: corr…' to match /row touch-test.*test files/i
    at /tmp/revert-proof-wt-workspace-16136/scripts/revert-proof.test.ts:233:33
    at file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///workspace/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```
