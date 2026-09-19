<!-- fragment: contrib interchange layout; embed or point from docs/plugins.md -->

## Plugin zip contract

A zip is the **contrib interchange** format (`plugin add`, drop into
`plugins/`, MCP `install_plugin_zip`). First-party trees are
`plugins/src/<id>/` and use the same layout unpacked. A plugin zip's **only
required member** is `plugin.yml` at the archive root. Everything else is
optional; folder presence is the switch.

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

(Enforced by `service/plugin_zip.py`; canonical list is `$defs/zipContract`.)

### Size limits

- 12 MB compressed (`12000000` bytes)
- 24 MB uncompressed (`24000000` bytes)
- at most 80 files

### Hard rejects

- absolute paths
- `..` traversal
- symlinks

Canonical schema: `schema/plugin.schema.json` (`$defs/zipListing`,
`$defs/zipContract`). Runtime enforcement is `service/plugin_zip.py`.
