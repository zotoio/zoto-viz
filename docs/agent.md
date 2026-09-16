# Ollama agent

Optional. Install [Ollama](https://ollama.com) and pull Gemma 4:

```bash
ollama pull gemma4
```

The monitor proxies `127.0.0.1:11434`. Override with `ZOTO_VIZ_OLLAMA`.

Chat is **one thread on the monitor**, not the browser tab. Refresh, a second window, or a different screen continues the same log (`GET /api/ai/history`, file `~/.zoto-viz/agent/conversation.json`). **Clear** on the agent pane drops the transcript only.

The overlay keeps that full log. When the live Ollama window would overflow (`num_ctx`), the monitor folds older turns into a short **session brief**, then starts a new model chat that continues from that brief plus the latest few messages. The on-screen transcript is not reset. If a turn stalls or stops mid-thought, the monitor silently continues it on the same stream (up to eight nudges) until there is a user-facing reply. The UI polls again if that stream still ends on thought only — no extra user line.

The header **AI** chip is the wait light: dim LED when idle, **AI · think** with a pulsing amber LED from send until the first reply token (and a `thinking…` row on the feed overlay). **AI · speak** is TTS. Watchword listening keeps the same **AI** label with a lit accent LED. Header **dice** (next to AI) rolls the groups left on in **Settings → Dice** (theme, catalog view, mosaic, chrome, feed, motion, physics, and every view’s knobs by default) under operator-set soft ceilings on labels, sparks, mosaic tiles, and node-count knobs, then optionally turns cycling + Control on and sends a chat turn so the model takes over from that seed.

Settings → Feed → **source** can be **transcript** (or **both**) so the right-hand overlay shows the full log, including chain-of-thought (`think` lines) as the model streams. **Traffic** still shows those live think/reply rows as they arrive — it just does not seed the stored history. Transcript-only is chronological (newest at the bottom) and pins to the latest tokens. The monitor requests Ollama `think`; models that wrap reasoning in `<think>` tags are split the same way.

Each turn stores a short **highlight**. Explicit `remember …` / `forget …` and model ` ```memory ` fences become curated memories (`~/.zoto-viz/agent/memories.json`). The next chat injects the best matches into the system prompt. IPs are scrubbed from memories when redaction is on.

**Insights** work whenever Ollama is up. **Draft plugin** (`POST /api/ai/plugin`) validates a `{files, install}` tree (a lone `yaml` string is treated as `plugin.yml`). With **AI Control** on and `install: true` it writes `plugins/src/<id>/` and that tree is live; the hint is `{id} is live at plugins/src/{id}/; share with zoto-viz plugin pack {id} -o dist/{id}.zip`. It never packs or git-commits. **Change settings / author a sky shader / pin photos or SVG** also requires **AI Control** on the server (`GET/PUT /api/ai/control`, file `~/.zoto-viz/ai-control`, or env `ZOTO_VIZ_AI_CONTROL`). Contrib zip install is loopback MCP `install_plugin_zip` (src-owns / dirty-tree / overwrite guards, no auto-commit) — see [Plugins](/plugins). The header **AI** toggle turns Control on with a profile named after the current Ollama model in `~/.zoto-viz/profiles.yml`: dream, view cycling, randomized motion, cadence theme walks, and either **AI Dynamic** or an agent-authored GLSL sky. That profile is created only while the model is reachable; selecting it later while Ollama is down loads the saved settings as-is. Autosave writes that profile as the agent changes settings, shaders, and decorations. A request body `aiControl` flag is ignored. While Control is on, the AI chip's tooltip says so. The **AI Dynamic** sky (`POST /api/ai/sky`) is a one-shot recipe, not a chat turn, and does not need Control — the header toggle is what keeps selecting it unless the agent has installed a custom shader.

When Control is on, the model may emit:

- ` ```settings ` JSON — any profile field (theme, view, show/hide layers, filters, motion/camera/audio/mosaic `anim`, feed, chrome, plugins).
- ` ```shader ` / ` ```glsl ` — a `vec3 color(vec3 dir, float t)` (or `void main`) fragment. Host uniforms: `uTime`, `uOpacity`, `uBright`, `uAudio`, `uAccent`, `uBg`, `uPhoto`.
- ` ```photo ` — `https://` image URLs (fetched by the monitor, public addresses only, size-capped) pinned on the graph.
- ` ```svg ` — a small SVG overlay.
- ` ```deco ` `{"clear":true}` — drop agent decorations and the custom shader.

Those land on the model-named profile (`POST /api/ai/asset`, `GET /api/ai/assets/<id>`).

Voice: **listen for watchword** (on by default) keeps the microphone on and waits for **zoto** (also “hey zoto” / “okay zoto”). Change the word in Settings → Agent. After the watchword, speak the question; a short pause sends it to the local model. Replies are read through the speakers (**speak replies**, on by default). The mic pauses while TTS plays so the agent does not hear itself. Hold **Talk** to send without the watchword.

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

Default model: `gemma4`. Override in Settings → Agent → **model**. **Temper** (0–100, bands hush / even / keen / feral) is a temperature analog: it sets Ollama `temperature` and injects a system-prompt prefix on every change. **Weather** is a probability strip for how often AI Dynamic asks Gemma for a new sky (hush 22% / 90 s … storm 94% / 6 s; default drift is about once a minute). Palettes ease between recipes; magnets, gravity, swirl, and strings ease toward new physics. Both are MCP `set_agent`. **Include screen** (on by default) posts a packed HUD of what is on screen (mode, theme, selection, stats, hidden layers, feed). No graph JPEG. Turn the toggle off to skip it. The Ollama URL is loopback-only (`ZOTO_VIZ_OLLAMA`). Watchword listening needs Chromium on localhost and microphone permission.

Chat leaves Ollama's default `num_ctx` (usually 2048). Override with `ZOTO_VIZ_OLLAMA_NUM_CTX` (clamped 512–131072) only if you need a larger window.

Gemma 4 E2B/E4B on Ollama **0.31.x** crash on a 4 GB GPU (`GGML_ASSERT(n_inputs < GGML_SCHED_MAX_SPLIT_INPUTS)`) when layers split between CPU and CUDA. The monitor sends `num_gpu: 0` (CPU-only) for `gemma4*` tags. Override with `ZOTO_VIZ_OLLAMA_NUM_GPU`. For `ollama run gemma4:e4b` itself, pin the tag:

```bash
printf 'FROM gemma4:e4b\nPARAMETER num_gpu 0\n' > /tmp/GemmaCPU
ollama create gemma4:e4b -f /tmp/GemmaCPU
```

Upgrade to Ollama 0.34+ when you can (`sudo` install script) so partial GPU offload can work again.
