# TypeScript plugins

YAML can set `runtime: typescript` and `entry: index.ts` in a directory plugin (`plugin.yml`).

The host compiles with esbuild (Three.js is external and unavailable). The bundle is loaded in a **sandboxed iframe** (`sandbox="allow-scripts"`, no `allow-same-origin`, `connect-src 'none'`).

Capabilities (allowlist only):

- `graph.read` — tick with `{id, rate, role}[]`
- `graph.style` — `setStyle` / `setNodeColor`
- `ui.overlay` — reserved
- `config.read` — plugin config fields

Never granted: camera, mic, parent DOM, `fetch`, `eval`.

Settings → Agent: **allow TypeScript plugins** (off by default). The first time you switch to a TypeScript (or Python-backed) plugin, a modal asks you to confirm you wrote it or examined the source. Use an AI IDE such as Cursor to review `index.ts` and any `service/*.py` before agreeing. A new compile hash asks again.

Example: `examples/plugins/pulse-ts/` (TypeScript iframe plus a `service/` Python module hot-loaded by the monitor).
