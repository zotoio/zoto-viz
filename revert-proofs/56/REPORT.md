## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-legacy-zoto-allowlist | src/plugins/pack-lint.test.ts :: pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard | disallowedLegacyZoto must block declare const zoto on packs not on LEGACY_DECLARE_ZOTO_PACK_IDS. | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > off-allowlist inline zoto declare fails disallowedLegacyZoto guard" | RED (expected) |
| 12-talker-slots | src/plugins/starter-template.test.ts :: pack starter template > talker slots stay stable across reorder | Talker slot assignment ignores reorder. | web/node_modules/.bin/vitest run src/plugins/starter-template.test.ts -t "pack starter template > talker slots stay stable across reorder" | RED (expected) |

### 01-legacy-zoto-allowlist

```
AssertionError: expected 0 to be greater than 0
    at /tmp/revert-proof-wt-workspace-212378/web/src/plugins/pack-lint.test.ts:317:41
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### 12-talker-slots

```
AssertionError: expected [] to deeply equal [ 'a', 'b' ]
    at /tmp/revert-proof-wt-workspace-212378/web/src/plugins/starter-template.test.ts:43:44
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-212378/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```
