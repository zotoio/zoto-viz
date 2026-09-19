# Agent

Two backends share the feed, memories, AI Control, and plugin install:

- **Ollama** — any tag already on the machine, plus popular downloads (size / VRAM warning when the GPU is small). The monitor proxies `127.0.0.1:11434` (`ZOTO_VIZ_OLLAMA`).
- **Cursor SDK** (`@cursor/sdk`) — hosted models from `Cursor.models.list()`, **Grok** by default. Needs `CURSOR_API_KEY` or a key pasted in Settings → Agent (stored `0600` at `~/.zoto-viz/cursor-key`).

Settings → Agent picks the backend and model. Conversation lives on the **feed**, not in Settings.

```bash
ollama pull gemma4
# or: Settings → Agent → backend Ollama → pick a download → confirm if VRAM is tight
```

Chat is **one log on the monitor**, shown on the feed. Refresh, a second window, or a different screen continues the same transcript (`GET /api/ai/history`, file `~/.zoto-viz/agent/conversation.json`). **Clear conversation** in Settings → Agent drops the transcript only. **Memories** stay across sessions.

The overlay keeps that full log, including chain-of-thought for the **current** operation. Future prompts do not replay prior replies or reasoning — they get a **sliding Facts window** (outcomes + curated memories, capped by tokens; override with `ZOTO_VIZ_FACTS_TOKENS`, default 384). When the live Ollama window would overflow (`num_ctx`) or grow past the current turn, the monitor **starts a new session**. Facts still inject. The on-screen transcript is not reset. If a turn stalls or stops mid-thought, the monitor silently continues it on the same stream (up to two nudges) until there is a user-facing reply. The UI polls again if that stream still ends on thought only — no extra user line.

The header **AI** chip is the wait light: dim LED when idle, **AI · think** with a pulsing amber LED from send until the first reply token (and a `thinking…` row on the feed overlay). **AI · speak** is TTS. Watchword listening keeps the same **AI** label with a lit accent LED. Header **dice** (next to AI) is a repeat switch: on rolls now, then every N minutes (Settings → Dice frequency). Off stops the timer. A roll randomizes the groups left on (theme, catalog view, mosaic, feed, motion, physics, and every view’s knobs by default; chrome, camera, and microphone stay) under operator-set soft ceilings on labels, sparks, mosaic tiles, and node-count knobs, then optionally turns cycling + Control on. A roll does not start a chat or think turn. MCP `roll_dice` stays one shot.

Settings → Feed → **source** can be **transcript** (or **both**) so the right-hand overlay shows the full log, including chain-of-thought (`think` lines) as the model streams. **Traffic** still shows those live think/reply rows as they arrive — it just does not seed the stored history. Every source is chronological (newest at the bottom) and **pins to the latest line**. The monitor does not request Ollama `think`; models that still wrap reasoning in `<think>` tags are split the same way.

Each finished turn stores a short **outcome fact** (what was decided or built — not the chain of thought). Explicit `remember …` / `forget …` and model ` ```memory ` fences become curated memories (`~/.zoto-viz/agent/memories.json`). The next chat injects a token-capped Facts window (memories first, then recent outcomes). Clearing the conversation drops outcome facts; curated memories stay. IPs are scrubbed when redaction is on.

**Insights** work whenever a backend is up. Chat drafts must emit the **full files tree** as path-tagged fences (`plugin.yml`, `visualisation.yml`, `frontend/index.ts`, `sky/fragment.glsl`, …). With **AI Control** on the monitor installs that tree to `~/.zoto-viz/plugins/local/<id>.zip` (`POST /api/ai/plugin/local`) and activates the view when the zip is YAML-only. Cursor SDK turns also call MCP `publish_local_plugin` so the agent actually builds the plugin. `POST /api/ai/plugin` still validates (and can write `plugins/src/<id>/` when Control is on and `install: true`). A remote agent uses MCP `publish_local_plugin` (`zip_b64`, `files`, or a `description`). **Change settings / author a sky shader / pin photos or SVG** also requires **AI Control** on the server (`GET/PUT /api/ai/control`, file `~/.zoto-viz/ai-control`, or env `ZOTO_VIZ_AI_CONTROL`). Contrib zip install into the checkout is loopback MCP `install_plugin_zip` — see [Plugins](/plugins). The header **AI** toggle turns Control on with a profile named after the current model in `~/.zoto-viz/profiles.yml`. A request body `aiControl` flag is ignored. The **AI Dynamic** sky (`POST /api/ai/sky`) is a one-shot Ollama recipe.

When Control is on, the model may emit:

- ` ```settings ` JSON — profile fields except camera and microphone (theme, view, show/hide layers, filters, motion/camera/audio/mosaic `anim` including `mosaicTiles` / `mosaicTree` / `mosaicSharedTheme`, feed, chrome, plugins). Webcam and mic stay on Settings → Privacy. Settings → Agent → **AI mosaic layout** (on by default) gates whether the model may resize or rearrange the wall; tile view ids still apply when it is off.
- ` ```shader ` / ` ```glsl ` — a `vec3 color(vec3 dir, float t)` (or `void main`) fragment. Host uniforms: `uTime`, `uOpacity`, `uBright`, `uAudio`, `uAccent`, `uBg`, `uPhoto`.
- ` ```photo ` — `https://` image URLs (fetched by the monitor, public addresses only, size-capped) pinned on the graph.
- ` ```svg ` — a small SVG overlay.
- ` ```deco ` `{"clear":true}` — drop agent decorations and the custom shader.

Those land on the model-named profile (`POST /api/ai/asset`, `GET /api/ai/assets/<id>`).

Voice: **listen for watchword** (on by default) holds a live microphone stream and waits for **zoto** (also “hey zoto” / “okay zoto”). Header **mic** Off stops that stream (and hold-to-talk) so the OS microphone light goes out. Change the word in Settings → Agent. The first open shows an in-page **Allow the microphone** dialog — Cursor’s Simple Browser and other embedded Chromium shells have no listening / camera prompt, so that Allow is the accept (the OS mic light stays off until then). After the watchword the feed switches to **transcript**, stays pinned to the bottom, and shows **listening**. Speak the question, then say **send** and pause to submit. Replies are read through the speakers (**speak replies**, on by default). Speech recognition pauses while TTS plays so the agent does not hear itself; the capture stream stays up so the OS mic indicator does not flash. Hold **Talk** to send without the watchword (header mic must be on).

Chrome on Linux usually has no Web Speech voices. Spoken replies then go through the monitor (`POST /api/ai/speak`) as a **PCM stream** the UI plays as chunks arrive:

1. **ElevenLabs** when `ELEVENLABS_API_KEY` is set (cloud; reply text leaves this machine). Default voice is George (`JBFqnCBsd6RMkjVDRZzb`); override with **TTS voice** in Settings or `ELEVENLABS_VOICE_ID`. Flash model: `ELEVENLABS_MODEL=eleven_flash_v2_5`.
2. **Local Kokoro** (or any OpenAI-compatible speech server) at a **loopback** URL:

```bash
# example: Kokoro-FastAPI on :8880
export ZOTO_VIZ_TTS_URL=http://127.0.0.1:8880
# optional: ZOTO_VIZ_TTS_MODEL=kokoro  ZOTO_VIZ_TTS_VOICE=af_heart
```

3. **Piper** if `piper` is on `PATH` and a `.onnx` model is in `~/.local/share/piper` (or `ZOTO_VIZ_PIPER_MODEL`).
4. Else **espeak-ng** / **speech-dispatcher** (`spd-say`).

```bash
export ELEVENLABS_API_KEY=…          # prefer 11 Labs
# or, keep replies on-box:
export ZOTO_VIZ_TTS_URL=http://127.0.0.1:8880
sudo apt install espeak-ng speech-dispatcher speech-dispatcher-espeak-ng
```

`ZOTO_VIZ_TTS=elevenlabs|openai|piper|espeak|auto` forces an engine. `auto` picks the first available in the order above.

Default Ollama model: `gemma4`. Default Cursor model: first Grok id from the account catalog (`grok-4.5` fallback). **Temper** (0–100, bands hush / even / keen / feral) is a temperature analog: it sets Ollama `temperature` and injects a system-prompt prefix on every change. **Weather** is a probability strip for how often AI Dynamic asks Gemma for a new sky (hush 22% / 90 s … storm 94% / 6 s; default drift is about once a minute). Palettes ease between recipes; magnets, gravity, swirl, and strings ease toward new physics. Both are MCP `set_agent`. **Include screen** (on by default) posts a JPEG of the live canvas plus a packed HUD (mode, theme, selection, stats, hidden layers, feed). The image is attached to that Ollama turn only — it is not stored in the transcript. Turn the toggle off to skip both. The Ollama URL is loopback-only (`ZOTO_VIZ_OLLAMA`). Watchword listening needs Chromium on localhost and microphone permission.

Chat leaves Ollama's default `num_ctx` (usually 2048). Override with `ZOTO_VIZ_OLLAMA_NUM_CTX` (clamped 512–131072) only if you need a larger window. The Facts window defaults to 384 tokens (`ZOTO_VIZ_FACTS_TOKENS`, 64–2048).

Gemma 4 E2B/E4B on Ollama **0.31.x** crash on a 4 GB GPU (`GGML_ASSERT(n_inputs < GGML_SCHED_MAX_SPLIT_INPUTS)`) when layers split between CPU and CUDA. The monitor sends `num_gpu: 0` (CPU-only) for `gemma4*` tags. Override with `ZOTO_VIZ_OLLAMA_NUM_GPU`. For `ollama run gemma4:e4b` itself, pin the tag:

```bash
printf 'FROM gemma4:e4b\nPARAMETER num_gpu 0\n' > /tmp/GemmaCPU
ollama create gemma4:e4b -f /tmp/GemmaCPU
```

Upgrade to Ollama 0.34+ when you can (`sudo` install script) so partial GPU offload can work again.
