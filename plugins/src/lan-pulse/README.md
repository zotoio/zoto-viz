# LAN Pulse

Unified plugin: `plugin.yml` + `visualisation.yml` + `frontend/` + `backend/`.

`produces[]` / `consumes[]` on `plugin.yml` are declarative only — there is no
`datasource/collector.py` and no `sky/`. v1 drops `skills/` and `ui/` (generate-UI
is not part of the unified format).
