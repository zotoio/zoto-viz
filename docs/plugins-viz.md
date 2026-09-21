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
| `plugins/src/stereo-gram/` | Magic Eye autostereogram — hidden torus + talker orbs |
| `plugins/src/cypher-cic/` | Cypherpunk CIC wall — neon holodeck infograph of SYS + NET, center-hero mosaic |
| `plugins/src/backrooms/` | Liminal yellow halls — distant organic entity (no nose, white eyes, wide sharp grin) until a charge (arms and fingers out), stays in halls (no wall clip), roar then look / turn back / run (never chase), rare unsynced tube flicks (shared strobe only when close); CC0 tube-buzz, brief music box, entity scream |

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
