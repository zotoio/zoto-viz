# YAML plugins

Drop YAML into `~/.zoto-viz/plugins` (`*.yml` or `*/plugin.yml`). Schema: `schema/view-plugin.schema.json`.

```bash
./zoto-viz.py plugin install
./zoto-viz.py plugin validate
./zoto-viz.py plugin list
```

Install also writes `~/.zoto-viz/sys-config.yml` (machine-local ifaces and SSIDs) and fills the Air SSIDs watch default from it.

A plugin reuses a shipped `engine` (`graph` needs `base`). Optional `look` pins theme/sky/floor for that view — the settings drawer shows those pins under **This view**.

Same `id` as a shipped mode overlays look only; it does not add a second menu row.

Activating a plugin that ships TypeScript or a Python `service` module opens a review dialog. YAML-only overlays skip it. Choose **I wrote this** or **I examined the source**. If you did not write it, open the plugin folder in an AI IDE (for example Cursor) and ask it to review the TypeScript and any `service/*.py` files. Consent is stored in `~/.zoto-viz/plugin-consent.yml` and is invalidated when the compile hash or service path changes.

## Python service modules

In-process plugin Python is **off** unless `ZOTO_VIZ_PLUGIN_SERVICE=1` (or `true` / `yes` / `on`) **and** the plugin has a source-review consent. A directory plugin (`plugin.yml`) may ship Python that the monitor then hot-loads. This is trusted local code, not the TypeScript iframe sandbox.

Layout (auto-detected):

```
my-view/
  plugin.yml
  service/__init__.py   # or service.py at the plugin root
```

Or set `service: path/to/mod.py` in YAML (must stay inside the plugin directory). Optional hooks:

```python
def setup(host):
    host.log("loaded")

def teardown(host):
    host.log("unloaded")

def on_snapshot(host, msg):
    # `msg` is the 1 Hz snapshot dict, sent to /ws and GET /api/state
    msg.setdefault("plugin_state", {})[host.plugin_id] = {"ok": True}
```

`host` has `.plugin_id`, `.state`, and `.log` (the monitor does not pass the HTTP app). The monitor reloads the module when any `.py` under `service/` changes (mtime). A failing hook is logged and skipped; it does not take down capture.

`./zoto-viz.py plugin validate` checks that the file exists. It does not import it.

Example: `examples/plugins/pulse-ts/service/`.
