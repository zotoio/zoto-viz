# TypeSafe / Jev opt-in (`typesafe` capability)

TypeSafe Sense is a **third-class** host capability — separate from `viz.read` /
`viz.write` and `graph.read`. It is **dark by default**: the SDK is never loaded
unless the pack declares `capabilities: ["typesafe"]` **and** the user opts in.

Results are written only to the shadow channel `plugin_state.typesafe`. They
never touch the viz UBO, Gate 2 skip paths, or the main graph.

## API key (live Sense)

Live calls require a TypeSafe API key in env. Without it the host fails closed
with `skipped: "no-api-key"` (no network).

1. Copy `web/.env.example` → `web/.env.local`
2. Set your key (either name works):

```bash
VITE_TYPESAFE_API_KEY=ts_…
# or
TYPESAFE_API_KEY=ts_…
```

3. Restart the dev server after changing env: `cd web && pnpm dev`

**Resolution order:** `import.meta.env.VITE_TYPESAFE_API_KEY` →
`import.meta.env.TYPESAFE_API_KEY` → `process.env.TYPESAFE_API_KEY` →
`process.env.VITE_TYPESAFE_API_KEY` (Node/tests).

`VITE_*` keys are bundled into the browser build. Use a demo/local key only;
do not embed a production org key in a public deploy.

When a key is present, `createTypeSafeSdk()` lazy-loads `@typesafe-ai/sdk` and
maps pack `questions` to **Noul** (yes/no) prompts via `TypeSafeClient.systemOne`.
Phrase pack prompts as yes/no questions (e.g. “Is LAN traffic elevated?”).

When no key is set, the stub SDK path stays offline (CI-safe).

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
cd web && pnpm install
pnpm exec vitest run src/plugins/typesafe-host.test.ts src/plugins/typesafe-env.test.ts
```

CI asserts: capability off ⇒ zero SDK imports; no API key ⇒ `no-api-key` skip
with zero live network calls.
