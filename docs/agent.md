# Ollama agent

Optional. Install [Ollama](https://ollama.com) and pull Gemma 4:

```bash
ollama pull gemma4
```

The monitor proxies `127.0.0.1:11434`. Override with `ZOTO_VIZ_OLLAMA`.

**Insights** work whenever Ollama is up. **Draft plugin** YAML is schema-validated. **Install plugin / change settings** requires **AI Control** on the server (`GET/PUT /api/ai/control`, file `~/.zoto-viz/ai-control`, or env `ZOTO_VIZ_AI_CONTROL`). The header AI toggle writes that file; a request body `aiControl` flag is ignored. A banner shows while Control is on.

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

Default model: `gemma4` (multimodal). Override in Settings → Agent → **model**. **Include view** attaches a JPEG of the graph (not the webcam). The Ollama URL is loopback-only (`ZOTO_VIZ_OLLAMA`). Watchword listening needs Chromium on localhost and microphone permission.

Gemma 4 E2B/E4B on Ollama **0.31.x** crash on a 4 GB GPU (`GGML_ASSERT(n_inputs < GGML_SCHED_MAX_SPLIT_INPUTS)`) when layers split between CPU and CUDA. The monitor sends `num_gpu: 0` (CPU-only) for `gemma4*` tags. Override with `ZOTO_VIZ_OLLAMA_NUM_GPU`. For `ollama run gemma4:e4b` itself, pin the tag:

```bash
printf 'FROM gemma4:e4b\nPARAMETER num_gpu 0\nPARAMETER num_ctx 2048\n' > /tmp/GemmaCPU
ollama create gemma4:e4b -f /tmp/GemmaCPU
```

Upgrade to Ollama 0.34+ when you can (`sudo` install script) so partial GPU offload can work again.
