# TypeSafe / Jev opt-in (`typesafe` capability)

TypeSafe Sense is a **third-class** host capability — separate from `viz.read` /
`viz.write` and `graph.read`. It is **dark by default**: the SDK is never loaded
unless the pack declares `capabilities: ["typesafe"]` **and** the user opts in.

Results are written only to the shadow channel `plugin_state.typesafe`. They
never touch the viz UBO, Gate 2 skip paths, or the main graph.

## Pack contract (`plugin.yml`)

```yaml
capabilities:
  - typesafe
typesafe:
  questions:
    - id: lan-health
      prompt: "Summarize LAN chatter in one line."
  stateRemap:
    devices: nodes   # optional rename before Sense
```

The same shape may live in a root `typesafe.yml` merged by the catalog scanner
when present. Schema: `schema/plugin.schema.json` → `$defs/typesafeContract`.

## Three enable shapes

| Shape | How | Sense mode |
| --- | --- | --- |
| **Continuous** | `?typesafe=1` or Settings → `zoto-viz.typesafe=1` | Every monitor tick when headroom allows |
| **Freeze** | `?sense=1` | One-shot on the next tick (no headroom gate) |
| **Replay** | `?sense=replay` | Replays the last freeze payload (no SDK call) |

Continuous Sense runs only when **present-to-present** is under **16.7 ms** and
**headroom ≥ 4 ms** after the main feed path. Otherwise the host fails closed
(skips the Jev call, does not steal the frame).

Freeze and replay are user-initiated and bypass the continuous headroom gate.

## Verify locally

```bash
cd web && pnpm test src/plugins/typesafe-host.test.ts
```

CI asserts: capability off ⇒ zero SDK imports and zero `sense()` calls (mocked).

## No production keys

This repository ships a stub SDK (`web/src/plugins/typesafe-sdk.ts`) with **no
network** and **no API keys**. Do not wire a live TypeSafe endpoint unless tests
use mocks.
