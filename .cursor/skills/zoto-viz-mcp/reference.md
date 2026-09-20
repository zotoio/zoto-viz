# zoto-viz MCP reference

Server: `zoto-viz-plugins` v3. Endpoint: `POST http://127.0.0.1:7020/mcp` (Streamable HTTP JSON-RPC 2.0). `GET /mcp` returns tool names.

## JSON-RPC

```bash
# discover
curl -sS http://127.0.0.1:7020/mcp
curl -sS -X POST http://127.0.0.1:7020/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# call
curl -sS -X POST http://127.0.0.1:7020/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_view","arguments":{"mode":"plugin:cypher-cic"}}}'
```

Result text is usually `content[0].text` JSON. `isError: true` means the tool failed.

Mutating REST (`PUT /api/plugins/{id}/consent`, `PUT /api/ai/control`) needs `X-Zoto-Viz-Csrf` from `GET /api/session`. Prefer the MCP tools instead.

## Tools

### Live UI

| Tool | Arguments | Notes |
| --- | --- | --- |
| `list_features` | — | Every settable key. Call first when unsure. |
| `get_settings` | — | Startup profile + queued `live` patch. |
| `set_settings` | whitelist object | Theme, `mode`, `anim`, `feed`, `show`, `filters`, `plugins`, `agent`, `dice`, `shuffle`, `temper`, `weather`, `control`, `model`. No camera/mic. |
| `set_view` | `mode` | Catalog id, e.g. `plugin:syscon`. |
| `list_plugins` | `id?` | Options / config / prompt. |
| `set_plugin` | `id`, `values` | `id` is bare (`cypher-cic` not `plugin:cypher-cic`). Values are strings (`"1"` / `"0"` for bools). |
| `set_agent` | `temper?` `weather?` `control?` | weather: hush \| drift \| pulse \| storm. |
| `roll_dice` | — | One shot. Does not flip header dice. |
| `list_profiles` | — | |
| `apply_profile` | `id` | Same patch path as `set_settings`. |

`set_settings` `anim` includes mosaic (`"off"` \| `"4"` \| `"6"` \| `"8"`), `hero` (`off` \| `left` \| `center` \| `right`), `mosaicTiles` (catalog ids), `mosaicTree`, `mosaicSharedTheme`, sky (`skyOpacity`, `skyBright`, `skySpeed`, `skyAudio`, `backdrop`), graph (`graphFabric`, `graphSpace`, `graphLayout` including fractal / FFT / data-structure ids such as `hilbert`, `spectrum`, `heap`, `graphLinks`, `focus`), physics, audio.

### Read LAN / RF

| Tool | Arguments |
| --- | --- |
| `get_state` | — (same as `GET /api/state`) |
| `get_traffic` | `ip` (addr, `@lan`, `@internet`, `@any`, or comma list), `peer?`, `since?` |
| `get_rf_watch` | — |
| `set_rf_watch` | `ssids`, `other?`, `dwell?`, `rotate?` |

### Plugins

| Tool | Arguments | Writes |
| --- | --- | --- |
| `consent_plugin` | `id`, `kind`: `authored` \| `reviewed` | `~/.zoto-viz/plugin-consent.yml` |
| `draft_plugin` | `files` or `yaml`, `install?` | `plugins/src/<id>/` only when Control on and `install: true` |
| `publish_local_plugin` | `zip_b64` \| `files` \| `description`, `id?`, `overwrite?`, `activate?` | `~/.zoto-viz/plugins/local/<id>.zip` |
| `install_plugin_zip` | `zip_b64`, `overwrite?`, `force?` | `plugins/<id>.zip` + `plugins/.runtime/<id>/` |
| `list_plugin_instances` | — | |
| `set_plugin_instance` | `plugin`, `id`, optional source/title/… | `~/.zoto-viz/plugin-instances.yml` |
| `delete_plugin_instance` | `plugin`, `id` | shipped instances stay |

`files` is a map of relative path → UTF-8 text. `plugin.yml` is required. Colliding ids remint unless `overwrite` updates that zip. Zip tools never write `plugins/src/`.

Consent kinds: **authored** = this agent/operator wrote it; **reviewed** = source was examined. Stamp invalidates when frontend / backend / collector / shader hashes change — consent again.

### Memories / sources / Nest

| Tool | Arguments |
| --- | --- |
| `list_memories` / `add_memory` | `text` on add |
| `delete_memory` | `id?` (omit = clear all) |
| `list_sources` / `set_source` / `delete_source` | source `type`: rss \| http \| file \| journal \| kmsg |
| `get_sdm` / `list_cameras` / `set_sdm` | Nest Device Access; `set_sdm` writes secrets to `~/.zoto-viz/sdm.yml` |

Remote source URLs must be public HTTPS. File paths stay under `$HOME`.

## Common calls

Switch wall + neon:

```json
{"name":"set_view","arguments":{"mode":"plugin:cypher-cic"}}
{"name":"set_settings","arguments":{"theme":"neon","feed":{"on":true,"source":"both"}}}
```

Plugin knobs (Cypher CIC rain / HUD):

```json
{"name":"set_plugin","arguments":{"id":"cypher-cic","values":{"rain":"1.2","glitch":"0.35","hud":"0.92"}}}
```

Publish a YAML overlay (local, not git):

```json
{
  "name": "publish_local_plugin",
  "arguments": {
    "files": {
      "plugin.yml": "id: demo-heat\nname: Demo heat\nversion: 1\n",
      "visualisation.yml": "engine: graph\nbase: talkers\nlook:\n  theme: neon\n"
    },
    "activate": true
  }
}
```

Consent after a src shader/frontend edit:

```json
{"name":"consent_plugin","arguments":{"id":"cypher-cic","kind":"authored"}}
{"name":"set_view","arguments":{"mode":"plugin:cypher-cic"}}
```

## Plugin sky / viz (when authoring)

- `capabilities`: `viz.read`, `viz.write`; add `config.read` if knobs exist.
- `viz.graphWalk` must be `false`. Slots: `writeBuffer(slot, float[])` → `zotoVizSlots`.
- Frontend must **not** write `uBright` every frame.
- `look.backdrop: plugin` + `sky/fragment.glsl`. Host injects uniforms + `vDir`.
- Multi-panel: `look.mosaic: "4"|"6"|"8"`, `hero`, `mosaicTiles: [plugin:…]`.
- Validate: `./zoto-viz plugin validate plugins/src/<id>`
- Shader max 16000 bytes (`service/plugin_sky.py`).

## Cursor IDE config

Monitor running, then in Cursor MCP settings:

```json
{
  "mcpServers": {
    "zoto-viz-plugins": {
      "url": "http://127.0.0.1:7020/mcp"
    }
  }
}
```

If that namespace is missing in a session, fall back to curl. Do not invent a hosted URL.
