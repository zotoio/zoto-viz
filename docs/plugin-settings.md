# Plugin settings (host drawer)

## Where settings live

- **`settings`** (presets, `presetField`, HUD `labelFields`, collapsible sections) may live in `plugin.yml` and/or `visualisation.yml`.
- **`config`** field declarations usually live in `visualisation.yml`; legacy packs may use top-level `plugin.yml` `config` / `options`.

## Merge precedence (catalog → web)

When both files declare settings:

1. Start from `visualisation.yml` `settings`.
2. Overlay top-level `plugin.yml` `settings` (top-level wins on conflicts).

The same rule is used in Python (`service/plugins.py` `_settings_from_doc`) and TypeScript (`toPluginView` in `plugin-visualisation.ts`).

Legacy top-level **`presets` / `presetField` / `hud` / `sections`** on `plugin.yml` are still read when not present under `settings` (Python `_settings_from_doc`, TS `toPluginView` preset/hud/sections fallbacks).

## Validation

- `plugin.yml` is validated with the root plugin schema; **settings semantics** (preset keys, HUD fields, `randomRange`, etc.) run on the **merged** row after `visualisation.yml` is attached.
- `visualisation.yml` is validated against the `visualisation` subschema; list-shaped legacy `options` are checked in Python semantics. Config list rows may omit `type` (defaults to text in TS; semantics treat select when `values` are present).

## Reset behaviour

**Reset** restores preset-controlled fields and non-text config fields to instance defaults / field defaults / active preset values. **Text fields** (gateway, watch SSIDs, sources, etc.) are left unchanged so operator-entered strings are not wiped.

## Mosaic HUD

There is a **single** stage HUD line. In mosaic mode it shows the **focused tile’s** settings caption (per-mode caption map keyed by `plugin:<id>` or `plugin:<id>:<instance>`), not separate overlays per tile.
