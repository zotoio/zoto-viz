# Phase 2 — host mesh lane MVP

Branch: `cursor/host-models-2874` (extends phase 1 `cursor/pack-frame-path-2874`).

## What shipped

- Host `HostMeshLane` (`web/src/graph/host-mesh-lane.ts`): GLTF load via host Three.js + `InstancedMesh` (≤48 instances).
- Packs declare `assets:` in `plugin.yml`; digest in consent as `assets_sha256`.
- Host serves `.glb/.gltf/.bin/.ktx2` via `/api/plugins/{id}/asset/…` with `?h=<sha256>` → `Cache-Control: immutable`.
- Demo pack `host-mesh-demo`: fixture `assets/cube.gltf`, slot 2 matrix drives the instance (no live capture).
- Sandbox unchanged: packs still cannot fetch arbitrary URLs; mesh bytes load on the host origin only.

## Reading instrumentation

Same as phase 1 (`docs/perf/phase1-findings.md`): `?packPerf=1`, `GET /api/pack-perf`, MCP `get_pack_perf`. Changing `?packPerf` needs a reload; localStorage changes are live.
