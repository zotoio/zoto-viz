# HTTP / WebSocket API

Monitor listens on loopback (`127.0.0.1:7020`) unless `~/.zoto-viz/sys-config.yml` sets `bind` (or you pass `--bind`). Non-loopback bind needs `insecure_lan: true` / `--insecure-lan`.

Host must be loopback (unless `--insecure-lan`). Browser `Origin` must also be loopback. Mutating methods (`POST` / `PUT` / `DELETE` / `PATCH`) need `X-Zoto-Viz-Csrf` matching the process token. `GET /api/session` mints the header and a `zoto-viz-csrf` cookie (cookie is optional; a stale cookie after a monitor restart is ignored).

| Path | Role |
| --- | --- |
| `GET /` | UI (`web/dist`) |
| `GET /ws` | 1 Hz state snapshot |
| `GET /api/session` | CSRF token, AI Control, plugin-Python flag |
| `GET /api/state` | JSON snapshot |
| `GET /api/logs?after=` | Recent `[monitor]` stderr lines (`seq`, `t`, `text`). `after` is the last seen seq |
| `GET /api/traffic?ip=` | recent packets |
| `GET /api/payload` | payload head for a packet |
| `GET/PUT /api/rf/watch` | Wi-Fi SSID watch list |
| `POST /api/forensics?ip=` | deep analysis |
| `/api/profiles*` | settings profiles |
| `GET /api/plugins` | merged catalog (src trees + non-colliding contrib zips): `plugins`, `errors`, `pythonService`, plus per-row `origin` / `hash` / `service` / `consent` / `parts` / `sha256` / `zip` / sky flags |
| `PUT /api/plugins/{id}/consent` | `{kind: "reviewed" \| "authored"}` after source review |
| `GET /api/plugins/{id}/module.js` | compiled TypeScript (`?h=` cache-bust; 404 if missing). CSP locked down. Consent is a UI/sandbox gate, not HTTP 403 |
| `GET /api/plugins/{id}/sky/fragment.glsl` | custom far-field shader (`?h=` cache-bust; 403 without consent) |
| `GET /api/plugins/hn-rain/still` | Composer 2.5 SVG still for an HN title (`202` while queued, cached under `~/.zoto-viz/agent/stills`) |
| `GET/POST /api/sdm` | Nest Device Access status / config + PCM `code` (`~/.zoto-viz/sdm.yml`) |
| `GET /api/sdm/devices` | SDM `devices.list` |
| `POST /api/sdm/devices/{id}/webrtc` | Forward WebRTC offer / extend / stop |
| `GET /api/sdm/still?device=&event=` | Event JPEG via CameraEventImage |
| `GET/PUT/POST /api/sources` | Host RSS / HTTPS / local-file registry (`~/.zoto-viz/sources.yml`) |
| `GET /api/sources/image?url=` | Same-origin JPEG/PNG proxy for RSS enclosure stills (NASA IOTD). HTTPS / public-IP gate, 24 MB cap |
| `PUT/DELETE /api/sources/{id}` | Upsert or remove one source |
| `GET/PUT/POST /api/plugin-instances` | Extra catalog rows that reuse a shipped plugin (`~/.zoto-viz/plugin-instances.yml`) |
| `PUT/DELETE /api/plugin-instances/{plugin}/{id}` | Upsert or remove one instance |
| `GET/POST /mcp` | loopback MCP. Tools: `list_features`, `get_settings`, `set_settings`, `list_plugins`, `set_plugin`, `set_view`, `set_agent`, `roll_dice`, `get_state`, `get_traffic`, `get_rf_watch`, `set_rf_watch`, `consent_plugin`, `draft_plugin`, `list_profiles`, `apply_profile`, `list_memories`, `add_memory`, `delete_memory`, `list_sources`, `set_source`, `delete_source`, `list_plugin_instances`, `set_plugin_instance`, `delete_plugin_instance`, `get_sdm`, `list_cameras`, `set_sdm`, `install_plugin_zip`, `publish_local_plugin`. CSRF skipped; Host still loopback. Settings/plugin patches land on the open UI via WebSocket `live` |
| `GET /api/ai/status` | Ollama reachability + installed/popular catalog (size/VRAM) + Cursor SDK models; temper/weather |
| `POST /api/ai/ollama/pull` | `{name}` stream `ollama pull` (loopback) |
| `GET/PUT/DELETE /api/ai/cursor` | Cursor API key (`~/.zoto-viz/cursor-key`; `CURSOR_API_KEY` env wins) |
| `GET /api/ai/cursor-stats` | tail of `~/.zoto-viz/cursor-stats.jsonl` (`?tail=80`) — tokens / `rawCostCents` / `chargedCents` / API-key name; never the key |
| `GET/PUT /api/ai/control` | server-side AI Control (`~/.zoto-viz/ai-control`; env `ZOTO_VIZ_AI_CONTROL` wins) |
| `GET/PUT /api/ai/temper` | `{temper: 0–100, weather: hush\|drift\|pulse\|storm}` — Agent craziness + AI Dynamic rebuild odds |
| `POST /api/ai/chat` | streaming chat. `{backend: "ollama"\|"cursor", model}`. Each user line is sent to the model immediately; the reply is the next conversation turn. Ollama is loopback `think` off; Cursor SDK runs `@cursor/sdk` with MCP `publish_local_plugin`. Persists under `~/.zoto-viz/agent/`. Optional `view: { hud }`. Prompts carry a token-capped **Facts** window (outcomes + memories; `ZOTO_VIZ_FACTS_TOKENS`), not prior CoT. Overflow starts a **new session**. `{ poll: true }` is a UI retry that does not append another user line |
| `GET /api/ai/history` | last ~80 turns (`thinking` when the model produced chain of thought) |
| `DELETE /api/ai/history` | clear the transcript and outcome facts (curated memories stay) |
| `GET/POST/DELETE /api/ai/memories` | curated memories for later lookup (`POST {text}`, `DELETE {id}`) |
| `POST /api/ai/plugin` | validate `{files, install}` (legacy `yaml` → `plugin.yml`); write `plugins/src/<id>/` only when server AI Control is on and `install` is true. Never packs or git-commits |
| `POST /api/ai/plugin/local` | `{zip_b64 \| files \| description}` → `~/.zoto-viz/plugins/local/<id>.zip`; hot-load and activate when the zip is YAML-only or already consented |
| `POST /api/ai/sky` | one-shot Gemma far-field recipe (`{name,motif,a,b,warp,grain,bands}`). Optional `{prompt, view}` from the profile's This view prompt. Not stored on the chat transcript. Used by the AI Dynamic sky |
| `POST /api/ai/speak` | `{text, voice?}`. Streams `audio/pcm` (ElevenLabs / Kokoro / Piper) or JSON if espeak spoke on the host |
| `DELETE /api/ai/speak` | stop the current utterance |

The browser never calls Ollama directly. Client `aiControl` in request bodies is ignored.

## Plugin catalog (`GET /api/plugins`)

The payload is the merge of shipped `plugins/src/<id>/` trees, non-colliding gitignored `plugins/*.zip` (unpack to `plugins/.runtime/<id>/`), and user-local `~/.zoto-viz/plugins/local/*.zip` (`origin: local`, unpack to `~/.zoto-viz/plugins/local/.runtime/<id>/`). A zip whose id already exists under src (or an earlier zip) is listed on `errors` and is not loaded. Each row includes schema fields plus:

- `origin` — `src`, `zip`, or `local` (YAML/tree fallback rows omit it)
- `file` — runtime `plugin.yml` path (`plugins/src/<id>/plugin.yml` for src rows)
- `zip` / `sha256` / `parts` — zip identity (zip- and local-origin rows)
- `hash` / `capabilities` / `bytes` — esbuild compile (TypeScript plugins)
- `service` — relative Python entry when a backend file exists
- `consent` — `reviewed` / `authored` / omitted
- sky flags from `service/plugin_sky.py` (availability is fail-closed without consent)

`GET /api/plugins/{id}/module.js` is the compiled ESM bundle. Optional `?h=<compile-hash>` is cache-busting only. The endpoint does not check consent (404 only if the bundle is missing). The UI refuses to load the iframe sandbox until Settings → Agent allows TypeScript plugins and the plugin has source-review consent.

## MCP `install_plugin_zip`

`POST /mcp` tools/call with `{ zip_b64, overwrite?, force? }`. Loopback Host required. The tool writes gitignored `plugins/<id>.zip` and unpacks `plugins/.runtime/<id>/`. It never `git add` / `git commit`. A colliding id is reminted (`<id>-2`, …) unless `overwrite` updates that same contrib zip. It never writes into `plugins/src/<id>/`.

Response shapes:

| Condition | Payload |
| --- | --- |
| wrote / same sha256 | `{ok, id, version, sha256, path, dir, parts, wrote}` |
| reminted to a free id | `{ok, id, remintedFrom, …}` |
| dirty working tree | `{error: "dirty_tree", id, paths, hint}` (`isError`) |
| needs source review | zip is still written; `{ok: false, error: "consent-required", consentRequired, hashes, …}` |

See [Plugins](/plugins) for the full write-safety list and Cursor MCP config.

## MCP `publish_local_plugin`

`POST /mcp` tools/call with `{ zip_b64 | files | description, overwrite?, activate? }`. Loopback Host required. Writes `~/.zoto-viz/plugins/local/<id>.zip` (override with `ZOTO_VIZ_PLUGIN_LOCAL`), unpacks the local runtime cache, and queues a live `reloadPlugins` + `mode: plugin:<id>` when the zip is YAML-only or already consented. Code-bearing zips still install, then return `consent-required`. Does not write the git checkout.

A `description` mints a graph/topology `plugin.yml` + `visualisation.yml` (optional `id`, `name`, `engine`, `base`). Requested ids are reminted when the catalog already has them. A `plugin.yml` body starting with `id:` is packed, then reminted the same way (a missing visualisation gets `engine: graph` / `base: topology` so the view can activate).

## Draft plugin (`POST /api/ai/plugin`)

Body: `{ files: { "plugin.yml": "…", "frontend/index.ts": "…" }, install?: bool }`. A lone `yaml` string is treated as `plugin.yml`.

- Validate always. `ok: false` + `error` on schema / zip-safety failure.
- Without AI Control or without `install`, returns `{ok, preview, installed: false, hint}` (`{id} is live at plugins/src/{id}/; share with zoto-viz plugin pack {id} -o dist/{id}.zip`).
- With Control + `install: true`, writes `plugins/src/<id>/` (live immediately) and returns `{ok, preview, installed: true, id, written, hint}`. A taken id remints first. Pack is only to share a zip.

See [Ollama agent](/agent).
