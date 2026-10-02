# VizPlugin host API

**New pack authors:** start from `plugins/sdk/starter/` — copy to
`plugins/src/<id>/`, run `cd web && pnpm pack-lint ../plugins/src/<id>`, then pick
view `plugin:<id>` on the monitor. See `plugins/sdk/starter/README.md`.

VizPlugins are demoscene-style shader packs that stay off the hot path. The
**host** owns ingest, decimation, and the **16.7 ms** frame budget; plugins
only consume pre-built data frames and write to **reserved buffer / uniform
slots** declared in `plugin.yml`.

## Contract (`plugin.yml`)

```yaml
capabilities:
  - viz.read    # receive VizDataFrame each monitor tick
  - viz.write   # writeBuffer / writeUniform (writeParticles is deprecated, see below)
viz:
  graphWalk: false          # required — plugins never walk the full graph
  presentTick: false        # opt-in: host sends VizPresentTick on rAF (requires viz.write)
  maxBuffers: 4             # reserved Float32 slots (1..8)
  maxBufferFloats: 64       # per-slot float cap (4..256)
  maxParticles: 512         # hard particle record cap (0 disables particles)
  uniforms:                 # sky uniforms this plugin may write
    - uBright
    - uAccent
  # ubo: optional explicit pin — omit to use the fixed host layout below
```

Canonical schema: `schema/plugin.schema.json` → `$defs/vizContract` and
`$defs/vizUboLayout`.

`viz.read` / `viz.write` are **separate** from `graph.read` monitor plugins.

### Fixed slot layout (`zotoVizSlots`)

| Field | Value |
| --- | --- |
| Logical block | `ZotoVizData` (schema id) |
| Host uniform | `uniform vec4 zotoVizSlots[128]` |
| Slots | 8 × 64 floats (16 vec4 each) |

Slot `s`, float `f` → `zotoVizSlots[s * 16 + f / 4][f % 4]`. The host
prepends a **plain** `vec4` array (not `layout(std140, binding=N)`) because
WebGL2 often rejects the `binding` qualifier and the plugin sky then draws
nothing. `writeBuffer` still fills the same 512-float mirror.

Capabilities `viz.read` and `viz.write` are validated at catalog scan time.
Unknown capabilities still fail closed.

## Data frames (host → plugin)

Each frame the host sends a **decimated** `VizDataFrame` (see
`web/src/plugins/viz-host.ts`):

| Field | Source | Cap |
| --- | --- | --- |
| `contract` | `1` on v1 plugin frames (lifetime talker counts); `2` on host v2 frames and plugin `init` when the pack declares contract 2 | — |
| `t`, `dt` | monitor timestamp | — |
| `audio` | scene pulse bass 0..1 | — |
| `packets[]` | flow proto tallies | 32 |
| `rf[]` | Wi-Fi watch SSIDs + RSSI | 24 |
| `talkers[]` | top devices — summed **sent packets/s** per host when flow rates exist; else lifetime packet counts (never mixed in one frame) | 24 |
| `talkers[].failed` | per-host TCP failure ratio 0..1 when link collection is **on** and the monitor reports `conn_fail`; omitted when collection is off | optional |
| `links[]` | directional host-pair **sent packets/s**; always present (possibly empty `[]` shared constant) when collection is on; omitted when off | 64 default |
| `linksDropped` | pairs over the cap | optional |
| `headlines[]` | host sources: RSS titles + `summary` blurbs, HTTP JSON strings, file lines (`kind`) | 8 |

When `~/.zoto-viz/sys-config.yml` sets `viz_frame_links: false`, the host still
stamps `contract` but omits `links[]`, `linksDropped`, and `talkers[].failed`.
When link collection is **on** but no pairs qualify, the host sends **`links: []`**
(empty array), not a missing key.
Optional keys: `viz_frame_links` (default `true`), `viz_frame_links_max` (1..256,
default `64`). Resolved into `state.host.vizFrame` on each `/api/state` snapshot.

Plugins must **not** request or traverse the full device graph. Use
`graph.read` only when you need the legacy `{id, rate, role}` tick.

Copy or type-only-import `plugins/sdk/viz-contract.ts` in packs. The host
advertises `VIZ_CONTRACT_VERSION` on sandbox `init` (`contractVersion`).

### Present tick (opt-in, `viz.write`)

When `viz.presentTick: true`, the host sends one `VizPresentTick` per sandbox
per display frame (mosaic panes may share one iframe). Fields:

| Field | Meaning |
| --- | --- |
| `frameMs` | rAF timestamp (ms) |
| `tileId` | **pack id** (not instance / mosaic slot). Reserved until Andrew decides one-sandbox-per-tile vs per-pack; re-scoped with `aspect` in **contract v3** (after #27). |
| `pluginClock` | host sky clock in seconds — monotonic, global, always sent; per-frame `dt` clamped to **0.25 s before** speed scaling; rate follows the motion slider and scene pulse (up to **2.4×** at full pulse) |
| `aspect?` | **w/h of the stage tile** the sandbox draws into (contract **v3**, with `tileId`). Not iframe size — do not use `innerWidth`/`innerHeight` alone. In mosaic, host currently sends the **main camera** aspect while reserved. |

```ts
import type { VizZoto } from "../../plugins/sdk/viz-zoto";

const zoto = globalThis.zoto as VizZoto;
zoto.onPresent = (tick) => {
  zoto.writeBuffer(0, [tick.pluginClock ?? 0]);
};
```

Packs without `presentTick` receive **no** host present ticks and **no** host
slot writes (only the sandbox may write via `zoto.writeBuffer` when it runs).
`viz.presentTick` without `viz.write` is rejected at catalog validate time.
Merge host (#37) and pack PRs that enable `presentTick` as one unit.

Pack media files live under `assets/` and are served by the **host only** at
`GET /api/plugins/<id>/asset/<path>` (reviewed / src). The sandbox CSP blocks
`connect-src`, so the iframe cannot fetch these URLs.

## Writes (plugin → host)

Sandbox SDK (`getVizZoto()` from `plugins/sdk/viz-zoto`; runtime object is `globalThis.zoto`):

```ts
zoto.onFrame = (frame) => {
  zoto.writeBuffer(0, [frame.packets[0]?.field ?? 0]);
  zoto.writeUniform("uBright", 0.8);
  zoto.writeUniform("uAccent", [0.2, 0.6, 1.0]);
};
```

**`writeParticles` is deprecated (#184).** No host renderer draws pack particles, so particle
writes never reach the screen. Put per-item data in a UBO slot with `writeBuffer` and draw it in
`sky/fragment.glsl` from `zotoVizSlots` (talker-storm's slot-1 storm cells are the worked example).
The call still works and is still capped by `maxParticles`, and dev builds log one warning per pack.

The host enforces caps in `VizBufferWriter` before applying writes:

- buffer slot index `< maxBuffers`
- `data.length <= maxBufferFloats`
- particle count `<= maxParticles`
- uniform name must be listed in `viz.uniforms` and match the sky whitelist

Uniform writes reach the active plugin `sky/fragment.glsl` via
`scene.setPluginUniform`. Buffer writes land in the UBO mirror and are
uploaded via `scene.setPluginUboBuffer`.

In `sky/fragment.glsl`, `in vec3 vDir` is a camera-relative ray: the host has parented plugin skies to the camera since 2f44932a, so the view looks straight down `-z`. A world-space dome mapping like `dir.xz / (k + abs(dir.y))` will not frame your scene; map the screen plane instead (e.g. `rd.xy / -rd.z`, as `koi-pond` does).

## Adaptive render scale (`render.scale`)

Optional in `plugin.yml` (schema `$defs/renderScale`). The **host** owns the
governor — packs never implement their own DPR logic or branch on pack ids.

```yaml
render:
  scale:
    min: 0.35                              # > 0 and ≤ 1
    steps: [1, 0.75, 0.5, 0.35]           # optional; clamped ≥ min, descending
```

When `render.scale` is absent the host keeps today’s behaviour at scale **1.0**.

The adaptive governor is **on by default**. A profile saved before schema
version 1 with `vizGovernor: false` never recorded a choice, so it is on too.
A current profile that stores false stays off. With the governor off, every
pack renders at scale **1.0** and `uRenderScale` reads **1.0** even when
`render.scale` is declared in YAML.

- Settings → Privacy → **Render governor**. The help text is "Lowers a view's render resolution when it can't keep up. On by default."
- URL query `?vizGovernor=1` forces on for one load. `?vizGovernor=0` forces off for one load.

Hysteresis thresholds live in one place in the web host:
`RENDER_SCALE_GOVERNOR_TUNING` in `web/src/plugins/render-scale-governor.ts`
(`stepDownSustainMs`, `stepUpSustainMs`, `stepUpHeadroomRatio`).

When present and the host governor is **on**, **each rendered view or mosaic tile** gets its own
`RenderScaleGovernor` (timing samples + pane budget share in, suggested scale
out). A **page arbiter** sits above them: at most one pane may step **down**
per tick among panes at the **peak measured cost** (furthest over budget share
among those — the heaviest view on the wall), and at most one may step **up**
(cheapest first, after its own up-hysteresis). With a single governed view the
arbiter is a no-op and matches the plain governor.

Tiles today each measure frame time on a **shared GPU with separate contexts**,
so cheap panes can inherit queue wait from an expensive neighbour and look
over budget. The arbiter prevents the whole wall stepping down together until
the host moves to a **single shared WebGL context** (the arbiter is written to
drop in unchanged there). GPU timer queries drive hysteresis when
`EXT_disjoint_timer_query_webgl2` is available (otherwise honest **CPU**
present-to-present timing). Step **down** one notch after p95 stays over the
pane budget for ~0.5 s; step **up** after ~2 s with p95 below 80% of budget.

The pack UBO (`ZotoVizData` / `zotoVizSlots`) is unchanged. The host exposes:

| Uniform | Type | Meaning |
| --- | --- | --- |
| `uResolution` | `vec2` | Scaled render size in pixels (DPR × governor scale). Most packs should size work from this alone. |
| `uRenderScale` | `float` | Current scale (1 when inactive). Opt in by listing `uRenderScale` under `viz.uniforms`, same as `uTime`. |

The demoscene HUD shows a budget line when `render.scale` is declared on the
active pack (single view): **`gov on` / `gov off`**, then `GPU` or `CPU`,
unclamped last frame ms, rolling **p95**, and current scale (always **1** when
the host governor is off). In mosaic mode the header / focused pane shows the
full line on its pane badge; other governed tiles show a compact scale suffix
when the governor is on. Dashes appear when no timing samples exist yet.

## Frame budget

`VizFrameBudget` times `buildVizFrame` each tick. Frames over
**16.7 ms** increment `overBudget` / `skipped` and are **not** delivered to
the plugin iframe.

The same skip counter also advances on the shared rAF path via
`markPresent()` (present-to-present interval), so soft-FPS from WebGL /
compositor cost cannot stay at `skips 0/s` while measured frame time is over
budget.

## First-party scaffolds

| Plugin | Style |
| --- | --- |
| `plugins/src/packet-tunnel/` | packet-field tunnel raymarch |
| `plugins/src/rf-constellation/` | RF / SSID constellation bloom |
| `plugins/src/talker-storm/` | talker particle storm (512 cap) |
| `plugins/src/kefrens-bars/` | Amiga copper / Kefrens bars from talker rates |
| `plugins/src/roto-proto/` | classic rotozoomer driven by protocol mix |
| `plugins/src/blob-mesh/` | 90s metaballs from top talkers |
| `plugins/src/star-sines/` | 3D sine-scroll starfield; pareidolia faces morph from the lanes |
| `plugins/src/hn-rain/` | phosphor rain of a bound host source (HN by default; Lobsters / Guardian / Mastodon instances) |
| `plugins/src/hn-term/` | greenscreen teletype of HN titles + RSS blurbs |
| `plugins/src/stereo-gram/` | Magic Eye autostereogram — eight morphing objects, a six-bin mic analyser, and local-model AI scenes (`POST /api/ai/stereo`) while the header AI switch is on |
| `plugins/src/cypher-cic/` | Cypherpunk CIC wall — neon holodeck infograph of SYS + NET, center-hero mosaic |
| `plugins/src/backrooms/` | Level 0 camcorder footage — with `presentTick`, `frontend/director.ts` runs in the sandbox on `onPresent` |

Each ships `frontend/index.ts` + `sky/fragment.glsl` + `visualisation.yml`
with `backdrop: plugin`. The host hides the LAN graph (nodes, edges, labels,
legend) for every demo pack — `viz.read` / `viz.write`, `backdrop: plugin`,
or a sky shader. Set `look.stageOnly: false` only when the graph should stay.

## Dev fixture switch

On the Vite dev server only, `?vizFixture=idle|idle-failed|golden-live|vm-live`
feeds shared SDK fixtures to every viz pack instead of live traffic (see
`plugins/sdk/README.md`). Production builds omit this path.

Fixture change (#181): `plugins/sdk/fixtures/idle.json` (and `vm-live.json`, which
carries the idle demo slice) gained two internet talkers, `host-05` (rate 36) and
`host-06` (rate 30), and the `rf` placeholder names moved from `host-05`/`host-06`
to `host-07`/`host-08`. A pack test that pinned those names or the talker count
needs updating.

## Tests

```bash
cd web && pnpm test -- src/plugins/viz-host.test.ts src/plugins/host.test.ts
.venv/bin/pytest tests/test_plugin_schema.py -k viz
```

See also [TypeScript plugins](/plugins-ts) for the iframe sandbox and
[Plugins](/plugins) for catalog layout and consent.
