## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| console-import-error-redaction | src/plugins/plugin-pack-feed.test.ts :: plugin pack feed notices > redacts session token from boot failure console lines | Host classify/log paths must redact session token before console.warn. | web/node_modules/.bin/vitest run src/plugins/plugin-pack-feed.test.ts -t "plugin pack feed notices > redacts session token from boot failure console lines" | RED (expected) |
| csp-tight | src/plugins/host.csp.test.ts :: page CSP bootstrap policy > loads plugin sandbox from same-origin html + module (no srcdoc) | plugin-sandbox.html CSP must stay minimal (no broad connect-src to loopback hosts). | web/node_modules/.bin/vitest run src/plugins/host.csp.test.ts -t "page CSP bootstrap policy > loads plugin sandbox from same-origin html + module (no srcdoc)" | RED (expected) |
| sandbox-foreign-boot | src/plugins/sandbox-frame.security.test.ts :: sandbox-frame boot security > ignores boot postMessage from a foreign frame | Sandbox must ignore boot messages not from the parent frame. | web/node_modules/.bin/vitest run src/plugins/sandbox-frame.security.test.ts -t "sandbox-frame boot security > ignores boot postMessage from a foreign frame" | RED (expected) |
| access-logger-class | | | | **ERROR: row access-logger-class: baseline ran 0 tests (selection/filter error; never a pass)** |
| backend-404 | | | | **ERROR: row backend-404: baseline ran 0 tests (selection/filter error; never a pass)** |
| bootstrap-no-sat-query | | | | **ERROR: row bootstrap-no-sat-query: baseline ran 0 tests (selection/filter error; never a pass)** |
| dotfile-404 | | | | **ERROR: row dotfile-404: baseline ran 0 tests (selection/filter error; never a pass)** |
| multi-file-relative-imports | | | | **ERROR: row multi-file-relative-imports: baseline ran 0 tests (selection/filter error; never a pass)** |
| referrer-policy | | | | **ERROR: row referrer-policy: baseline ran 0 tests (selection/filter error; never a pass)** |
| token-expired | | | | **ERROR: row token-expired: baseline ran 0 tests (selection/filter error; never a pass)** |
| token-log-redaction | | | | **ERROR: row token-log-redaction: baseline ran 0 tests (selection/filter error; never a pass)** |
| token-pack-binding | | | | **ERROR: row token-pack-binding: baseline ran 0 tests (selection/filter error; never a pass)** |
| token-session-binding | | | | **ERROR: row token-session-binding: baseline ran 0 tests (selection/filter error; never a pass)** |
| traversal-realpath | | | | **ERROR: row traversal-realpath: baseline ran 0 tests (selection/filter error; never a pass)** |
| wrong-token-cross-pack-403 | | | | **ERROR: row wrong-token-cross-pack-403: baseline ran 0 tests (selection/filter error; never a pass)** |

### console-import-error-redaction

```
AssertionError: expected 'module.js fetch failed (network/CORS)…' not to contain 'super-secret-session-token'
    at /tmp/revert-proof-wt-workspace-20160/web/src/plugins/plugin-pack-feed.test.ts:52:24
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### csp-tight

```
AssertionError: expected '<!doctype html>\n<html lang="en">\n  …' to contain 'connect-src \'none\''
    at /tmp/revert-proof-wt-workspace-20160/web/src/plugins/host.csp.test.ts:24:21
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### sandbox-foreign-boot

```
AssertionError: expected true to be false // Object.is equality
    at /tmp/revert-proof-wt-workspace-20160/web/src/plugins/sandbox-frame.security.test.ts:24:26
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-20160/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```
