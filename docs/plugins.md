# Plugins

zoto-viz ships **one** plugin layout. First-party views live as git-tracked
trees at `plugins/src/<id>/`. The live view menu **is** that src catalog plus
any non-colliding contrib zips.

A zip is the **contrib interchange** format: drop `plugins/<id>.zip`, run
`plugin add`, or MCP `install_plugin_zip`. Those zips are gitignored; the
monitor unpacks them into `plugins/.runtime/<id>/`. They never replace a
shipped src tree.

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
  visualisation.yml          # optional (engine / base / look / layout / …)
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

- 1.5 MB compressed (`1500000` bytes)
- 4 MB uncompressed (`4194304` bytes)
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
include `netpong`, `invaders`, `command`, `frogger`, `cpupong`, `doom`).
Optional `look` pins theme/sky/floor for that view — the settings drawer shows
those pins under **This view**, along with `options` / `config`, arcade knobs, and a per-view **prompt** (stored on the active profile; prefixes AI Dynamic and rebuilds it after a short pause).
The cog next to the view menu opens that tab. Network and system visibility live under
**Graph**. Host and subnet filters live under **Privacy**.

Examples: `plugins/src/lan-pulse/`, `plugins/src/pulse-ts/`, `plugins/src/doom/`.

## MCP

The monitor exposes a loopback MCP server at `POST /mcp` (Streamable HTTP JSON,
CSRF skipped, Host still loopback). Tools:

| Tool | Role |
| --- | --- |
| `list_features` | Catalog of every settable key (theme, view, feed, show, filters, anim/physics/mosaic/sky, plugins, agent look, dice) |
| `get_settings` | Startup profile + live temper/weather + queued UI patch |
| `set_settings` | Patch the open UI (same whitelist as an agent ` ```settings ` fence): theme, view, feed, show, filters, anim, plugins, agent look, dice include/ceilings, shuffle/dice, plus temper/weather/control |
| `list_plugins` | Each catalog view's options, config, and prompt, with current profile values |
| `set_plugin` | `{ id, values }` — one view's knobs (including `prompt`) |
| `set_view` | `{ mode }` e.g. `plugin:command` |
| `set_agent` | `{ temper?, weather?, control? }` |
| `roll_dice` | Header dice: randomize groups left on in Settings → Dice (theme, view, mosaic, chrome, feed, motion, physics, knobs by default) |
| `get_state` | Live LAN snapshot (`GET /api/state`) |
| `get_traffic` | `{ ip, peer?, since? }` recent packets |
| `get_rf_watch` / `set_rf_watch` | Wi-Fi SSID watch list and hopper plan |
| `consent_plugin` | `{ id, kind: reviewed\|authored }` |
| `draft_plugin` | `{ files, install? }` — same as `POST /api/ai/plugin` |
| `list_profiles` / `apply_profile` | Saved looks |
| `list_memories` / `add_memory` / `delete_memory` | Curated chat memories |
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
install_plugin_zip { zip_b64, overwrite?, force? }
```

Write-safety guards (the tool writes into gitignored `plugins/<id>.zip`):

1. **Loopback only** — Host must be loopback; hosted MCP is not on the roadmap.
2. **Src owns id** — refuse when `plugins/src/<id>/` exists (`error: src_owns_id`).
   `overwrite` / `force` do not override a shipped src tree.
3. **Overwrite** — refuse unless `overwrite: true` **and** `plugins/<id>.zip`
   differs by sha256 (mirrors CLI `--force`). Same digest unpacks only.
4. **Dirty tree** — refuse when the working tree has uncommitted changes to
   `plugins/src/<id>/` unless `force: true`. Gitignored zips and
   `plugins/.runtime/<id>/` are not dirty catalog paths.
5. **Never git-add or git-commit** — the response returns the written path.
6. **Consent** — if TypeScript, Python, or GLSL is present and the current
   stamp does not cover the new hashes, the tool still writes the zip then
   returns `error: consent-required` (`ok: false`, `consentRequired: true`).

Src-owned response shape:

```json
{
  "error": "src_owns_id",
  "id": "topology",
  "path": "plugins/src/topology",
  "hint": "force does not override a shipped src tree"
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
