# Subtask: Shipped Views Become Plugins

## Metadata
- **Subtask ID**: 11
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 06, 09
- **Created**: 20260915

## Objective

The view menu is the plugin catalog. Host TypeScript keeps **engines**
(graph bases + arcade renderers); it no longer ships a hardcoded `MODES`
menu. Every former shipped view is a catalog plugin (`plugins/src/<id>/`
+ `plugins/<id>.zip`) that selects an engine. Duplicate plugin ids overlay
look on the first catalog row — they do not overlay a built-in mode,
because there are no built-in modes.

## Deliverables Checklist

- [ ] **Host engines, not menu rows.** Keep the graph-base `ViewMode`
      implementations (`topology`, `talkers`, `services`, `protocols`,
      `layers`, `watch`, `cores`/`cpu`, `load`, `wifi`, `bluetooth`) and
      arcade engines (`netpong`, `invaders`, `command`, `frogger`,
      `cpupong`, `doom` in `web/src/arcade/`) as wrap targets. Stop
      exporting them as the live menu via `MODES`.
      - `web/src/core/modes.ts`: `MODES` becomes empty (or is deleted).
        `allModes()` returns **only** `pluginModes`.
      - `GRAPH_BASES` remains the wrap table plugins compile against
        (includes wifi, bluetooth, and the `cpu` alias of cores).
      - `GRAPH_MODES` is derived from catalog graph plugins, not from
        hardcoded `MODES`.
- [ ] **Default catalog = former shipped views.** After subtask 09's
      migration, these plugins **are** the views (menu rows), not
      look-only overlays. Required ids matching today's `MODES` array:
      `topology`, `talkers`, `services`, `protocols`, `layers`, `watch`,
      `netpong`, `invaders`, `command`, `frogger`, `cores`, `load`,
      `cpupong`, `doom`. RF wrappers `air-ssid` and `air-bt` stay catalog
      plugins wrapping `wifi` / `bluetooth` bases (those bases stay
      off-menu unless wrapped). Extra examples (`lan-heat`, `lan-pong`,
      `pulse-ts`, `lan-pulse`) remain additional catalog rows.
- [ ] **Duplicate-id overlay (plugin-on-plugin).** If a later zip shares
      an id already in the catalog, apply look / visualisation pins to
      the existing row — no second menu entry. Tests in
      `web/src/plugins/plugin.test.ts` and `web/src/core/modes.test.ts`
      replace "id matches shipped mode" with "id matches an earlier
      catalog plugin".
- [ ] **Fallbacks.** `modeById` must not hard-code `topology`.
      Missing / empty catalog: do not crash; empty menu; last-used mode
      from profiles is used only if that id is still in the catalog,
      otherwise the first catalog plugin (sorted stably, topology first
      when present). Scene default mode follows the same rule.
- [ ] **Consent.** YAML-only catalog views (no `frontend/`, no
      `backend/`, no `sky/fragment.glsl`, no collector) skip source
      review so the default install does not pop a consent modal for
      Topology. Executable extras (`pulse-ts`, `lan-pulse`) keep the
      existing consent path.
- [ ] **Tests to rewrite** (targeted):
      - `web/src/core/modes.test.ts` — no longer asserts `MODES[0] ===
        topology`; asserts catalog-driven `allModes()` / `modeById`
        fallback.
      - `web/src/plugins/plugin.test.ts` — `shippedModeIds()` either
        disappears or means "host engine ids", not menu ids.
        `viewSelectOptions()` for topology comes from the catalog plugin.
      - `web/src/core/profiles.test.ts` — default mode is the catalog
        topology plugin (or first catalog id).
      - `tests/test_plugin_catalog.py` — default catalog contains the
        14 former `MODES` ids as **menu** plugins (not overlay-only).

## Definition of Done

- [ ] Booting a stock checkout with the packed `plugins/*.zip` catalog
      shows the same view list users get today (the 14 former shipped
      views plus RF wrappers and extras).
- [ ] `MODES` is not concatenated into `allModes()`. Removing
      `plugins/topology.zip` (in a test harness) removes Topology from
      the menu; the host engine for `base: topology` still exists for
      other plugins to wrap.
- [ ] Duplicate-id overlay is plugin-on-plugin only.
- [ ] Empty catalog does not throw; `modeById("missing")` does not
      assume a hardcoded topology menu row.
- [ ] YAML-only default views do not require plugin consent.
- [ ] Targeted tests pass:
      `pnpm --filter web test -- src/core/modes.test.ts src/plugins/plugin.test.ts src/core/profiles.test.ts`
      and `pnpm exec pytest tests/test_plugin_catalog.py -q`.

## Implementation Notes

- The hook-heavy graph bases (prepare / nodeColor / layout / overlays)
  stay in `web/src/core/modes.ts`. v1 plugins do not reimplement those
  hooks in the iframe; they **select** a base via `visualisation.yml`.
  Moving hook bodies into `frontend/` is out of scope.
- Arcade canvases stay in `web/src/arcade/*`. A plugin with
  `engine: doom` sets `arcadeId: "doom"` and `standalone: true` the same
  way `compileArcade` does today.
- `web/src/graph/scene.ts` currently defaults `this.mode = topology`.
  Point that at the catalog default (or a host-engine stub that is not
  a menu row) so an empty catalog still constructs a Scene.
- Profiles (`web/src/core/profiles.ts`) persist `mode: "topology"` —
  keep the string id; it now names a plugin, not a hardcoded `MODES`
  entry.
- WIP doom: host arcade TS remains; `plugins/src/doom/` is the menu
  entry. Coordinate with subtask 09 — after this subtask, doom is a
  catalog view wrapping the arcade engine, not an overlay on a shipped
  mode.
- Keyboard / mosaic / dream cycling that iterate `MODES` or `GRAPH_MODES`
  must iterate `allModes()` / catalog graph plugins instead.

## Testing Strategy

**Targeted only.** Run the vitest files and `tests/test_plugin_catalog.py`
listed in the Definition of Done. Do not run the full suite here.

## Execution Notes

Shipped views are catalog plugins. Host TypeScript keeps GRAPH_BASES + ARCADE_ENGINES as wrap targets; `allModes()` is catalog-only. Duplicate ids overlay plugin-on-plugin. Empty catalog does not throw; `modeById` falls back to default catalog (topology first) then the topology host-engine stub. YAML-only views skip consent.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T08:28:34Z
- Completed: 2026-09-15T08:33:00Z

### Work Log
- Deleted live `MODES` / `GRAPH_MODES` concatenation. `GRAPH_BASES` + `ARCADE_ENGINES` remain wrap tables. `graphModes()` is catalog graph plugins. `compilePlugin` wraps `hostEngine()`, not menu rows.
- Keyboard / mosaic / dream cycling iterate `allModes()` / `graphModes()`. Scene still boots on the topology host stub. Profiles keep `mode: "topology"` with an empty catalog and `plugin:topology` when that zip is loaded. Last-used ids resolve by `pluginId` so old profiles still work.
- `pluginNeedsReview` treats YAML-only views as consented; `has_backend` / `has_datasource` join the executable path.

### Blockers Encountered
None.

### Files Modified
- `web/src/core/modes.ts`, `web/src/core/modes.test.ts`
- `web/src/plugins/plugin.ts`, `web/src/plugins/plugin.test.ts`
- `web/src/core/profiles.ts`, `web/src/core/profiles.test.ts`
- `web/src/app/main.ts`, `web/src/graph/mosaic.ts`, `web/src/graph/scene.ts`
- `tests/test_plugin_catalog.py`

### Tests
- `cd web && pnpm test -- src/core/modes.test.ts src/plugins/plugin.test.ts src/core/profiles.test.ts` — 140 passed (35 files; filter forwarded as extra args, full web suite green)
- `.venv/bin/python3 -m pytest tests/test_plugin_catalog.py -q -o addopts=` — 5 passed

