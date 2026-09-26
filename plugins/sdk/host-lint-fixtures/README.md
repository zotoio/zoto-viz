# Host reverse-boundary lint fixtures

Used by `web/src/plugins/pack-lint.test.ts` (not scanned from `web/src` directly).

- `bad/` — static import, dynamic `import()`, and tsconfig-style alias into `plugins/src/**`
- `clean/` — reads `plugin.yml` via `fs` without importing pack modules

Allowed production path: `fetch(pluginModuleUrl(...))` → `/api/plugins/<id>/module.js` (see `pack-lint-host.ts`).
