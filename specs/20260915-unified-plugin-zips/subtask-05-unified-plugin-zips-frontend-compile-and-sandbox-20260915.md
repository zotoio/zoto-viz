# Subtask: Frontend Compile + Sandbox

## Metadata
- **Subtask ID**: 05
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03
- **Created**: 20260915

## Objective

Wire the unified format's `frontend/` folder through the existing esbuild
+ iframe-sandbox pipeline: read TypeScript from
`plugins/.runtime/<id>/frontend/`, serve the compiled bundle at
`/plugins/<id>/module.js`, and preserve the current capability allowlist.

## Deliverables Checklist

- [x] Update the plugin frontend host in `web/src/plugins/plugin.ts`
      **and** the iframe sandbox in `web/src/plugins/host.ts` (the
      `PluginSandbox` class — `web/src/app/host.ts` does **not** exist;
      the previous draft named the wrong file) to load
      `/plugins/<id>/module.js` for every plugin that ships a
      `frontend/` folder. No behavioural change to the sandbox — same
      iframe, same `postMessage` bridge, same capability allowlist.
- [x] Update the backend HTTP handler that serves plugin modules to point
      at `plugins/.runtime/<id>/frontend/` instead of the legacy
      `~/.zoto-viz/plugins/<id>/` path. Compile on demand with esbuild the
      same way the current code path does; cache keyed on plugin sha256 +
      entry file mtime.
- [x] Add `MIME` + `Cache-Control` headers consistent with the existing
      response (immutable, hashed URL if practical).
- [x] Extend the `/plugins` payload to include:
  - `has_frontend: bool`
  - `frontend.entry: str` (derived from `plugin.yml` `frontend.entry` or
    default `frontend/index.ts`)
  - `capabilities: []` (unchanged wire shape)
  - `has_sky: bool`, `has_sky_shader: bool`, `has_backend: bool`,
    `has_datasource: bool` for subtasks 06/07 to consume.
- [x] Update `web/src/plugins/plugin.test.ts` **and**
      `web/src/plugins/host.test.ts` to cover the new payload shape and
      the iframe-load path (no live server needed — mock the fetch
      response). `host.test.ts` exists today and asserts the current
      sandbox wiring; keep its coverage green.
- [x] Add or extend a backend test (`tests/test_plugin_frontend.py` if new
      or fold into `tests/test_plugins.py`) that hits
      `/plugins/<id>/module.js`, confirms the compile happens, and confirms
      a re-request without changes short-circuits to the cache.

## Definition of Done

- [x] A plugin with a `frontend/index.ts` compiles + loads inside the
      iframe sandbox exactly as today's agent-plugin frontends do.
- [x] `capabilities` allowlist is enforced (mismatched capability request
      from a plugin still rejected — no regression against
      `web/src/plugins/plugin.test.ts`).
- [x] The `/plugins` payload advertises the new optional-part booleans;
      plugins without `frontend/` no longer appear as broken.
- [x] `pnpm --filter web test -- src/plugins/plugin.test.ts src/plugins/host.test.ts` passes.
- [x] `pnpm exec pytest tests/test_plugin_frontend.py -q` (or the target
      module you touched) passes.

## Implementation Notes

- The current code path lives in `web/src/plugins/plugin.ts` +
  `web/src/plugins/host.ts` (the `PluginSandbox` class). `plugin.ts` is
  dirty in the current worktree; `host.ts` is clean today but the
  frontend loader change lands there. Rebase carefully; do not lose the
  iframe sandbox wiring.
- Keep the "capability" shape from the agent-plugin schema — subtask 01
  copied it into `plugin.schema.json` verbatim.
- Do not change `web/src/plugins/plugin.test.ts` structure; just adjust
  fixtures and the assertions that depend on the payload shape.
- Sky shader (`sky/fragment.glsl`) is served from subtask 07's
  implementation — do not implement it here, but leave hooks in the
  payload so 07 can drop into place.
- Do not break the WIP arcade engine (`web/src/arcade/doom.ts` and
  friends) — it consumes the same plugin loader path.

## Testing Strategy

**Targeted only.** Run:

```
pnpm --filter web test -- src/plugins/plugin.test.ts
pnpm exec pytest tests/test_plugin_frontend.py -q   # or the module you extended
```

Full test suite is out of scope for this subtask.

## Execution Notes

Compiled `plugins/.runtime/<id>/frontend/` (default entry `frontend/index.ts`,
legacy `runtime: typescript` + `entry` still works) with esbuild. Served at
`GET /api/plugins/<id>/module.js` with `text/javascript`, CSP lock-down,
`X-Zoto-Viz-Hash`, `Cache-Control: no-store` (or `immutable` when `?h=<digest>`
matches). Catalog payload now includes `has_frontend`, `frontend.entry`,
`capabilities`, `has_sky`, `has_sky_shader`, `has_backend`, `has_datasource`.
Iframe sandbox (`allow-scripts`, srcdoc, postMessage, capability allowlist) is
unchanged. Sky shader bytes are advertised but not served (subtask 07).

Merged conservatively with parallel subtask 06: `toPluginView` now copies the
optional-part booleans; did not rewrite `modes.ts`.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15T07:39:09.925Z
- Completed: 2026-09-15T07:46:00Z

### Work Log
- Heartbeat in_progress; token_budget 200000.
- Backend: `compile_typescript` keys cache on plugin sha256 + entry mtime;
  `optional_part_flags` on scan; `api_module` short-circuits via `_bundle_fresh`.
- Frontend: `PluginSandbox.loadModule` fetches module.js; `attachPluginFrontend`
  in plugin.ts; `main.ts` loadTsPlugin uses `pluginHasFrontend`.
- Tests: vitest 12 passed; pytest 16 passed.

### Blockers Encountered
None.

### Files Modified
- `service/plugins.py`
- `web/src/plugins/host.ts`
- `web/src/plugins/plugin.ts`
- `web/src/plugins/plugin-visualisation.ts`
- `web/src/plugins/plugin.test.ts`
- `web/src/plugins/host.test.ts`
- `web/src/plugins/plugin-ui.ts`
- `web/src/app/main.ts`
- `tests/test_plugin_frontend.py` (created)
