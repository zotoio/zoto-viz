## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| 01-legacy-allowlist-empty | src/plugins/pack-lint.test.ts :: pack lint guardrails > LEGACY_DECLARE_ZOTO_PACK_IDS is empty after getVizZoto pack migration (PR C) | LEGACY_DECLARE_ZOTO_PACK_IDS must stay empty after all shipped packs use getVizZoto(). | web/node_modules/.bin/vitest run src/plugins/pack-lint.test.ts -t "pack lint guardrails > LEGACY_DECLARE_ZOTO_PACK_IDS is empty after getVizZoto pack migration (PR C)" | RED (expected) |

### 01-legacy-allowlist-empty

```
AssertionError: expected [ 'backrooms' ] to deeply equal []
    at /tmp/revert-proof-wt-workspace-242407/web/src/plugins/pack-lint.test.ts:326:42
    at file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-242407/web/node_modules/.pnpm/vitest@5.0.0_@types+node@26.6.3_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2__cd86b0886755f88653b5034258bb29ac/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```
