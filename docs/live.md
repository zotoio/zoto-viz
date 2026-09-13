# Live monitor

`python -m service.monitor` captures with `tshark`, discovers names, and serves `web/dist` plus `/ws` at 1 Hz.

Header: connection, brand, interface LEDs, rates, device counts.

Controls: **view**, mode options, **dream**, **feed**, **cam**, **AI**, settings cog.

Settings is one drawer with a left nav: Appearance, This view, Graph, Motion, Camera, Feed, Privacy, Agent.

Profiles: `~/.zoto-viz/profiles.yml`. Shipped id `netviz` is read-only.

Keyboard: `1–9`/`0` views, `D` dream, `F` feed, `R` redact, `T` theme.
