# TypeSafe / Jev opt-in (`typesafe` capability)

TypeSafe Sense is a **third-class** host capability — separate from `viz.read` /
`viz.write` and `graph.read`. It is **dark by default**: the browser never loads
an SDK unless the pack declares `capabilities: ["typesafe"]` **and** the user
opts in.

Results are written only to the shadow channel `plugin_state.typesafe`. They
never touch the viz UBO, Gate 2 skip paths, or the main graph.

## API key (live Sense via monitor proxy)

The TypeSafe API key stays in the **monitor process** only — never in the
browser bundle or plugin pack.

1. Copy `.env.example` → `.env` next to the monitor (or export in the service env)
2. Set:

```bash
TYPESAFE_API_KEY=ts_…
```

3. Restart the monitor (`python -m service.monitor` or your systemd unit)

The browser calls `POST /api/typesafe/sense` (proxied through Vite in dev).
When the key is missing on the host, the proxy returns **503** and the UI fails
closed with `skipped: "no-api-key"` (no network from the stub path).

Pack `questions` are mapped to TypeSafe **Noul** (yes/no) prompts server-side.
Phrase prompts as yes/no questions (e.g. “Is LAN traffic elevated?”).

## Pack contract (`plugin.yml`)

```yaml
capabilities:
  - typesafe
typesafe:
  questions:
    - id: lan-health
      prompt: "Is LAN traffic elevated relative to baseline?"
  stateRemap:
    devices: nodes   # optional rename before Sense
```

Optional root `typesafe.yml` is merged by the catalog scanner when inline
`typesafe:` is absent. Schema: `schema/plugin.schema.json` → `$defs/typesafeContract`.

## Three enable shapes

| Shape | How | Sense mode |
| --- | --- | --- |
| **Continuous** | `?typesafe=1` or `localStorage` key `zoto-viz.typesafe=1` | Every monitor tick when present headroom allows |
| **Freeze** | `?sense=1` | One-shot on the next tick (no headroom gate) |
| **Replay** | `?sense=replay` | Replays the last freeze payload (no SDK call) |

Continuous Sense uses the **rAF present clock** (`markPresent` / `markFrame`), not
monitor `state.ts`. It runs only when present-to-present is under **16.7 ms**
and **headroom ≥ 4 ms**. At soft FPS (~29 ms interval) Sense is skipped
(`over-budget` or `no-headroom`) without calling the proxy.

Freeze and replay are user-initiated and bypass the continuous headroom gate.

## Verify locally

```bash
cd web && pnpm install
pnpm exec vitest run src/plugins/typesafe-host.test.ts src/core/present-clock.test.ts
python3 -m pytest tests/test_typesafe_proxy.py tests/test_plugin_schema.py::test_typesafe_capability_in_schema -q -p no:cov
```

CI asserts: capability off ⇒ zero proxy calls; host without key ⇒ `no-api-key`
skip; no live TypeSafe API in unit tests.
