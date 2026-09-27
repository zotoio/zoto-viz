## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| boot-reconcile-focused-slot | src/app/boot-view-restore.test.ts :: reconcileMosaicTilesWithMode > replaces the focused slot when mode is missing from tiles | Revert reconcileMosaicTilesWithMode replacing focused slot | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^reconcileMosaicTilesWithMode > replaces the focused slot when mode is missing from tiles$" --reporter=json --outputFile.json=<tmp> src/app/boot-view-restore.test.ts | RED (expected) |
| boot-session-over-local | src/app/boot-view-restore.test.ts :: resolveRestoredViewMode > prefers session snapshot over localStorage | Revert session mode winning over localStorage on boot | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^resolveRestoredViewMode > prefers session snapshot over localStorage$" --reporter=json --outputFile.json=<tmp> src/app/boot-view-restore.test.ts | RED (expected) |
| consent-block-generic | src/app/apply-mode-mosaic.test.ts :: consentBlockMessage > uses generic copy when the plugin name is unknown | Revert generic Settings → Plugins consent copy | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^consentBlockMessage > uses generic copy when the plugin name is unknown$" --reporter=json --outputFile.json=<tmp> src/app/apply-mode-mosaic.test.ts | RED (expected) |
| consent-block-named | src/app/apply-mode-mosaic.test.ts :: consentBlockMessage > names the plugin when available | Revert consentBlockMessage naming the plugin pack | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^consentBlockMessage > names the plugin when available$" --reporter=json --outputFile.json=<tmp> src/app/apply-mode-mosaic.test.ts | RED (expected) |
| consent-notice-settings-plugins | src/app/mosaic-consent-resume.test.ts :: mosaic consent resume > shows Settings → Plugins approval copy on the tile | Revert inline tile notice on consent deny | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic consent resume > shows Settings → Plugins approval copy on the tile$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-consent-resume.test.ts | RED (expected) |
| consent-pending-on-deny | src/app/mosaic-consent-resume.test.ts :: mosaic consent resume > registers a pending tile pick when consent is denied | Revert registerConsentPending on consent deny | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic consent resume > registers a pending tile pick when consent is denied$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-consent-resume.test.ts | RED (expected) |
| consent-post-catalog-resume | src/app/mosaic-consent-resume.test.ts :: grantPluginConsent then catalog refresh > simulates POST /consent updating catalog before resume | Revert clearing pending after catalog consent resume | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^grantPluginConsent then catalog refresh > simulates POST /consent updating catalog before resume$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-consent-resume.test.ts | RED (expected) |
| consent-resume-all-tiles | src/app/mosaic-consent-resume.test.ts :: grantPluginConsent then catalog refresh > resumes every waiting tile for the same pack after one approval | Revert multi-tile consent resume after one approval | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^grantPluginConsent then catalog refresh > resumes every waiting tile for the same pack after one approval$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-consent-resume.test.ts | RED (expected) |
| consent-resume-external-approve | src/app/mosaic-consent-resume.test.ts :: mosaic consent resume > retries through switchPaneView when consent appears (external approve) | Revert resumePendingConsentPaneSwitches retry loop | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic consent resume > retries through switchPaneView when consent appears \\(external approve\\)$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-consent-resume.test.ts | RED (expected) |
| consent-sync-one-poll | src/app/plugin-consent-sync.test.ts :: plugin consent sync (one page subscription) > arms one shared fallback poll for many waiting tiles | Revert single shared consent fallback poll | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^plugin consent sync \\(one page subscription\\) > arms one shared fallback poll for many waiting tiles$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-sync.test.ts | RED (expected) |
| consent-sync-one-refresh | src/app/plugin-consent-sync.test.ts :: plugin consent sync (one page subscription) > after 10s idle issues one catalog refresh, not one per tile | Revert shared catalog refresh interval while tiles wait | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^plugin consent sync \\(one page subscription\\) > after 10s idle issues one catalog refresh, not one per tile$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-sync.test.ts | RED (expected) |
| consent-sync-stop-poll | src/app/plugin-consent-sync.test.ts :: plugin consent sync (one page subscription) > stops the shared poll when no tiles are waiting | Revert disarming consent poll when pending clears | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^plugin consent sync \\(one page subscription\\) > stops the shared poll when no tiles are waiting$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-sync.test.ts | RED (expected) |
| header-digit-mode-map | src/app/mosaic-keyboard.test.ts :: header keyboard view shortcuts > maps number keys to catalog modes like the live keydown handler | Revert digit key → mode mapping for header shortcuts | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^header keyboard view shortcuts > maps number keys to catalog modes like the live keydown handler$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-keyboard.test.ts | RED (expected) |
| mosaic-focus-stale-fallback | src/app/apply-mode-mosaic.test.ts :: mosaicFocusSlot > falls back when focus is stale after a tile close | Revert mosaicFocusSlot ignoring stale focusedId off the wall | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaicFocusSlot > falls back when focus is stale after a tile close$" --reporter=json --outputFile.json=<tmp> src/app/apply-mode-mosaic.test.ts | RED (expected) |
| mosaic-focus-valid-id | src/app/apply-mode-mosaic.test.ts :: mosaicFocusSlot > keeps a valid focus id on the wall | Revert mosaicFocusSlot keeping focused tile on the wall | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaicFocusSlot > keeps a valid focus id on the wall$" --reporter=json --outputFile.json=<tmp> src/app/apply-mode-mosaic.test.ts | RED (expected) |
| panel-view-swap-no-csp-violation | src/graph/panel-view-switch.test.ts :: mosaic panel view switch teardown > emits no securitypolicyviolation during 20 back-and-forth pane view swaps | Revert releasePanelView on mosaic setPaneView swap | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic panel view switch teardown > emits no securitypolicyviolation during 20 back-and-forth pane view swaps$" --reporter=json --outputFile.json=<tmp> src/graph/panel-view-switch.test.ts | RED (expected) |
| plugin-consent-live-merge | src/app/plugin-consent-live.test.ts :: mergePluginConsentLivePatch > merges WebSocket pluginConsent onto catalog rows | Revert mergePluginConsentLivePatch updating catalog consent | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mergePluginConsentLivePatch > merges WebSocket pluginConsent onto catalog rows$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-live.test.ts | RED (expected) |
| prompt-never-before-catalog | src/app/plugin-consent-mount.test.ts :: shouldPromptPluginReview > never prompts before catalog consent is loaded | Revert shouldPromptPluginReview waiting for catalogReady | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^shouldPromptPluginReview > never prompts before catalog consent is loaded$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-mount.test.ts | RED (expected) |
| prompt-skip-when-approved | src/app/plugin-consent-mount.test.ts :: shouldPromptPluginReview > does not prompt when every pack is already approved | Revert shouldPromptPluginReview skipping reviewed packs | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^shouldPromptPluginReview > does not prompt when every pack is already approved$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-mount.test.ts | RED (expected) |
| prompt-when-missing-consent | src/app/plugin-consent-mount.test.ts :: shouldPromptPluginReview > prompts only after catalog is ready and consent is missing | Revert shouldPromptPluginReview when consent missing | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^shouldPromptPluginReview > prompts only after catalog is ready and consent is missing$" --reporter=json --outputFile.json=<tmp> src/app/plugin-consent-mount.test.ts | RED (expected) |
| reload-header-mode-persisted | src/app/mosaic-view-reload.test.ts :: mosaic view reload regressions (B/C/D/E) > B: 1× reload keeps header and main mode aligned via persisted zoto-viz.mode | Revert resolveRestoredViewMode preferring persisted mode on reload | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic view reload regressions \\(B/C/D/E\\) > B: 1× reload keeps header and main mode aligned via persisted zoto-viz\\.mode$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-view-reload.test.ts | RED (expected) |
| reload-header-swaps-focused-tile | src/app/mosaic-view-reload.test.ts :: mosaic view reload regressions (B/C/D/E) > C: header pick swaps the focused tile (not header-only) | Revert switchPaneView swapping focused mosaic tile on header pick | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic view reload regressions \\(B/C/D/E\\) > C: header pick swaps the focused tile \\(not header-only\\)$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-view-reload.test.ts | RED (expected) |
| reload-neighbour-teardown-only-from | src/app/mosaic-view-reload.test.ts :: mosaic view reload regressions (B/C/D/E) > D: neighbour pane pick does not teardown the focused tile view | Revert conditional teardown only for retired tile ids | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic view reload regressions \\(B/C/D/E\\) > D: neighbour pane pick does not teardown the focused tile view$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-view-reload.test.ts | RED (expected) |
| reload-reconcile-backrooms-slot | src/app/mosaic-view-reload.test.ts :: mosaic view reload regressions (B/C/D/E) > E: reload restores Backrooms on the focused slot when mode and tiles diverged | Revert reconcileMosaicTilesWithMode on reload tile restore | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic view reload regressions \\(B/C/D/E\\) > E: reload restores Backrooms on the focused slot when mode and tiles diverged$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-view-reload.test.ts | RED (expected) |
| revert-mode-selection-restore | src/app/apply-mode-mosaic.test.ts :: revertModeSelection > restores header mode and liveMode | Revert revertModeSelection restoring liveMode on deny | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^revertModeSelection > restores header mode and liveMode$" --reporter=json --outputFile.json=<tmp> src/app/apply-mode-mosaic.test.ts | RED (expected) |
| settings-mosaic-pick-delegates-hook | src/app/mosaic-view-reload.test.ts :: mosaic view reload regressions (B/C/D/E) > pane picker delegates through the live hook and persists layout | Revert settings mosaic slot delegating to onMosaicPanePick | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^mosaic view reload regressions \\(B/C/D/E\\) > pane picker delegates through the live hook and persists layout$" --reporter=json --outputFile.json=<tmp> src/app/mosaic-view-reload.test.ts | RED (expected) |
| switch-pane-header-deny | src/app/switch-pane-view.test.ts :: switchPaneView > entry header > denies consent without swapping or mounting | Revert consent deny blocking header swap | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry header > denies consent without swapping or mounting$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-header-succeeds | src/app/switch-pane-view.test.ts :: switchPaneView > entry header > succeeds through teardown, swap, and mount | Revert switchPaneView mount after header pick | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry header > succeeds through teardown, swap, and mount$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-header-swap-from-focus | src/app/switch-pane-view.test.ts :: switchPaneView > entry header > uses focus fallback when the requested tile id is stale | Revert header swap-from focused slot when view not on wall | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry header > uses focus fallback when the requested tile id is stale$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-latest-double-switch | src/app/switch-pane-view.test.ts :: switchPaneView > applies only the latest rapid double-switch on the same pane | Revert pane switch generation tokens coalescing rapid picks | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > applies only the latest rapid double-switch on the same pane$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-skip-teardown-when-tiled | src/app/switch-pane-view.test.ts :: switchPaneView > does not teardown the from-view when it remains tiled after a swap | Revert skip teardown when swapped-from id stays on wall | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > does not teardown the from-view when it remains tiled after a swap$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-tile-deny | src/app/switch-pane-view.test.ts :: switchPaneView > entry tile > denies consent without swapping or mounting | Revert consent deny blocking tile swap | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry tile > denies consent without swapping or mounting$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-tile-stale-from | src/app/switch-pane-view.test.ts :: switchPaneView > entry tile > uses focus fallback when the requested tile id is stale | Revert stale fromViewId falling back to focused tile | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry tile > uses focus fallback when the requested tile id is stale$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |
| switch-pane-tile-succeeds | src/app/switch-pane-view.test.ts :: switchPaneView > entry tile > succeeds through teardown, swap, and mount | Revert switchPaneView mount after tile pick | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^switchPaneView > entry tile > succeeds through teardown, swap, and mount$" --reporter=json --outputFile.json=<tmp> src/app/switch-pane-view.test.ts | RED (expected) |

### boot-reconcile-focused-slot

```
AssertionError: expected [ 'plugin:topology', 'plugin:wifi' ] to deeply equal [ 'plugin:backrooms', 'plugin:wifi' ]
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### boot-session-over-local

```
AssertionError: expected 'plugin:talkers' to be 'plugin:backrooms' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### consent-block-generic

```
AssertionError: expected 'Not approved yet.' to be 'Not approved yet. Approve it in Setti…' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### consent-block-named

```
AssertionError: expected 'Not approved yet. Approve it in Setti…' to be 'Not approved yet. Heat map: Approve i…' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### consent-notice-settings-plugins

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:a', …(1) ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### consent-pending-on-deny

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### consent-post-catalog-resume

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:heat' ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### consent-resume-all-tiles

```
AssertionError: expected "vi.fn()" to be called 3 times, but got 0 times
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### consent-resume-external-approve

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:heat' ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### consent-sync-one-poll

```
AssertionError: expected "setInterval" to be called 1 times, but got 0 times
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### consent-sync-one-refresh

```
AssertionError: expected +0 to be 1 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
```

### consent-sync-stop-poll

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### header-digit-mode-map

```
AssertionError: expected 'plugin:topology' to be 'plugin:talkers' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### mosaic-focus-stale-fallback

```
AssertionError: expected 'plugin:topology' to be 'plugin:talkers' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### mosaic-focus-valid-id

```
AssertionError: expected 'plugin:talkers' to be 'plugin:wifi' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### panel-view-swap-no-csp-violation

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### plugin-consent-live-merge

```
AssertionError: expected null to be 'reviewed' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### prompt-never-before-catalog

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### prompt-skip-when-approved

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### prompt-when-missing-consent

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### reload-header-mode-persisted

```
AssertionError: expected 'plugin:topology' to be 'plugin:backrooms' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### reload-header-swaps-focused-tile

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### reload-neighbour-teardown-only-from

```
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### reload-reconcile-backrooms-slot

```
AssertionError: expected 'plugin:kefrens' to be 'plugin:backrooms' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### revert-mode-selection-restore

```
AssertionError: expected 'broken' to be 'plugin:topology' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### settings-mosaic-pick-delegates-hook

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:topology', …(1) ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
```

### switch-pane-header-deny

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:topology', …(1) ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### switch-pane-header-succeeds

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:talkers' ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### switch-pane-header-swap-from-focus

```
AssertionError: expected 'plugin:topology' to be 'plugin:wifi' // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### switch-pane-latest-double-switch

```
AssertionError: expected true to be false // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### switch-pane-skip-teardown-when-tiled

```
AssertionError: expected [ [ 'plugin:topology' ] ] to have a length of +0 but got 1
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### switch-pane-tile-deny

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:topology', …(1) ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### switch-pane-tile-stale-from

```
AssertionError: expected false to be true // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### switch-pane-tile-succeeds

```
AssertionError: expected "vi.fn()" to be called with arguments: [ 'plugin:talkers' ]

Number of calls: 0

    at Proxy.<anonymous> (file://<tmp>
    at Proxy.<anonymous> (file://<tmp>
    at Proxy.methodWrapper (file://<tmp>
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```
