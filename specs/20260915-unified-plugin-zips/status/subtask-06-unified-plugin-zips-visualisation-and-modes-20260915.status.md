# Subtask 06 — Unified Plugin Zips — live status

<!-- status:metadata:start -->
| Key | Value |
|-----|-------|
| schema_version | 1 |
| subtask_id | 06 |
| feature | Unified Plugin Zips |
| assigned_agent | generalPurpose |
| model | composer-2.5-fast |
| token_budget | 200000 |
| state | completed |
| started_at | 2026-09-15T07:35:52.530Z |
| last_heartbeat | 2026-09-15T07:57:59.811Z |
| completed_at | 2026-09-15T07:52:29.473Z |
| git_sha |  |
| agent_session_id |  |
<!-- status:metadata:end -->

<!-- status:checklist:start -->
- [x] **D01** — Extend the frontend plugin catalog loader (`web/src/plugins/plugin.ts` (`web/src/plugins/plugin-visualisation.ts`)
- [x] **D02** — Preserve overlay behaviour: (`web/src/core/modes.ts`)
- [x] **D03** — Wire `visualisation.look.backdrop` through to `web/src/graph/backdrop.ts`. (`web/src/graph/backdrop.ts`)
- [x] **D04** — Make the Settings "This view" panel (`web/src/ui/settings.ts`) show (`web/src/ui/settings.ts`)
- [x] **D05** — Route `visualisation.engine` through the real dispatch surface. (`web/src/plugins/plugin.ts`)
- [x] **D06** — Add/extend vitest coverage: (`web/src/plugins/plugin.test.ts`)
<!-- status:checklist:end -->

<!-- status:artifacts:start -->
- **created** `web/src/plugins/plugin-visualisation.ts` — translate visualisation.yml into PluginView
- **modified** `web/src/plugins/plugin.ts` — catalog overlay and engine dispatch via graphBase/arcadeId
- **modified** `web/src/core/modes.ts` — pluginMenuRows unique-id menu; keep hardcoded MODES
- **modified** `web/src/graph/backdrop.ts` — BackdropKind plugin seam for subtask 07
- **modified** `web/src/ui/settings.ts` — This view pane shows plugin options and config
- **modified** `web/src/plugins/plugin.test.ts` — visualisation round-trip, overlay, no-viz load
- **modified** `web/src/core/modes.test.ts` — unique vs duplicate pluginId menu rows
- **modified** `web/src/ui/settings.test.ts` — This view knobs
- **modified** `service/plugins.py` — attach visualisation.yml on catalog rows
<!-- status:artifacts:end -->

<!-- status:errors:start -->
_None._
<!-- status:errors:end -->

<!-- status:notes:start -->
Ingest visualisation.yml via plugin-visualisation.ts; unique ids add plugin:<id> menu rows; duplicate ids overlay look pins (plugin-on-plugin). MODES stay in the live menu. look.backdrop=plugin is a BackdropKind seam for 07. Settings This view shows options+config. Targeted vitest 22/22 passed. token_budget 200000.
<!-- status:notes:end -->
