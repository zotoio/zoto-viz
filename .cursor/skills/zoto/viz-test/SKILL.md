---
name: zoto-viz-test
description: >-
  Visually verify every zoto-viz VIEW/plugin on a running monitor: dice off,
  wait for real graph/data (not sky/floor alone), DOM + screenshot + console +
  logs. Use when dogfooding packs, after plugin/sky/idle changes, when the user
  asks to cycle views, screenshot views, or check empty-board / mock data paint.
---

# zoto-viz visual VIEW test

Systematically cycle every catalog VIEW on a running monitor and **fail** any view that shows only sky/floor/backdrop when the pack should render data. Screenshots and DOM checks are evidence; `sky_available` and HUD labels alone are not.

## Preconditions

1. Monitor UI is up: `http://127.0.0.1:7020/` (or the Vite dev port).
2. Use a **visible browser** when an operator is watching (screenshots alone are not enough for live dogfood).
3. Load the catalog: `GET http://127.0.0.1:7020/api/plugins` (or `list_plugins` via MCP). Every row is a `plugin:<id>` mode to test.
4. Drive the UI in `plugin:<id>` mode — one view at a time.

## Hard controls (every view)

Apply once before cycling; re-check if settings drift:

| Control | Setting |
| --- | --- |
| **Dice** | **OFF** — header repeat dice and one-shot `roll_dice` must not advance views during the run |
| Dream / AI auto-cycle | **OFF** — no `dream` rotation or agent-driven view shuffle |
| Consent | **Granted** for code/GLSL packs (`consent_plugin` with `authored` or `reviewed` as needed) |

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
4. **Fail** — sky, floor, stereogram, or backdrop **alone** when the pack should show data. Empty board, black canvas `(≈5,10,22)`, or mock data that never painted = **Fail**.
5. **Stereogram / sky occlusion** — if a stereogram layer or full-screen sky hides the viz underneath, that is **Fail** for data-bearing packs.

## After the 10-second wait

On each view, capture and inspect:

1. **Screenshot** — full canvas including HUD.
2. **HUD** — pack name, metric line, and skip counters look sane (not stuck, not blank when data should flow).
3. **DOM** — graph SVG/canvas, feed rows, mosaic tiles, or plugin root elements present when the pack defines them.
4. **Console** — no uncaught errors or WebGL shader compile failures for this view.
5. **Backend logs** — no repeated 403/500, consent blocks, or plugin load errors for the active id.

Sample WebGL pixels (center + a side) per [.cursor/rules/verify-screens.mdc](../../rules/verify-screens.mdc).

## Reporting

| Result | When |
| --- | --- |
| **Pass** | Data/imagery visible after 10s; HUD matches; no blocking console/log errors |
| **Fail** | Sky/floor only, occlusion, empty board, wrong view label, or errors — note the `plugin:<id>` and evidence |
| **Skip** | Operator explicitly excludes a view (document why) |

Do not declare the run complete while any required view is **Fail**. Fix or file an issue, then re-run the failed ids.

## Related

- Drive views and settings: [zoto-viz-mcp](../zoto-viz-mcp/SKILL.md)
- Pixel and sky traps after live patches: [.cursor/rules/verify-screens.mdc](../../rules/verify-screens.mdc)
- Plugin layout and consent: `docs/plugins.md`, `docs/plugins-viz.md`
