# Subtask: Visualisation + Modes Integration

## Metadata
- **Subtask ID**: 06
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03
- **Created**: 20260915

## Objective

Load a plugin's optional `visualisation.yml` into the frontend's
`PluginView` model (engine, base, look, style, layout, options, config)
and register it as a **catalog menu row**. Duplicate plugin ids overlay
look on the first catalog row (plugin-on-plugin). There is no hardcoded
shipped-mode menu — subtask 11 removes `MODES` from `allModes()`; until
then, keep compile paths compatible so 09 can pack zips and 11 can flip
the menu. Settings "This view" still shows plugin knobs.

## Deliverables Checklist

- [x] Extend the frontend plugin catalog loader (`web/src/plugins/plugin.ts`
      or a sibling `plugin-visualisation.ts`) to translate the raw
      `visualisation.yml` payload into a `PluginView` object that
      `web/src/core/modes.ts` can consume via the same interface it uses
      today.
- [x] Catalog vs overlay behaviour:
  - A unique `plugin.yml.id` adds a menu row.
  - A later plugin whose id matches an earlier catalog plugin applies
    look / visualisation pins only — no second menu row (plugin-on-plugin).
  - Do **not** treat host engine ids as "shipped menu modes". Subtask 11
    removes `MODES` from the live menu; tests that still assume
    `shippedModeIds()` are menu rows must be rewritten there.
  - Overlay tests live in `web/src/core/modes.test.ts` / `plugin.test.ts`
    — add coverage for the plugin-on-plugin path here; subtask 11
    deletes the shipped-mode overlay path.
- [x] Wire `visualisation.look.backdrop` through to `web/src/graph/backdrop.ts`.
      For enum values already understood, no code change. When a plugin
      wants a custom shader, defer to subtask 07 (leave a clean seam).
- [x] Make the Settings "This view" panel (`web/src/ui/settings.ts`) show
      the plugin's `options` / `config` knobs (the same way shipped modes
      expose theirs). Fall back gracefully when the plugin ships no
      `visualisation.yml`.
- [x] Route `visualisation.engine` through the real dispatch surface.
      There is **no** `switch (engine)` in `web/src/graph/scene.ts`
      today — a grep confirms `scene.ts` (117 KB) dispatches by
      `mode.graphBase` (e.g. `"wifi"`, `"bluetooth"`, `"cpu"`) and
      `mode.arcadeId` (`"doom"`, `"cpupong"`, …), and plugin frontends
      already run through `web/src/plugins/host.ts::PluginSandbox` in
      an iframe. Concrete plan:
  - Map `visualisation.engine` to the resulting `ViewMode`'s
    `graphBase` / `arcadeId` fields (existing enum), not a new
    top-level switch.
  - When the plugin ships a `frontend/` folder, the existing
    `PluginSandbox` iframe still runs it — no new engine value is
    needed for "the plugin has TS".
  - Only add a new sentinel (e.g. `graphBase: "plugin"` or a fresh
    field) if the plugin's engine cannot be expressed as a shipped
    `graphBase`/`arcadeId`. In v1, prefer to reject unknown `engine`
    values in `PluginView` construction and require plugins to pick
    a shipped engine.
  - The WIP `doom` engine registers via `arcadeId: "doom"` (see
    `web/src/core/modes.ts` arcade compile). After subtask 11, the
    `plugins/doom.zip` catalog entry **is** the Doom view wrapping that
    engine — not an overlay on a shipped mode.
- [x] Add/extend vitest coverage:
  - `web/src/plugins/plugin.test.ts` — round-trip a full
    `visualisation.yml` fixture into a `PluginView`.
  - `web/src/core/modes.test.ts` — overlay vs menu-row cases.
  - `web/src/ui/settings.test.ts` — plugin knobs appear in "This view"
    settings.

## Definition of Done

- [x] A plugin without `visualisation.yml` still loads and lights up its
      frontend/backend parts (no crash, no missing-field errors).
- [x] A plugin with `visualisation.yml` / `plugin.yml` id `topology` (or
      any former shipped view id) **is** a menu row once subtask 11
      lands. In this subtask, compiling it must still produce a valid
      `ViewMode` wrapping `GRAPH_BASES`. Do not write tests that require
      overlay-only for those ids — subtask 11 owns the menu flip.
- [x] A plugin with a new id appears as a new menu row with the correct
      icon/name.
- [x] `visualisation.options` and `visualisation.config` render in the
      "This view" settings panel.
- [x] `visualisation.look.backdrop = "plugin"` (or the sentinel chosen)
      leaves subtask 07 a clean path to inject its custom shader.
- [x] Targeted vitest passes:
      `pnpm --filter web test -- src/plugins/plugin.test.ts src/core/modes.test.ts src/ui/settings.test.ts`.

## Implementation Notes

- `web/src/core/modes.ts` and `web/src/core/modes.test.ts` are dirty in
  the current worktree — rebase carefully and preserve the WIP additions.
- The doom arcade engine stays registered as a wrap target (`arcadeId`).
  Subtask 11 makes `plugins/doom.zip` the menu row.
- `visualisation.style` / `layout` / `options` / `config` are free-form
  maps in the shipped modes; treat them the same way for plugins.
- The Settings panel already handles per-mode option rendering — hook the
  plugin path into the same code path rather than forking a new UI.

## Testing Strategy

**Targeted only.** Run:

```
pnpm --filter web test -- src/plugins/plugin.test.ts src/core/modes.test.ts src/ui/settings.test.ts
```

Full test suite is out of scope; the executor's wrap-up phase runs it.

## Execution Notes

Catalog ingest lives in `web/src/plugins/plugin-visualisation.ts` (`toPluginView`, `partitionCatalog`, `mergeOverlayPins`, `engineDispatch`). Unique plugin ids compile to `plugin:<id>` menu rows; duplicate ids overlay look/style/layout/options/config onto the first row. Host `MODES` stay in `allModes()` until subtask 11. Unknown `visualisation.engine` is rejected. `look.backdrop = "plugin"` is a BackdropKind seam for subtask 07 (no shader load here). Settings pane label is "This view" and renders plugin options+config via `pluginViewKnobs`. Plugins without visualisation.yml still load (no menu row, no crash). Scan attaches `visualisation.yml` on catalog rows.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15
- Completed: 2026-09-15

### Work Log
- Added `plugin-visualisation.ts` translator for nested/legacy visualisation payloads (array or free-form map options/config).
- `applyPluginCatalog` no longer overlays onto `shippedModeIds()`; plugin-on-plugin only.
- `setPluginModes` / `pluginMenuRows` drop duplicate `pluginId` rows.
- BackdropKind `"plugin"` added; `setKind` keeps shipped sky until 07.
- Restored `DEFAULT_DREAM` import in `settings.ts` after a parallel Physics edit dropped the scene import.
- Targeted vitest: 22 passed (`plugin.test.ts`, `modes.test.ts`, `settings.test.ts`).

### Blockers Encountered
- Parallel Phase 3: subtask 05 owns `plugin.ts` frontend flags (`has_frontend`, sandbox). Translator pass-through preserves those fields.
- `settings.ts` lost its `../graph/scene` import during a concurrent Physics pane edit; restored conservatively.

### Files Modified
- `web/src/plugins/plugin-visualisation.ts` (created)
- `web/src/plugins/plugin.ts`
- `web/src/plugins/plugin.test.ts`
- `web/src/plugins/plugin-ui.ts`
- `web/src/core/modes.ts`
- `web/src/core/modes.test.ts`
- `web/src/ui/settings.ts`
- `web/src/ui/settings.test.ts`
- `web/src/graph/backdrop.ts`
- `web/src/graph/backdrop.test.ts`
- `service/plugins.py`
- `tests/test_plugins.py`
