# Nest cameras (Device Access)

Google Nest live cameras use the **Smart Device Management** API. That is three Google pieces:

1. **OAuth (PCM)** — a consumer Gmail links this machine to a Device Access project (`sdm.service`).
2. **Pub/Sub** — motion / person / doorbell events land on a topic in *your* GCP project.
3. **Streaming** — the browser creates a WebRTC offer; the monitor forwards it with `GenerateWebRtcStream`; ICE runs browser-to-Nest.

Config and tokens: `~/.zoto-viz/sdm.yml` (mode 600). Never commit that file. The desktop/installed OAuth JSONs on this machine **cannot** be used for PCM — Device Access needs a **Web** client with redirect `https://www.google.com`.

View: **Nest cams** (`plugin:nest-cams`). Stage-only labeled 2×2 wall (`grid` 1–4). `pick` is comma-separated labels or ids; empty fills from the first cameras that will stream.

## One-time Google setup

GCP project used here: `gen-lang-client-0973407358`.

```bash
export PATH="$HOME/.local/google-cloud-sdk/google-cloud-sdk/bin:$PATH"
gcloud auth login --update-adc
gcloud config set project gen-lang-client-0973407358
./scripts/sdm-setup.sh
```

Then in a browser (consumer Gmail, not Workspace):

1. Create a **Web application** OAuth client  
   [Credentials](https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0973407358)  
   Authorized redirect URI: `https://www.google.com`  
   OAuth consent screen: External, Testing, add your Gmail as a test user, scope `https://www.googleapis.com/auth/sdm.service`.
2. [Device Access Console](https://console.nest.google.com/device-access) — project UUID (not the GCP id). Paste the Web client id. Enable events with topic  
   `projects/gen-lang-client-0973407358/topics/sdm-events`.
3. Open `pcm_url` from `GET /api/sdm` (or MCP `get_sdm`). After Google redirects to `https://www.google.com?code=...`, copy `code` and POST it:

```bash
curl -s -X POST http://127.0.0.1:7020/api/sdm \
  -H 'content-type: application/json' \
  -H "X-Zoto-Viz-Csrf: $(curl -s -o /dev/null -D - http://127.0.0.1:7020/api/session | awk -F': ' 'tolower($1)=="x-zoto-viz-csrf"{print $2}' | tr -d '\r')" \
  -d '{"enterprise_id":"<uuid>","client_id":"<web-client-id>","client_secret":"<web-secret>","code":"<pcm-code>"}'
```

MCP: `set_sdm` then `list_cameras`. A queued `code` is exchanged on the next monitor poll (~4 s). The first `devices.list` finishes linking and starts Pub/Sub events.

Refresh tokens die if unused for 6 months — the poller refreshes access hourly while the monitor runs.

## API

| Path | Role |
| --- | --- |
| `GET /api/sdm` | Status (no secrets), PCM URL, devices, events |
| `POST /api/sdm` | Upsert config and/or `{code}` |
| `GET /api/sdm/devices` | `devices.list` now |
| `POST /api/sdm/devices/{id}/webrtc` | `{offerSdp}` or `{extend, mediaSessionId}` / `{stop, mediaSessionId}` |
| `GET /api/sdm/still?device=&event=` | Event JPEG (CameraEventImage) |

MCP: `get_sdm`, `list_cameras`, `set_sdm`.
