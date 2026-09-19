# Plugins

zoto-viz ships **one** plugin layout. First-party views live as git-tracked
trees at `plugins/src/<id>/`. The live view menu **is** that src catalog plus
any non-colliding contrib zips.

A zip is the **contrib interchange** format: drop `plugins/<id>.zip`, run
`plugin add`, or MCP `install_plugin_zip`. Those zips are gitignored; the
monitor unpacks them into `plugins/.runtime/<id>/`. They never replace a
shipped src tree.

New plugins invented by the operator, the local agent, or a remote MCP agent
land as zips in `~/.zoto-viz/plugins/local/<id>.zip` (`origin: local`). Drop a
zip there, or call `publish_local_plugin`. The monitor validates the zip
contract, unpacks to `~/.zoto-viz/plugins/local/.runtime/<id>/`, and activates
`plugin:<id>` when the plugin is YAML-only (or already consented). Override the
drop zone with `ZOTO_VIZ_PLUGIN_LOCAL`.

If `plugins/src/<id>/` already exists, a `plugins/<id>.zip` (or a zip whose
`plugin.yml` id is `<id>`) is a **scan error**: the zip is not loaded and the
src row stays.

`plugin pack` writes a shareable zip (`dist/<id>.zip` by default, or `-o`).
It does not write into the live drop zone. Src edits are live without packing.

The all-features sample fixture is `examples/plugins/sample/` (packed
`examples/plugins/sample.zip`). It is a zip-contract fixture, not a live
view-menu row. Default `scan()` does not walk `examples/`.

Consent stays per-user at `~/.zoto-viz/plugin-consent.yml`.

Host TypeScript keeps graph bases and arcade engines as wrap targets; every
former shipped view (`topology`, `talkers`, `doom`, …) is a src catalog tree.

Canonical schema: `schema/plugin.schema.json`. Contrib zip members, suffixes,
size limits, and hard rejects: `schema/plugin-zip-contract.md`.

## Plugin zip contract

A contrib plugin is `<id>.zip` whose **only required member** is `plugin.yml`
at the archive root. First-party trees use the same layout under
`plugins/src/<id>/`. Everything else is optional; folder presence is the
switch.

```
<id>.zip
  plugin.yml                 # required
  visualisation.yml          # optional (engine / base / look / style / layout / …)
                             # style.fabric: tubes|cloth|ribbon weaves nodes+edges as a mesh
  frontend/                  # optional TypeScript module (+ tests)
  sky/sky.yml                # optional sky recipe / pins
  sky/fragment.glsl          # optional custom far-field shader (GLSL)
  datasource/streams.yml     # optional consumes / produces + field mapping
  datasource/collector.py    # optional trusted collector
  backend/service.py         # optional on_snapshot / setup / teardown hooks
```

### Allowed member suffixes

`.yml` `.yaml` `.json` `.py` `.ts` `.tsx` `.js` `.mjs` `.css` `.html` `.md`
`.txt` `.svg` `.png` `.jpg` `.jpeg` `.webp` `.gif` `.glsl`

### Size limits

- 12 MB compressed (`12000000` bytes)
- 24 MB uncompressed (`24000000` bytes)
- at most 80 files

### Hard rejects

- absolute paths
- `..` traversal
- symlinks

Runtime enforcement is `service/plugin_zip.py` (`$defs/zipListing`,
`$defs/zipContract` in the schema).

## CLI

```bash
./zoto-viz plugin validate              # catalog (default)
./zoto-viz plugin validate plugins/src/lan-pulse
./zoto-viz plugin list
./zoto-viz plugin pack lan-pulse        # plugins/src/<id>/ → dist/<id>.zip
./zoto-viz plugin pack lan-pulse -o /tmp/lan-pulse.zip
./zoto-viz plugin add path/to/plugin.zip
./zoto-viz plugin add path/to/plugin.zip --force
```

`plugin zip` is a deprecated alias for `plugin add` (prints a deprecation line,
then copies). There is no `plugin install`. Machine-local sys-config and the
systemd drop-in are `./zoto-viz install` — see [Install](/install).

`plugin validate` checks schema and zip safety. It does not import Python.

`plugin add` copies into gitignored `plugins/<id>.zip`. `--force` overwrites an
existing contrib zip; it does **not** override a `plugins/src/<id>/` tree.

## Consent

Activating a plugin that ships TypeScript, a custom GLSL shader, or Python
(`backend/service.py` / `datasource/collector.py`) opens a review dialog.
YAML-only overlays skip it. Choose **I wrote this** or **I examined the
source**. If you did not write it, open the plugin folder in an AI IDE
(for example Cursor) and ask it to review `frontend/`, `sky/fragment.glsl`,
and any `backend/` / `datasource/` Python.

Consent is stored in `~/.zoto-viz/plugin-consent.yml` and is invalidated when
the sha256 of a sensitive artefact changes (`consented_for` on the stamp).

In-process plugin Python stays **off** unless `ZOTO_VIZ_PLUGIN_SERVICE=1` (or
`true` / `yes` / `on`) **and** the plugin has source-review consent. This is
trusted local code, not the TypeScript iframe sandbox. See
[TypeScript plugins](/plugins-ts) for the frontend sandbox.

Optional Python hooks (`backend/service.py`):

```python
def setup(host):
    host.log("loaded")

def teardown(host):
    host.log("unloaded")

def on_snapshot(host, msg):
    msg.setdefault("plugin_state", {})[host.plugin_id] = {"ok": True}
```

`host` has `.plugin_id`, `.state`, and `.log`. The monitor reloads when the
backend file changes (mtime), and immediately after MCP `install_plugin_zip`
when the zip includes `backend/` or `datasource/`. A failing hook is logged
and skipped; it does not take down capture. Changes to the monitor's own
`service/*.py` still need a process restart.

A plugin reuses a shipped `engine` (`graph` needs `base`; arcade engines
include `netpong`, `invaders`, `command`, `frogger`, `cpupong`, `doom`,
`waves`, `orbits`, `helix`, `skyline`, `pacman`, `tetris`, `portal`, `carousel`).
Optional `look` pins theme/sky/floor for that view — the settings drawer shows
those pins under **This view**, along with `options` / `config`, arcade knobs, and a per-view **prompt** (stored on the active profile; prefixes AI Dynamic and rebuilds it after a short pause).
The cog next to the view menu opens that tab. Network and system visibility live under
**Graph**. Host and subnet filters live under **Privacy**.

Examples: `plugins/src/lan-pulse/`, `plugins/src/pulse-ts/`, `plugins/src/doom/`, `plugins/src/hn-term/`, `plugins/src/stereo-gram/`.

## MCP

The monitor exposes a loopback MCP server at `POST /mcp` (Streamable HTTP JSON,
CSRF skipped, Host still loopback). Tools:

| Tool | Role |
| --- | --- |
| `list_features` | Catalog of every settable key (theme, view, feed, show, filters, anim/physics/mosaic/sky, plugins, agent look, dice) |
| `get_settings` | Startup profile + live temper/weather + queued UI patch |
| `set_settings` | Patch the open UI (same whitelist as an agent ` ```settings ` fence): theme, view, feed, show, filters, anim, plugins, agent look, dice on/periodMin/include/ceilings, shuffle/dice, plus temper/weather/control |
| `list_plugins` | Each catalog view's options, config, and prompt, with current profile values |
| `set_plugin` | `{ id, values }` — one view's knobs (including `prompt`) |
| `set_view` | `{ mode }` e.g. `plugin:command` |
| `set_agent` | `{ temper?, weather?, control? }` |
| `roll_dice` | One-shot roll of groups left on in Settings → Dice (theme, view, mosaic, feed, motion, physics, knobs by default; chrome placement stays). Does not toggle the header dice repeat switch. |
| `get_state` | Live LAN snapshot (`GET /api/state`) |
| `get_traffic` | `{ ip, peer?, since? }` recent packets |
| `get_rf_watch` / `set_rf_watch` | Wi-Fi SSID watch list and hopper plan |
| `consent_plugin` | `{ id, kind: reviewed\|authored }` |
| `draft_plugin` | `{ files, install? }` — same as `POST /api/ai/plugin` |
| `publish_local_plugin` | `{ zip_b64 \| files \| description }` → `~/.zoto-viz/plugins/local/<id>.zip`; hot-load + activate if safe |
| `list_profiles` / `apply_profile` | Saved looks |
| `list_memories` / `add_memory` / `delete_memory` | Curated chat memories |
| `list_sources` / `set_source` / `delete_source` | Host RSS / HTTPS / local-file registry (`~/.zoto-viz/sources.yml`) |
| `get_sdm` / `list_cameras` / `set_sdm` | Nest Device Access (`~/.zoto-viz/sdm.yml`; OAuth, Pub/Sub, WebRTC) |
| `install_plugin_zip` | Write gitignored `plugins/<id>.zip` (see guards below) |

Live patches ride the 1 Hz WebSocket as `live: { seq, patch, temper, weather }`.

Cursor MCP config (monitor must be running):

```json
{
  "mcpServers": {
    "zoto-viz-plugins": {
      "url": "http://127.0.0.1:7020/mcp"
    }
  }
}
```

```
publish_local_plugin { zip_b64 | files | description, overwrite?, activate? }
install_plugin_zip { zip_b64, overwrite?, force? }
```

`publish_local_plugin` is the remote-agent path for a **new** plugin: it never
touches the checkout. YAML-only zips activate on the open UI (`reloadPlugins` +
`set_view`). TypeScript / Python / GLSL still write the zip, then return
`consent-required`. Every new plugin gets a catalog-unique `id`: an explicit
id is slugged, then reminted (`<id>-2`, …) when src, a contrib zip, or a local
zip already uses it. Same-sha republish and `overwrite: true` keep the existing
id. A filesystem drop into
`~/.zoto-viz/plugins/local/*.zip` is picked up on a half-second loop (not
behind catalog Python reload) by the same validate → unpack → activate path
(the first watch pass only records existing zips so a restart does not steal
the current view).

Write-safety guards (the tool writes into gitignored `plugins/<id>.zip`):

1. **Loopback only** — Host must be loopback; hosted MCP is not on the roadmap.
2. **Unique id** — never write a second plugin under an id that src, a contrib
   zip, or the local drop zone already uses. Remint and return `remintedFrom`.
   `overwrite` / `force` update that zip in place; they still never write into
   `plugins/src/<id>/`.
3. **Overwrite** — `overwrite: true` replaces `plugins/<id>.zip` (or the local
   dest) when the sha256 differs. Same digest unpacks only. Without overwrite,
   a different payload remints instead of failing.
4. **Dirty tree** — refuse when the working tree has uncommitted changes to
   `plugins/src/<id>/` unless `force: true`. Gitignored zips and
   `plugins/.runtime/<id>/` are not dirty catalog paths.
5. **Never git-add or git-commit** — the response returns the written path.
6. **Consent** — if TypeScript, Python, or GLSL is present and the current
   stamp does not cover the new hashes, the tool still writes the zip then
   returns `error: consent-required` (`ok: false`, `consentRequired: true`).

Reminted response (src or another zip already used the requested id):

```json
{
  "ok": true,
  "id": "topology-2",
  "remintedFrom": "topology",
  "path": "~/.zoto-viz/plugins/local/topology-2.zip"
}
```

Dirty-tree response shape:

```json
{
  "error": "dirty_tree",
  "id": "sample",
  "paths": ["plugins/src/sample/plugin.yml"],
  "hint": "pass force: true to write despite uncommitted catalog changes"
}
```

Success / no-op (same sha256) returns `{ok, id, version, sha256, path, dir,
parts, wrote}`. `wrote` is `false` when the drop zone already had that digest.

## Agent draft flow

`POST /api/ai/plugin` validates a `{files, install}` tree (legacy `yaml` is
accepted as `plugin.yml`). With AI Control on and `install: true` it writes
`plugins/src/<id>/` and that tree is live. The hint is
`{id} is live at plugins/src/{id}/; share with zoto-viz plugin pack {id} -o dist/{id}.zip`.
It never packs or commits. See [Ollama agent](/agent).

## First-startup migration

On first start after upgrade, unknown plugins still sitting in the old user-dir
trees are copied into `plugins/src/<id>/` (no auto-pack, no auto-commit) with a
console line:

`[plugin-migrate] <id> copied to plugins/src/<id>/ — it is live in the catalog`

The legacy trees are left in place. See [Install](/install).
