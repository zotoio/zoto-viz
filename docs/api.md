# HTTP / WebSocket API

Monitor listens on loopback (`127.0.0.1:7020`). Non-loopback `--bind` needs `--insecure-lan`.

Host must be loopback (unless `--insecure-lan`). Browser `Origin` must also be loopback. Mutating methods (`POST` / `PUT` / `DELETE` / `PATCH`) need the `zoto-viz-csrf` cookie plus `X-Zoto-Viz-Csrf` (same value). `GET /api/session` mints both.

| Path | Role |
| --- | --- |
| `GET /` | UI (`web/dist`) |
| `GET /ws` | 1 Hz state snapshot |
| `GET /api/session` | CSRF token, AI Control, plugin-Python flag |
| `GET /api/state` | JSON snapshot |
| `GET /api/traffic?ip=` | recent packets |
| `GET /api/payload` | payload head for a packet |
| `GET/PUT /api/rf/watch` | Wi-Fi SSID watch list |
| `POST /api/forensics?ip=` | deep analysis |
| `/api/profiles*` | settings profiles |
| `GET /api/plugins` | merged catalog (src trees + non-colliding contrib zips): `plugins`, `errors`, `pythonService`, plus per-row `origin` / `hash` / `service` / `consent` / `parts` / `sha256` / `zip` / sky flags |
| `PUT /api/plugins/{id}/consent` | `{kind: "reviewed" \| "authored"}` after source review |
| `GET /api/plugins/{id}/module.js` | compiled TypeScript (`?h=` cache-bust; 404 if missing). CSP locked down. Consent is a UI/sandbox gate, not HTTP 403 |
| `GET /api/plugins/{id}/sky/fragment.glsl` | custom far-field shader (`?h=` cache-bust; 403 without consent) |
| `GET/POST /mcp` | loopback MCP. Tools: `list_features`, `get_settings`, `set_settings`, `list_plugins`, `set_plugin`, `set_view`, `set_agent`, `roll_dice`, `get_state`, `get_traffic`, `get_rf_watch`, `set_rf_watch`, `consent_plugin`, `draft_plugin`, `list_profiles`, `apply_profile`, `list_memories`, `add_memory`, `delete_memory`, `install_plugin_zip`. CSRF skipped; Host still loopback. Settings/plugin patches land on the open UI via WebSocket `live` |
| `GET /api/ai/status` | Ollama reachability plus current temper/weather |
| `GET/PUT /api/ai/control` | server-side AI Control (`~/.zoto-viz/ai-control`; env `ZOTO_VIZ_AI_CONTROL` wins) |
| `GET/PUT /api/ai/temper` | `{temper: 0–100, weather: hush\|drift\|pulse\|storm}` — Agent craziness + AI Dynamic rebuild odds |
| `POST /api/ai/chat` | streaming chat (loopback → Ollama, `think` requested); persists the turn under `~/.zoto-viz/agent/`. Optional `view: { hud }` — a packed on-screen HUD (short keys, no JPEG) is injected into the system prompt. When the live window would overflow Ollama's default context, older turns are folded into a session brief and a new Ollama chat continues from that brief; the UI transcript stays one thread. A stall or truncated thought is polled with silent continues (not stored as a user turn) until a reply or eight nudges. `{ poll: true }` is a UI retry that does not append another user line |
| `GET /api/ai/history` | last ~80 turns (`thinking` when the model produced chain of thought) |
| `DELETE /api/ai/history` | clear the transcript (memories stay) |
| `GET/POST/DELETE /api/ai/memories` | curated memories for later lookup (`POST {text}`, `DELETE {id}`) |
| `POST /api/ai/plugin` | validate `{files, install}` (legacy `yaml` → `plugin.yml`); write `plugins/src/<id>/` only when server AI Control is on and `install` is true. Never packs or git-commits |
| `POST /api/ai/sky` | one-shot Gemma far-field recipe (`{name,motif,a,b,warp,grain,bands}`). Optional `{prompt, view}` from the profile's This view prompt. Not stored on the chat transcript. Used by the AI Dynamic sky |
| `POST /api/ai/speak` | `{text, voice?}`. Streams `audio/pcm` (ElevenLabs / Kokoro / Piper) or JSON if espeak spoke on the host |
| `DELETE /api/ai/speak` | stop the current utterance |

The browser never calls Ollama directly. Client `aiControl` in request bodies is ignored.

## Plugin catalog (`GET /api/plugins`)

The payload is the merge of shipped `plugins/src/<id>/` trees and non-colliding gitignored `plugins/*.zip` (zip rows unpack to `plugins/.runtime/<id>/`). A zip whose id already exists under src is listed on `errors` and is not loaded. Each row includes schema fields plus:

- `origin` — `src` or `zip` (YAML/tree fallback rows omit it)
- `file` — runtime `plugin.yml` path (`plugins/src/<id>/plugin.yml` for src rows)
- `zip` / `sha256` / `parts` — contrib zip identity (zip-origin rows only)
- `hash` / `capabilities` / `bytes` — esbuild compile (TypeScript plugins)
- `service` — relative Python entry when a backend file exists
- `consent` — `reviewed` / `authored` / omitted
- sky flags from `service/plugin_sky.py` (availability is fail-closed without consent)

`GET /api/plugins/{id}/module.js` is the compiled ESM bundle. Optional `?h=<compile-hash>` is cache-busting only. The endpoint does not check consent (404 only if the bundle is missing). The UI refuses to load the iframe sandbox until Settings → Agent allows TypeScript plugins and the plugin has source-review consent.

## MCP `install_plugin_zip`

`POST /mcp` tools/call with `{ zip_b64, overwrite?, force? }`. Loopback Host required. The tool writes gitignored `plugins/<id>.zip` and unpacks `plugins/.runtime/<id>/`. It never `git add` / `git commit`. It **refuses** when `plugins/src/<id>/` already exists (`src_owns_id`); `force` does not override a shipped src tree.

Response shapes:

| Condition | Payload |
| --- | --- |
| wrote / same sha256 | `{ok, id, version, sha256, path, dir, parts, wrote}` |
| src already owns id | `{error: "src_owns_id", id, path, hint}` (`isError`) |
| dirty working tree | `{error: "dirty_tree", id, paths, hint}` (`isError`) |
| exists, no overwrite | `{error: "plugin '<id>' already exists (pass overwrite: true)"}` |
| needs source review | zip is still written; `{ok: false, error: "consent-required", consentRequired, hashes, …}` |

See [Plugins](/plugins) for the full write-safety list and Cursor MCP config.

## Draft plugin (`POST /api/ai/plugin`)

Body: `{ files: { "plugin.yml": "…", "frontend/index.ts": "…" }, install?: bool }`. A lone `yaml` string is treated as `plugin.yml`.

- Validate always. `ok: false` + `error` on schema / zip-safety failure.
- Without AI Control or without `install`, returns `{ok, preview, installed: false, hint}` (`{id} is live at plugins/src/{id}/; share with zoto-viz plugin pack {id} -o dist/{id}.zip`).
- With Control + `install: true`, writes `plugins/src/<id>/` (live immediately) and returns `{ok, preview, installed: true, id, written, hint}`. Pack is only to share a zip.

See [Ollama agent](/agent).
