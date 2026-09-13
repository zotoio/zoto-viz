# Live monitor

`python -m service.monitor` captures with `tshark`, discovers names, and serves `web/dist` plus `/ws` at 1 Hz.

Header: connection, brand, interface LEDs, rates, device counts.

Controls: **view**, mode options, **dream**, **feed**, **cam**, **AI**, settings cog. The AI chip’s LED is dim when idle, pulses amber while the local model is thinking, and the overlay shows a `thinking…` line until the first token.

Settings is one drawer with a left nav: Appearance, This view, Graph, Motion, Camera, Feed, Privacy, Agent.

Feed **source**: traffic (decoded packets, newest at the top), **transcript** (agent conversation plus chain of thought, newest at the bottom, with a type / mic / send bar), or both. Header **feed** / `F` still shows or hides the overlay; on a view narrower than four feed-widths the graph eases left by half the overlay (right when chrome is on the right).

Profiles: `~/.zoto-viz/profiles.yml`. Shipped id `netviz` is read-only.

Keyboard: `1–9`/`0` views, `D` dream, `F` feed, `R` redact, `T` theme.
