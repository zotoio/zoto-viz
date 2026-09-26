---
name: zoto-viz-mcp
description: >-
  Drive the running zoto-viz monitor through its loopback MCP server
  (zoto-viz-plugins at POST /mcp). Switch views, patch theme/mosaic/feed/anim,
  consent and publish plugins, read LAN/RF state, manage sources and memories.
  Use when changing the live UI, adding or installing a plugin, setting a view,
  rolling dice, or the user mentions MCP, set_view, publish_local_plugin,
  install_plugin_zip, plugin: ids, or the monitor on :7020.
---

# zoto-viz MCP

The live monitor is the source of truth for **what is on screen**. Edit checkout files for shipped code; use MCP to **apply**, **activate**, **consent**, and **inspect** the running UI.

Monitor must be up: `http://127.0.0.1:7020/` (UI) and `POST http://127.0.0.1:7020/mcp`. CSRF is skipped on `/mcp`; Host must be loopback.

## Call the server

**Prefer Cursor MCP** when a namespace named `zoto-viz-plugins` (or similar) is connected. Discover the tool schema, then call it.

**Otherwise** JSON-RPC over HTTP (no session required):

```bash
curl -sS -X POST http://127.0.0.1:7020/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL","arguments":{}}}'
```

`GET /mcp` lists tool names. `tools/list` returns full schemas. Live patches ride the 1 Hz WebSocket — wait ~1s, then look at the open UI.

If curl fails, start the backend (`scripts/dev.sh start backend` or `systemctl --user start zoto-viz-monitor`).

## Pick a path

| Goal | Do this |
| --- | --- |
| Switch VIEW | `set_view` `{ "mode": "plugin:<id>" }` |
| Theme, mosaic, feed, motion, sky | `list_features` → `set_settings` (whitelist only) |
| One view's knobs / prompt | `list_plugins` `{id}` → `set_plugin` `{id, values}` |
| Temper / weather / AI Control | `set_agent` |
| One-shot dice | `roll_dice` (does not toggle header repeat) |
| Read LAN / packets / RF | `get_state` / `get_traffic` / `get_rf_watch` |
| **New shipped plugin** (git) | Write `plugins/src/<id>/`, `./zoto-viz plugin validate`, then `consent_plugin` + `set_view` |
| **New local experiment** | `publish_local_plugin` `{files}` → `~/.zoto-viz/plugins/local/<id>.zip` |
| **Contrib zip in checkout** | `install_plugin_zip` `{zip_b64}` → gitignored `plugins/<id>.zip` |
| TS / GLSL / Python will not run | `consent_plugin` `{id, kind: "authored"\|"reviewed"}` — or `set_settings` `{autoconsent: true}` for dogfood (src + local only; see [viz-test](../zoto/viz-test/SKILL.md)) |
| RSS / file / journal headlines | `list_sources` / `set_source` |
| Extra catalog row on a shipped plugin | `set_plugin_instance` (do not copy the tree) |

Never use MCP to `git add` / `git commit`. Camera and microphone are operator-only (Settings → Privacy) — do not patch them.

## Live UI patches

`set_settings` is the same whitelist as an in-app ` ```settings ` fence:

- `theme`, `mode` (`plugin:<id>`), `chrome` (top/left/right), `dream`, `redact`, `merge`, `autoconsent` (auto-grant consent for shipped src + local plugins; not contrib zips), `sound` (speaker output: plugin SFX, arcade, spoken replies; starts off)
- `feed` `{on, source, layout, scope, modulate, includeSources, density, textSize}`
- `show`, `filters`, `anim` (motion / physics / mosaic / sky / audio, including `mosaicTiles`, `mosaicTree`, `mosaicSharedTheme`, `mosaicUniqueSkies`, `mosaicSkies`, `graphFabric`, `graphSpace`, `graphLayout`, `graphLinks`)
- `plugins` / `modeOptions` / `arcade`, `agent` `{clear, shader, shaderPhoto, decos}`
- `dice`, `shuffle`, `temper`, `weather`, `control`, `model`

`get_settings` is the **startup profile plus the queued patch**, not a guaranteed pixel-perfect live snapshot. Confirm on the open UI.

View ids are catalog rows: `plugin:topology`, `plugin:syscon`, `plugin:cypher-cic`. Instances: `plugin:<id>` or `plugin:<id>:<instance>`.

## Add or change a plugin

Shipped layout (`plugins/src/<id>/`):

```
plugin.yml                 # required
visualisation.yml          # engine + base + look
frontend/index.ts          # viz.read / viz.write
sky/fragment.glsl          # allowed uniforms only: uTime uOpacity uBright uAudio uAccent uBg
```

- **Checkout / first-party:** write the tree, validate, consent, `set_view`. `draft_plugin` `{files, install: true}` also writes `plugins/src/<id>/` when AI Control is on.
- **Local (not git):** `publish_local_plugin` `{files}` or `{zip_b64}` or `{description}`. YAML-only activates; code-bearing returns `consent-required`. Colliding ids remint (`<id>-2`). `overwrite: true` updates that local zip only. Never writes `plugins/src/`.
- **Contrib zip:** `install_plugin_zip` `{zip_b64}`. Never writes `plugins/src/`. Dirty `plugins/src/<id>/` needs `force: true`.

After a code-bearing zip or src shader/frontend change: `consent_plugin` then `set_view`. Sky GLSL is 403 until consent. Shader cap **128,000 characters**; no `#include`; no extra uniforms.

Mosaic wall skies bind from the **selected wall row** when that row ships a plugin sky (`pickPluginSkySpec`). Put real graph tiles in `look.mosaicTiles` (not the wall id). Verify the canvas — `sky_available` is not proof. Near-black `(≈5,10,22)` means the sky failed.

Do **not** write `uBright` every frame (look slider must win). Set `look.skyAudio: false` unless pulse-driven fade is intended.

## Verify screens

After any live view / sky / mosaic / chrome change:

1. Open `http://127.0.0.1:7020/` or the Vite port and select the VIEW.
2. Screenshot **and** sample WebGL pixels (center + a side).
3. HUD view label must match; graph/feed must not bury a stage-only sky unless that is the point.

## Hard rules

- Loopback only. Do not point hosted MCP at this server.
- Do not overwrite `plugins/src/<id>/` via zip tools.
- Do not commit from MCP. Return the written path; the operator promotes.
- `roll_dice` is one shot. Header dice repeat is `set_settings` `{dice: {on, periodMin}}`.
- Feed float box is localStorage `zoto-viz.float.feed` (not MCP).

## More

- Tool schemas, curl recipes, and plugin-file examples: [reference.md](reference.md)
- Catalog / zip contract: `docs/plugins.md`, `docs/plugins-viz.md`
- Agent + Control fences: `docs/agent.md`
