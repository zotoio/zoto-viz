# Subtask: Custom Sky Shader

## Metadata
- **Subtask ID**: 07
- **Feature**: Unified Plugin Zips
- **Assigned Subagent**: generalPurpose
- **Dependencies**: 03, 06
- **Created**: 20260915

## Objective

Let a plugin ship a custom GLSL fragment shader as its far-field sky.
Serve `sky/fragment.glsl` from the runtime cache, compile it into the
existing WebGL2 backdrop pipeline (`web/src/graph/backdrop.ts`), coexist
with shipped skies + AI Dynamic, and gate compilation behind the same
source-review consent used for TypeScript / Python — extended so the
stamp includes the shader's sha256.

## Deliverables Checklist

- [ ] Backend:
  - Serve `plugins/.runtime/<id>/sky/fragment.glsl` at
    `/plugins/<id>/sky/fragment.glsl` with `text/x-shader` (or
    `text/plain; charset=utf-8`) and short-lived cache headers tied to the
    zip sha256.
  - Extend the consent stamp to record the shader sha256 alongside
    frontend + backend hashes so edits invalidate consent.
  - Fail closed: if `sky/fragment.glsl` exists but consent is missing,
    the `/plugins` payload marks the plugin's sky as unavailable and the
    frontend falls back to the current shipped sky.
- [ ] **Freeze the plugin shader uniform contract** (matches the entry
      subtask 01 adds to `schema/plugin.schema.json`). Plugin
      `sky/fragment.glsl` may declare and read **only** these uniforms:
  - `uniform float uTime;` — the backdrop's animation clock (seconds).
  - `uniform float uOpacity;` — 0..1 (from the shipped sky pipeline).
  - `uniform float uBright;` — 0..1 brightness scale.
  - `uniform float uAudio;` — 0..1 pulse level.
  - `uniform vec3  uAccent;` — role accent colour (linear RGB).
  - `uniform vec3  uBg;` — background colour (linear RGB).
  - Varying `in vec3 vDir;` from the shipped vertex program.
  - **Not** exposed: `uMode` (shipped enum index —
    implementation-specific), `uMotif / uA / uB / uWarp / uGrain /
    uBands` (AI Dynamic's private state), any three.js uniform names
    (`projectionMatrix`, `modelViewMatrix`, `cameraPosition`, …).
  - Reject at compile time (regex the source before compile, or use
    a WebGL introspection pass) any declaration of a non-whitelisted
    uniform. Fail closed: the plugin's sky becomes "compile error" and
    the shipped default renders.
- [ ] Frontend:
  - Add `backdrop.setPluginShader({ id, source })` (name approximate) to
    `web/src/graph/backdrop.ts`. Simplest implementation: build a new
    `THREE.ShaderMaterial` from the plugin fragment plus the shipped
    `VERT`, bind the whitelisted uniforms only, and swap it in on the
    existing sphere `mesh` when `setPluginShader` is active; restore
    the shipped `mat` when the plugin sky is deactivated. This
    minimises WebGL state changes and does not disturb `sky-ai.ts`.
  - Route selection through the sentinel added in subtask 06 (e.g.
    `visualisation.look.backdrop = "plugin"` → activate the plugin's
    shader).
  - Do **not** remove or short-circuit the existing shipped-sky branch or
    the AI Dynamic path (`web/src/graph/sky-ai.ts`). All three paths must
    coexist; only one is active at a time.
  - Handle compile failures cleanly: log via existing error surface, drop
    back to the default sky, expose an error string in the plugin's
    catalog entry.
- [ ] Consent UX: reuse whatever prompt currently gates TypeScript source
      review (in `web/src/plugins/plugin.ts` or a nearby module). Include
      the shader source hash in the stamp payload.
- [ ] **Own the shared consent-validator refactor** consumed by subtask
      08. Extend `service/plugins.py::consent_stamp` (and its callers) so
      the payload sha256s cover the union `{frontend, backend, collector,
      shader}`. Export the extended validator via a stable name (e.g.
      `consented_for(doc, hashes)`) so `service/mcp.py`'s
      `install_plugin_zip` (subtask 08) can call it without touching the
      internals. Subtask 08 depends on this landing first.
- [ ] Tests:
  - `web/src/graph/backdrop.test.ts` — extend to cover
    `setPluginShader` (mock GL if needed) and the fallback on compile
    failure.
  - Backend test verifying that `/plugins/<id>/sky/fragment.glsl` returns
    200 only when consent is present and 403 (or 404) otherwise, and that
    editing the file bumps the required stamp hash.

## Definition of Done

- [ ] A plugin with `sky/fragment.glsl` under consent renders its shader
      as the far-field.
- [ ] A plugin without consent falls back silently to the shipped sky and
      surfaces an "awaiting review" state in the catalog entry.
- [ ] Editing the shader invalidates prior consent (stamp sha256 mismatch).
- [ ] Shipped sky enum + AI Dynamic both still work when no plugin sky is
      active.
- [ ] `pnpm --filter web test -- src/graph/backdrop.test.ts` passes.
- [ ] Targeted backend pytest for the sky endpoint passes.

## Implementation Notes

- `web/src/graph/backdrop.ts` is dirty in the current worktree — rebase
  carefully; the WIP AI Dynamic sky (`web/src/graph/sky-ai.ts`) is being
  added in the same window.
- The shipped sky pipeline is a single fragment program with an `uMode`
  uniform selecting the branch. Simpler to add a new branch inside the
  existing program **or** to swap in a whole new program when a plugin
  shader is active — choose whichever produces fewer WebGL state changes
  and does not disturb AI Dynamic.
- Do not extend the allowed suffix set — subtask 01 already added `.glsl`.
- Do not allow includes/imports in the GLSL; plugins ship a single self-
  contained fragment source.
- Consent stamp format is defined in the code that reads
  `~/.zoto-viz/plugin-consent.yml` — extend the payload minimally (add a
  `shader_sha256` field) and update `tests/test_agent.py` /
  `tests/test_plugins.py` if they assert on the stamp shape.

## Testing Strategy

**Targeted only.** Run the specific vitest file plus the new backend
pytest module. Do not trigger the full suite.

## Execution Notes

Served `sky/fragment.glsl` at `GET /api/plugins/<id>/sky/fragment.glsl` (`text/x-shader`, cache keyed on zip sha256). Catalog sets `shader_sha256`, `sky_available`, and `sky_error` (`awaiting review` without consent; `compile error: …` on a non-whitelisted uniform). Consent stamp records `shader_sha256`; `consented_for(doc, hashes)` overlays the `{frontend, backend, collector, shader}` union for subtask 08. Frontend `Backdrop.setPluginShader({ id, source })` swaps a whitelist-only `ShaderMaterial` onto the sphere when `look.backdrop = "plugin"`; missing consent / contract failures restore the shipped `space` sky. Shipped enum + AI Dynamic (`sky-ai.ts` / `uMode` 14) stay on the original program.

### Agent Session Info
- Agent: generalPurpose
- Started: 2026-09-15
- Completed: 2026-09-15

### Work Log
- Heartbeat in_progress; implemented `service/plugin_sky.py` + `api_sky` + consent refactor.
- `backdrop.setPluginShader` + uniform regex; wired fetch in `main.ts` after source-review.
- Targeted tests: vitest backdrop/plugin/plugin-ui (19); pytest test_plugin_sky + test_plugins (18).

### Blockers Encountered
None.

### Files Modified
- `service/plugin_sky.py` (created)
- `service/plugins.py`
- `service/monitor.py`
- `tests/test_plugin_sky.py` (created)
- `web/src/graph/backdrop.ts`
- `web/src/graph/backdrop.test.ts`
- `web/src/graph/scene.ts`
- `web/src/plugins/plugin.ts`
- `web/src/plugins/plugin-visualisation.ts`
- `web/src/plugins/plugin-ui.ts`
- `web/src/plugins/plugin.test.ts`
- `web/src/plugins/plugin-ui.test.ts`
- `web/src/app/main.ts`
