# Host reverse-boundary lint fixtures

Used by `web/src/plugins/pack-lint.test.ts` (not scanned from `web/src` directly).

## CI matrix (`host-imports-pack-src`)

| Fixture | Form | CI |
|---------|------|-----|
| `bad/static-pack-import.ts` | static `import` | **FAIL** |
| `bad/dynamic-pack-import.ts` | dynamic `import()` | **FAIL** |
| `bad/alias-pack-import.ts` | tsconfig `paths` alias | **FAIL** |
| `bad/reexport-named-pack.ts` | `export { … } from` | **FAIL** |
| `bad/reexport-star-pack.ts` | `export * from` | **FAIL** |
| `bad/require-pack.ts` | `require()` | **FAIL** |
| `bad/glob-pack.ts` | `import.meta.glob` | **FAIL** |
| `bad/loader-bypass-pack-source.ts` | `module.js` / `/api/.../..` → `plugins/src` source | **FAIL** |
| `bad/raw-pack-import.ts` | static `import` with Vite `?raw` into `plugins/src/**` | **FAIL** |
| `bad/url-pack-import.ts` | static `import` with Vite `?url` into `plugins/src/**` | **FAIL** |
| `clean/plugin-yml-presets.ts` | `readFileSync` on `plugin.yml` | **PASS** |
| (inline) `/api/plugins/<id>/module.js` | real loader URL | **PASS** |

**Allowed production path:** `PluginSandbox.loadModule` → `fetch(pluginModuleUrl(...))` → `/api/plugins/<id>/module.js` with no `..` segments. Paths that resemble the loader but normalize into `plugins/src/**` are violations.
