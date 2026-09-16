# Subtask 07 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 07 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T07:59:18.906Z |
| last_heartbeat | 2026-09-15T08:23:37.901Z |
| completed_at | 2026-09-15T08:18:49.079Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Backend: (`service/plugins.py`)
- [x] **D02** — **Freeze the plugin shader uniform contract** (matches the entry (`web/src/graph/backdrop.ts`)
- [x] **D03** — Frontend: (`web/src/graph/backdrop.ts`)
- [x] **D04** — Consent UX: reuse whatever prompt currently gates TypeScript source (`web/src/plugins/plugin-ui.ts`)
- [x] **D05** — **Own the shared consent-validator refactor** consumed by subtask (`service/plugins.py`)
- [x] **D06** — Tests: (`tests/test_plugin_sky.py`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `service/plugin_sky.py` — hash/validate/catalog flags for sky/fragment.glsl
- **modified** `service/plugins.py` — api_sky + shader_sha256 consent + sky_available payload
- **modified** `service/monitor.py` — GET /api/plugins/{id}/sky/fragment.glsl
- **modified** `web/src/graph/backdrop.ts` — pluginShaderError whitelist uTime/uOpacity/uBright/uAudio/uAccent/uBg
- **modified** `web/src/graph/backdrop.ts` — setPluginShader swaps ShaderMaterial; fallback space
- **modified** `web/src/graph/scene.ts` — NetScene.setPluginShader delegates to Backdrop
- **modified** `web/src/app/main.ts` — fetch plugin GLSL when look.backdrop=plugin
- **modified** `web/src/plugins/plugin-ui.ts` — review prompt mentions sky/fragment.glsl
- **modified** `web/src/plugins/plugin.ts` — pluginNeedsReview includes has_sky_shader
- **modified** `service/plugins.py` — consented_for(doc, hashes) union frontend/backend/collector/shader
- **modified** `web/src/graph/backdrop.test.ts` — setPluginShader contract + fallback
- **created** `tests/test_plugin_sky.py` — 403 without consent, hash bump, consented_for
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Served sky/fragment.glsl at GET /api/plugins/<id>/sky/fragment.glsl (text/x-shader,
cache keyed on zip sha256). Fail closed: no consent → 403 + catalog sky_error
"awaiting review"; non-whitelisted uniforms → compile error and shipped space sky.
Consent stamp records shader_sha256; consented_for(doc, hashes) overlays the
{frontend, backend, collector, shader} union for subtask 08. Backdrop.setPluginShader
swaps a whitelist-only ShaderMaterial when look.backdrop=plugin. Shipped enum +
AI Dynamic coexist. token_budget 200000.
Tests: pnpm exec vitest run src/graph/backdrop.test.ts src/plugins/plugin.test.ts
src/plugins/plugin-ui.test.ts (19 passed); pytest tests/test_plugin_sky.py
tests/test_plugins.py (18 passed).
<!-- status:notes:end -->
