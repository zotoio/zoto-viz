---
name: generate-ui
description: Generate a unique zoto-viz plugin overlay from a plugin's consumes/produces datastreams and a stylising brief. Use when an agent plugin's ui.kind is prompt.
---

# Generate plugin UI

Produce **one** TypeScript overlay (`ui/index.ts`) plus **tests** (`ui/index.test.ts`) for this plugin. Do not reuse a previous composition. Non-deterministic on purpose: pick a fresh visual thesis each run.

## Inputs you must bind

Read the plugin `manifest.json` and the MCP `plugin_ui_brief` result.

- **consumes[]** — datastreams you may read (via `zoto.onTick` node rates and, when present, `plugin_state` on the snapshot).
- **produces[]** — datastreams you emit (style, overlay marks, plugin_state keys).
- **scripts/frontend** — keep calling the same `zoto` host API; do not invent `fetch`, camera, or parent DOM.
- **scripts/backend** — Python already writes `plugin_state[id]`; the overlay should display those fields, not recompute them.

## Stylising suggestion (required)

Open with a short **stylising suggestion** (2–4 sentences) that states:

1. the visual thesis (what the operator should *feel*)
2. **reason** it fits this plugin's consumes/produces
3. which of the allowed output media you will actually use this run

Then implement that thesis in TypeScript.

## Thoughtful output (pick several)

The overlay and/or comments/tests may include:

- **images** as data-URL SVG or canvas marks (no network)
- **ascii art** in an overlay string or HUD caption
- **multidimensional graphs** (at least two axes of live data: e.g. rate × role × count)
- **impression-based photos** — mood stills, not screenshots. **Characters only in 50%**: people, mascots, or faces appear in at most half of the generated stills; the rest are environment, infrastructure, or abstract data.

## Host contract

```ts
type Node = { id: string; rate: number; role: string };
declare const zoto: {
  onTick: ((nodes: Node[]) => void) | null;
  setStyle: (s: Record<string, unknown>) => void;
};
```

Capabilities never include camera, mic, parent DOM, or `fetch`.

## Tests

`ui/index.test.ts` must use `describe` / `it` (or `test`) and assert that the overlay reacts to a fake tick without throwing.

## Deliver

Return two files only, then call MCP `write_plugin_ui` with `entry_ts` and `tests_ts`.
