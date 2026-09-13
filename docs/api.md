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
| `GET /api/plugins` | plugin list + compile hashes + `service` + `consent` |
| `PUT /api/plugins/{id}/consent` | `{kind: "reviewed" \| "authored"}` after source review |
| `GET /api/plugins/{id}/module.js` | compiled TypeScript (CSP locked down) |
| `GET /api/agent-plugins` | installed agent-plugin zips (`produces` / `consumes` / UI kind) |
| `GET/POST /mcp` | loopback MCP (install_plugin_zip, list_agent_plugins, plugin_ui_brief, write_plugin_ui). CSRF skipped; Host still loopback |
| `GET /api/ai/status` | Ollama reachability |
| `GET/PUT /api/ai/control` | server-side AI Control (`~/.zoto-viz/ai-control`; env `ZOTO_VIZ_AI_CONTROL` wins) |
| `POST /api/ai/chat` | streaming chat (loopback → Ollama, `think` requested); persists the turn under `~/.zoto-viz/agent/`. Optional `view: { hud }` — a packed on-screen HUD (short keys, no JPEG) is injected into the system prompt. When the live window would overflow Ollama's default context, older turns are folded into a session brief and a new Ollama chat continues from that brief; the UI transcript stays one thread |
| `GET /api/ai/history` | last ~80 turns (`thinking` when the model produced chain of thought) |
| `DELETE /api/ai/history` | clear the transcript (memories stay) |
| `GET/POST/DELETE /api/ai/memories` | curated memories for later lookup (`POST {text}`, `DELETE {id}`) |
| `POST /api/ai/plugin` | validate YAML; install only when server AI Control is on |
| `POST /api/ai/speak` | `{text, voice?}`. Streams `audio/pcm` (ElevenLabs / Kokoro / Piper) or JSON if espeak spoke on the host |
| `DELETE /api/ai/speak` | stop the current utterance |

The browser never calls Ollama directly. Client `aiControl` in request bodies is ignored.
