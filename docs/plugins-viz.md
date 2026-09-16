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
```

Canonical schema: `schema/plugin.schema.json` → `$defs/vizContract`.

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
`scene.setPluginUniform`.

## First-party scaffolds

| Plugin | Style |
| --- | --- |
| `plugins/src/packet-tunnel/` | packet-field tunnel raymarch |
| `plugins/src/rf-constellation/` | RF / SSID constellation bloom |
| `plugins/src/talker-storm/` | talker particle storm (512 cap) |

Each ships `frontend/index.ts` + `sky/fragment.glsl` + `visualisation.yml`
with `backdrop: plugin`.

## Tests

```bash
cd web && pnpm test -- src/plugins/viz-host.test.ts src/plugins/host.test.ts
.venv/bin/pytest tests/test_plugin_schema.py -k viz
```

See also [TypeScript plugins](/plugins-ts) for the iframe sandbox and
[Plugins](/plugins) for catalog layout and consent.
