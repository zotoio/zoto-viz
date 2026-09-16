# Sample plugin (zip-contract fixture)

This tree is a **zip-contract fixture**, not a shipped view. It exists so
pack, inspect, and `detect_parts` can exercise every optional zip root in
one place.

The live catalog is `plugins/src/<id>/`. Default `scan()` does not walk
`examples/`. Do not copy this tree into `plugins/src/`.

Share a zip with `plugin pack` (or drop a zip into `plugins/`). First-party
edits go live from src without packing.

`examples/plugins/sample.zip` is packed from this tree with
`plugin_zip.pack_tree`. Cross-machine zlib/DEFLATE bytes may differ; CI on
the pinned interpreter is the source of truth for pack byte-identity.
Core plugins are not re-packed for byte identity — src is canonical.
