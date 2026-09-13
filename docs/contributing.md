# Contributing

- `pnpm start` / `pnpm stop` / `pnpm restart` (also `:frontend`, `:backend`, `:both`)
- `cd web && pnpm test && pnpm build`
- `.venv/bin/pytest tests`
- Do not commit `.venv`, `web/dist`, `data/`, pcaps, wifi-keys, or `sys-config.yml`
- Plugins must pass `./zoto-viz.py plugin validate`
- Python lives in `service/` (`python -m service.monitor`). Plugin Python is `service/` inside a directory plugin; it is hot-loaded only when `ZOTO_VIZ_PLUGIN_SERVICE=1` and the operator has consented, and is not imported during `plugin validate`
- TypeScript plugins must declare capabilities; never request camera or network
- GitHub Pages deploys `docs/.vitepress/dist` with `VITEPRESS_BASE=/zoto-viz/` (change if the repo name differs)
