# Live monitor

`python -m service.monitor` captures with `tshark`, discovers names, and serves `web/dist` plus `/ws` at 1 Hz.

Header: connection, brand, interface LEDs, rates, device counts.

Controls: **view**, view cog (Settings → This view), **dream**, **feed**, **cam**, **mic**, **AI**, settings cog. Per-view options, plugin config, and arcade knobs live on **This view** — the cog next to the view menu opens that tab. **AI** is a toggle: on (when the model is reachable) writes a profile named after the Ollama model (autosaved) with **AI Dynamic** sky, dream camera, view cycling, randomized motion, and cadence theme changes, and turns on **AI Control**. Off restores the previous profile. Selecting that agent profile while the model is offline loads the saved look only — it does not create a new profile or start cycling. The chip’s LED is dim when idle, pulses amber while the local model is thinking, and the overlay shows a `thinking…` line until the first token.

Settings is one drawer with a left nav: Appearance, This view (plugin options / config / arcade knobs / per-view AI prompt), Graph (Network / System / Look), Physics (traffic sparks, magnets, gravity, strings), Motion, Camera, Audio, Feed, Privacy (redact plus host / subnet filters), Agent.

Feed **source**: traffic (decoded packets, newest at the top; live agent think/reply rows still stream here), **transcript** (agent conversation plus chain of thought, newest at the bottom, with a type / mic / send bar), or both. Settings → Feed **text** (10–20 px) sizes the ticker; the transcript follows the latest line as it streams. Header **feed** / `F` still shows or hides the overlay; on a view narrower than four feed-widths the graph eases left by half the overlay (right when chrome is on the right).

Profiles: `~/.zoto-viz/profiles.yml`. Shipped id `netviz` is read-only. Header **AI** creates a writable profile whose id and label are the Ollama model tag (for example `gemma4:latest` → id `gemma4-latest`). A legacy id `ai` is migrated on the next online activate.

Keyboard: `1–9`/`0` views, `D` dream, `F` feed, `R` redact, `T` theme.
