# Contributing

- `pnpm start` / `pnpm stop` / `pnpm restart` (also `:frontend`, `:backend`, `:both`)
- After an agent turn that changed `service/*.py` or `zoto-viz`, a Cursor **stop** hook restarts the running monitor (`systemctl --user restart zoto-viz-monitor`, or `pnpm restart:backend`) so the new Python is loaded. Plugin `backend/service.py` hot-reloads without a bounce. Set `ZOTO_VIZ_NO_AUTO_RESTART=1` to skip.
- A running install fast-forwards its checkout every 5 minutes (`ZOTO_VIZ_PULL_S` / `ZOTO_VIZ_NO_AUTO_PULL=1`). After a pull it rebuilds the packed UI if needed, restarts the backend, and reloads the open browser tab.
- `pnpm pull:watch` (`scripts/pull-watch.sh`) does the same once a minute as a sidecar: `git pull --ff-only`, full `web/` rebuild, restart monitor + Vite, wait 10s, hard-reload the Chrome tab (CDP on 9222 or xdotool), then autoconsent and load plugin views that landed in the pull. Dirty trees are skipped. `--once` is one pass. Set `ZOTO_VIZ_NO_AUTO_PULL=1` on the monitor if this script should be the only puller.
- `cd web && pnpm test && pnpm build`
- `.venv/bin/python3 -m pytest tests -q -o addopts=`
- Do not commit `.venv`, `web/dist`, `data/`, pcaps, wifi-keys, `sys-config.yml`, `plugins/.runtime/`, `plugins/*.zip`, or `dist/`
- Plugins must pass `./zoto-viz plugin validate`
- Python lives in `service/` (`python -m service.monitor`). Plugin Python is `backend/service.py` inside a plugin source tree; it is hot-loaded only when `ZOTO_VIZ_PLUGIN_SERVICE=1` and the operator has consented, and is not imported during `plugin validate`
- TypeScript plugins must declare capabilities; never request camera or network
- GitHub Pages deploys `docs/.vitepress/dist` with `VITEPRESS_BASE=/zoto-viz/` (change if the repo name differs)

## Plugin authoring

Every live first-party view is a src tree (`plugins/src/<id>/`). Host graph bases and arcade engines (`web/src/arcade/`, `GRAPH_BASES`) are wrap targets, not extra menu rows. Src edits are live; do not pack a first-party zip to see the view, and do not commit one.

1. Edit `plugins/src/<id>/` (`plugin.yml` plus optional `visualisation.yml`, `frontend/`, `backend/`, `datasource/`, `sky/`).
2. `./zoto-viz plugin validate plugins/src/<id>`
3. Optional: `./zoto-viz plugin pack <id>` (or `-o path`) to share a zip. Default output is gitignored `dist/<id>.zip`.
4. `git add plugins/src/<id>/` only.

`plugin add path/to.zip` copies an already-packed zip into gitignored `plugins/<id>.zip` (`--force` to overwrite another zip). It refuses if `plugins/src/<id>/` already exists. MCP `install_plugin_zip` does the same write and never git-commits — see [Plugins](/plugins).

### Deterministic pack (zlib)

`plugin pack` sha256 is byte-stable on the **pinned Python + zlib in CI**, not necessarily across machines. A different zlib can change DEFLATE bytes and therefore the zip digest even when members are identical. Pack reproducibility is gated **only** for `examples/plugins/sample.zip` (`tests/test_plugin_sample.py::test_pack_tree_bytes_equal_committed_zip`). Core plugins are src-canonical; zlib drift on first-party zips is not gated.

Schema: `schema/plugin.schema.json`. Frontend sandbox: [TypeScript plugins](/plugins-ts).

## Regression tests

Each regression test must prove it catches its bug: the PR body shows the test red with the fix reverted and green with it applied. Do not add `revert-proofs/` trees on pack PRs; pack-boundary rejects that path.
