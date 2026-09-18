# TypeScript plugins

Optional `frontend/` in a catalog plugin compiles with esbuild and loads in a
sandboxed iframe. Three.js is external and unavailable to the bundle.

Author under `plugins/src/<id>/`. That tree is live — no `plugin pack` step to
see the iframe. Contrib zips unpack into `plugins/.runtime/<id>/` and compile
from there.

Layout (convention-over-config):

```
plugins/src/<id>/
  plugin.yml                 # frontend.entry, capabilities
  frontend/index.ts          # default entry
  frontend/index.test.ts     # optional
```

`plugin.yml` may set `frontend.entry` (default `frontend/index.ts`) and a
capability allowlist. YAML-only plugins skip this page.

Example: `plugins/src/pulse-ts/` (TypeScript iframe plus a `backend/` Python
module hot-loaded by the monitor). See [Plugins](/plugins) for the contrib zip
layout, consent, and Python.

## Capability allowlist

Only these capabilities are granted (`web/src/plugins/host.ts`):

- `graph.read` — tick with `{id, rate, role}[]`
- `graph.style` — `setStyle` / `setNodeColor`
- `ui.overlay` — reserved
- `config.read` — plugin config fields

Unknown capabilities fail `plugin validate` / catalog scan. Never granted:
camera, mic, parent DOM, `fetch`, `eval`.

Settings → Agent: **allow TypeScript plugins** (on by default). The first time
you switch to a TypeScript (or Python / GLSL) plugin, a modal asks you to
confirm you wrote it or examined the source. A new compile hash asks again.
Consent is `~/.zoto-viz/plugin-consent.yml` (see [Plugins](/plugins)).

## Iframe sandbox (`PluginSandbox`)

`web/src/plugins/host.ts::PluginSandbox` creates a hidden iframe with:

- `sandbox="allow-scripts"` (no `allow-same-origin`)
- CSP: `default-src 'none'; script-src 'unsafe-inline' blob:; connect-src 'none'; img-src data:; style-src 'unsafe-inline'`

The compiled bundle is inlined as a module script next to a small host SDK
(`globalThis.zoto`). Parent ↔ iframe messages are typed (`zoto-viz-host` /
`zoto-viz-plugin`). Style writes are dropped unless `graph.style` is in the
filtered cap list.

## Module URL

`PluginSandbox.loadModule` fetches the compiled bundle then calls `load`:

```
GET /api/plugins/<id>/module.js
GET /api/plugins/<id>/module.js?h=<compile-hash>
```

`pluginModuleUrl(id, hash?)` in `host.ts` builds that path. The hash query is
cache-busting. `GET /api/plugins/<id>/module.js` always serves the compiled
bundle (404 if missing); it does **not** 403 on missing consent. Consent for
frontend is a UI/sandbox gate: Settings → Agent **allow TypeScript plugins**
plus source-review consent must both be in place before `loadTsPlugin` fetches
the bundle and `PluginSandbox` inlines it. CSP on the response is locked down
(javascript, no network).

Custom sky shaders **are** HTTP-gated — `api_sky` 403s without review and 404s
if the shader is missing:

```
GET /api/plugins/<id>/sky/fragment.glsl
GET /api/plugins/<id>/sky/fragment.glsl?h=<shader-sha256>
```
