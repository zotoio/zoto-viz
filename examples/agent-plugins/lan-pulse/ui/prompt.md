Generate a unique overlay for **LAN Pulse**.

This plugin consumes live **devices**, **flows**, and the **feed** ticker, and produces **graph** heat, a compact **hud** caption, and **plugin_state** from the backend tick counter.

Stylising suggestion with reason: treat the LAN as a night harbour — bright wakes are talkers, quiet berths are idle hosts — because consumes are rate-bearing device/flow streams and the operator is watching who is loud, not drawing a textbook topology. Prefer a multidimensional graph of (rate × role) plus ascii harbour marks; if you emit impression stills, characters only in 50%.

Keep the frontend script's `zoto.onTick` / `setStyle` contract. Do not fetch.
