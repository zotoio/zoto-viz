---
name: zoto-viz-test
description: >-
  Visually verify every zoto-viz VIEW/plugin on a running monitor: enable
  autoconsent, dice off, wait for real graph/data (not sky/floor alone), DOM +
  screenshot + console + logs. Use when dogfooding packs, after plugin/sky/idle
  changes, when the user asks to cycle views, screenshot views, or check
  empty-board / mock data paint.
---

# zoto-viz visual VIEW test

Systematically cycle every catalog VIEW on a running monitor and **fail** any view that shows only sky/floor/backdrop when the pack should render data. Screenshots and DOM checks are evidence; `sky_available` and HUD labels alone are not.

**Standing rule:** every shipped plugin declares a **golden mock** (idle/sim/demo) so empty boards still paint meaningful content. Change-gated screenshots must never depend on live traffic.

## Preconditions

1. Monitor UI is up: `http://127.0.0.1:7020/` (or the Vite dev port) and `POST /mcp` on loopback.
2. **Visible computer-use Chrome (required).** When testing zoto-viz (or any UI) in a browser, drive the **visible computer-use Chrome** session so the operator can watch. Headless capture is optional supplementary evidence only — never a substitute for operator-facing verification.
3. Load the catalog: `GET http://127.0.0.1:7020/api/plugins` (or `list_plugins` via MCP). Every row is a `plugin:<id>` mode to test.
4. **Enable autoconsent** before cycling views — one MCP call so code/GLSL packs are not blocked by the consent dialog:

```json
{"name":"set_settings","arguments":{"autoconsent":true}}
```

This auto-grants consent for **shipped** `plugins/src/<id>/` trees (`authored`) and **local** `~/.zoto-viz/plugins/local/*.zip` packs (`reviewed`). It does **not** consent arbitrary contrib zips in `plugins/*.zip` — those still need `consent_plugin`. Persist via Settings → Privacy → **auto-consent plugins**, or leave the MCP patch applied for the session.

5. **TypeScript plugins** — if any view ships `frontend/`, ensure Settings → Agent → **allow TypeScript plugins** is on.
6. Drive the UI in `plugin:<id>` mode — one view at a time.

See also: [zoto-viz-mcp](../zoto-viz-mcp/SKILL.md) for tool schemas and [reference.md](../zoto-viz-mcp/reference.md).

## Golden mock (required per plugin)

Before cycling views, confirm each catalog id ships a verifiable golden set:

| Plugin kind | Where to look | Pass bar |
| --- | --- | --- |
| **Demo / viz packs** (`viz.read` / `viz.write`) | `plugin.yml` → `viz.idle.fixture: host` | Host `buildIdleVizFrame()` seeds packets / RF / talkers / headlines when live slices are empty (`web/src/plugins/fixtures/idle-viz-frame.ts`) |
| **Graph / arcade menu plugins** | `visualisation.yml` → `idle.fixture: host` | Host `goldenLanFixture()` merges LAN / CPU / source demo when capture is quiet (`web/src/plugins/fixtures/golden-lan-state.ts`) |
| **Inline custom seed** | `plugin.yml` → `viz.idle` inline slices | Non-empty `packets` / `rf` / `talkers` / `headlines` arrays in YAML |

Quick audit:

```bash
# every shipped src plugin — viz.idle or visualisation.idle must be host
rg -l 'fixture: host' plugins/src/**/plugin.yml plugins/src/**/visualisation.yml
pytest tests/test_plugin_catalog.py -k golden_idle
```

CI gate: `test_every_shipped_plugin_has_golden_idle` in `tests/test_plugin_catalog.py`.

When live capture is empty, the VIEW test **Pass** bar is the golden set above. **Fail** on near-black `(≈5,10,22)`, chrome-only, or sky/floor/backdrop alone.

## Hard controls (every view)

Apply once before cycling; re-check if settings drift:

| Control | Setting |
| --- | --- |
| **Dice** | **OFF** — header repeat dice and one-shot `roll_dice` must not advance views during the run |
| Dream / AI auto-cycle | **OFF** — no `dream` rotation or agent-driven view shuffle |
| **Autoconsent** | **ON** for dogfood — `set_settings` `{autoconsent: true}` (src + local only; contrib zips still need `consent_plugin`) |

Use MCP `set_settings` or the in-app controls. See [zoto-viz-mcp](../zoto-viz-mcp/SKILL.md) for tool names and curl recipes.

## Per-view protocol

For **each** catalog `plugin:<id>`:

1. **Switch** — `set_view` `{ "mode": "plugin:<id>" }` (or select the VIEW in the UI). Confirm the HUD view label matches.
2. **Wait** — **full 10 seconds** on the view. Do not screenshot or pass early; graph layout, idle packets, and mock feeds need time to paint.
3. **Pass criteria** — expected plugin **data or imagery** is visible:
   - graph nodes and edges
   - metric particles / telemetry glyphs
   - images, stills, or video frames
   - game playfield / arcade canvas
   - idle or demo packets on the feed or stage
4. **Fail** — sky, floor, or backdrop **alone** when the pack should show data. Empty board, black canvas, chrome-only HUD, or golden mock that never painted = **Fail**.

If a pack was just edited in git (`plugins/src/`), reload or `set_settings` `{ "reloadPlugins": true }` before verifying — DevTools hot patches are not the shipped screen.

## After the 10-second wait

On each view, capture and inspect:

1. **Screenshot** — full canvas including HUD.
2. **HUD** — pack name, metric line, and skip counters look sane (not stuck, not blank when data should flow).
3. **DOM** — graph SVG/canvas, feed rows, mosaic tiles, or plugin root elements present when the pack defines them.
4. **Console** — no uncaught errors or WebGL shader compile failures for this view.
5. **Backend logs** — no repeated 403/500, consent blocks, or plugin load errors for the active id.

Sample WebGL pixels (center + a side) per [.cursor/rules/verify-screens.mdc](../../rules/verify-screens.mdc).

## Consent without autoconsent

When autoconsent must stay **off** (normal operator use):

```json
{"name":"consent_plugin","arguments":{"id":"<id>","kind":"authored"}}
```

Use `authored` for first-party src trees; `reviewed` for local zips you examined but did not write. Then `set_view`.

## Failure triage

| Symptom | Check |
| --- | --- |
| Black / near-black sky | Consent (`consent_plugin` or autoconsent), shader compile (`sky_error`), `look.backdrop` = `plugin` |
| Consent modal blocks UI | `autoconsent: true` or manual `consent_plugin` |
| TS plugin empty | Agent → allow TypeScript plugins; `spec.consent` on `/api/plugins` |
| Wrong view label | `set_view` mode string vs mosaic tile focus |

## Reporting

| Result | When |
| --- | --- |
| **Pass** | Data/imagery visible after 10s (live or golden mock); HUD matches; no blocking console/log errors |
| **Fail** | Sky/floor only, empty board, wrong view label, or errors — note the `plugin:<id>` and evidence |
| **Skip** | Operator explicitly excludes a view (document why) |

Do not declare the run complete while any required view is **Fail**. Fix or file an issue, then re-run the failed ids.

## Hard rules

- Do not declare done on a black or swapped view.
- Autoconsent does not weaken hash invalidation: stale consent still fails until re-granted (autoconsent re-grants only for eligible origins).
- Contrib zips (`origin: zip`) are never auto-consented — explicit `consent_plugin` required.

## Related

- Drive views and settings: [zoto-viz-mcp](../zoto-viz-mcp/SKILL.md)
- Pixel and sky traps after live patches: [.cursor/rules/verify-screens.mdc](../../rules/verify-screens.mdc)
- Plugin layout, viz.idle contract, and consent: `docs/plugins.md`, `docs/plugins-viz.md`
