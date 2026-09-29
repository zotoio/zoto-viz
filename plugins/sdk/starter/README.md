# Pack starter template

Copy this tree into `plugins/src/<your-id>/`, then lint and run on the monitor.

## 1. Copy and rename ids

```bash
cp -R plugins/sdk/starter plugins/src/my-pack
```

Edit **`plugins/src/my-pack/plugin.yml`**:

- Set `id: my-pack` (catalog id; used in zip paths and `/api/plugins/my-pack/…`).
- Set `name` / `hint` for humans.

`visualisation.yml` has **no** `id` field (the schema rejects one). The view id is `plugin:<packId>` from `plugin.yml` when the pack is installed.

## 2. Pack lint (must be clean — no baseline row)

From the repo root:

```bash
cd web && pnpm pack-lint ../plugins/src/my-pack
```

Or lint the template before copying:

```bash
cd web && pnpm pack-lint ../plugins/sdk/starter
```

## 3. Build / run the monitor

```bash
# backend (from repo root)
python zoto-viz.py monitor

# frontend
cd web && pnpm dev
```

Open the UI (Vite proxy, usually `http://127.0.0.1:5173/` → monitor on `:7020`).

## 4. First render

1. Consent/install the pack if prompted (local zip or `plugins/src` tree).
2. Open **VIEW** and pick **`plugin:my-pack`** (pattern `plugin:<plugin.yml id>`).
3. Confirm the plugin sky animates (`uTime` in `sky/fragment.glsl`) and bars move on host idle traffic (`visualisation.yml` → `idle.fixture: host`).

CI also runs `web/src/plugins/starter-pack-ci.test.ts` (zip → compile → WebGL smoke). Unit tests: `web/src/plugins/starter-template.test.ts`.

## Authoring notes

- `import type` from `plugins/sdk/viz-contract`; value-import `getVizZoto` from `plugins/sdk/viz-zoto` (`const host = getVizZoto();`).
- Held-pack migrations (#17, #19, #21, #22, #24, #29, #30, #31): replace `declare const zoto` / `globalThis.zoto` casts with `getVizZoto()` (see `plugins/sdk/README.md`).
- Value-import SDK runtime helpers (`talker-slots`, `viz-pack-host`); pack build bundles them into `module.js`.
- `getConfig?.()` once at init; `onConfig` for live updates (not inside `onFrame`).
- Sky `vDir` is a camera-relative ray looking down `-z` (plugin skies are parented to the camera since 2f44932a): use `rd.xy / -rd.z` (as `koi-pond` does), not a world dome like `dir.xz / (k + abs(dir.y))`. See [docs/plugins-viz.md](../../../docs/plugins-viz.md).
- `data-mapping.yml` documents fields; host reads mapping via pack files — there is no `dataMapping:` key in `visualisation.yml` today.
- **Idle source:** `plugin.yml` `viz.idle` is what the compile/consent path uses; keep `visualisation.yml` `idle.fixture: host` aligned for the graph view.
