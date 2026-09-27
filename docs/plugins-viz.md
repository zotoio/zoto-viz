# VizPlugin host API

VizPlugins are demoscene-style shader packs that stay off the hot path. The
**host** owns ingest, decimation, and the **16.7 ms** frame budget; plugins
only consume pre-built data frames and write to **reserved buffer / uniform
slots** declared in `plugin.yml`.

## Contract (`plugin.yml`)

```yaml
capabilities:
  - viz.read    # receive VizDataFrame each monitor tick
  - viz.write   # writeBuffer / writeUniform / writeParticles
viz:
  graphWalk: false          # required — plugins never walk the full graph
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
| `t`, `dt` | monitor timestamp | — |
| `audio` | scene pulse bass 0..1 | — |
| `packets[]` | flow proto tallies | 32 |
| `rf[]` | Wi-Fi watch SSIDs + RSSI | 24 |
| `talkers[]` | top devices by packet rate | 24 |
| `headlines[]` | host sources: RSS titles + `summary` blurbs, HTTP JSON strings, file lines (`kind`) | 8 |

Plugins must **not** request or traverse the full device graph. Use
`graph.read` only when you need the legacy `{id, rate, role}` tick.

## Writes (plugin → host)

Sandbox SDK (`globalThis.zoto`):

```ts
zoto.onFrame = (frame) => {
  zoto.writeBuffer(0, [frame.packets[0]?.field ?? 0]);
  zoto.writeUniform("uBright", 0.8);
  zoto.writeUniform("uAccent", [0.2, 0.6, 1.0]);
  zoto.writeParticles([x, y, z, w, ...], 4); // capped by maxParticles
};
```

The host enforces caps in `VizBufferWriter` before applying writes:

- buffer slot index `< maxBuffers`
- `data.length <= maxBufferFloats`
- particle count `<= maxParticles`
- uniform name must be listed in `viz.uniforms` and match the sky whitelist

Uniform writes reach the active plugin `sky/fragment.glsl` via
`scene.setPluginUniform`. Buffer writes land in the UBO mirror and are
uploaded via `scene.setPluginUboBuffer`.

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

The adaptive governor is **off by default** until it is tuned on real GPU hardware.
With it off, every pack renders at scale **1.0** and `uRenderScale` reads **1.0**
even when `render.scale` is declared in YAML. Opt in without rebuilding:

- Settings → Privacy → **render governor**, or
- URL query `?vizGovernor=1` (use `?vizGovernor=0` to force off for one load).

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
| `plugins/src/backrooms/` | Level 0 camcorder footage — the host runs `frontend/director.ts` on the sky clock (one unbroken take per episode, default 120 s: rule-made encounters in a walled pillar maze, freeze then flee along open halls, the last chase ends in the catch and drag) and writes camera, creature, walled edges and look options to slots 0–1; every knob is a view setting (`visualisation.yml` config, MCP `set_plugin`); CC0 footsteps, breathing, screams, heartbeat, tube buzz, creature roars and chase screams |

Each ships `frontend/index.ts` + `sky/fragment.glsl` + `visualisation.yml`
with `backdrop: plugin`. The host hides the LAN graph (nodes, edges, labels,
legend) for every demo pack — `viz.read` / `viz.write`, `backdrop: plugin`,
or a sky shader. Set `look.stageOnly: false` only when the graph should stay.

## Tests

```bash
cd web && pnpm test -- src/plugins/viz-host.test.ts src/plugins/host.test.ts
.venv/bin/pytest tests/test_plugin_schema.py -k viz
```

See also [TypeScript plugins](/plugins-ts) for the iframe sandbox and
[Plugins](/plugins) for catalog layout and consent.
