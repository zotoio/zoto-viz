## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| host-mesh-clear-no-dispose | web/src/graph/host-mesh-lane.test.ts :: host mesh lane > clear() exact teardown counts (Performance Pedant) | Revert disposeHostMeshObject3D on template clear | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^host mesh lane > clear\\(\\) exact teardown counts \\(Performance Pedant\\)$" --reporter=json --outputFile.json=<tmp> -- src/graph/host-mesh-lane.test.ts | RED (expected) |
| host-mesh-clear-no-mixer-stop | web/src/graph/host-mesh-lane.test.ts :: host mesh lane > clear() exact teardown counts (Performance Pedant) | Revert stopSkinnedMixer on clearAssetLive | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^host mesh lane > clear\\(\\) exact teardown counts \\(Performance Pedant\\)$" --reporter=json --outputFile.json=<tmp> -- src/graph/host-mesh-lane.test.ts | RED (expected) |
| host-mesh-clear-no-template-map-clear | web/src/graph/host-mesh-lane.test.ts :: host mesh lane > clear() exact teardown counts (Performance Pedant) | Revert templates.clear() on HostMeshLane.clear | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^host mesh lane > clear\\(\\) exact teardown counts \\(Performance Pedant\\)$" --reporter=json --outputFile.json=<tmp> -- src/graph/host-mesh-lane.test.ts | RED (expected) |
| host-mesh-inflight-no-epoch | web/src/graph/host-mesh-lane.test.ts :: host mesh lane > clear() exact teardown counts (Performance Pedant) | Revert loadEpoch stale-load discard in loadInner | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^host mesh lane > clear\\(\\) exact teardown counts \\(Performance Pedant\\)$" --reporter=json --outputFile.json=<tmp> -- src/graph/host-mesh-lane.test.ts | RED (expected) |
| host-mesh-strip-assets-prefix | tests/test_host_mesh_loader_gaps.py :: test_host_mesh_lane_strips_assets_prefix_in_api_url | Revert strip assets/ prefix in host mesh assetUrl | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_host_mesh_loader_gaps.py::test_host_mesh_lane_strips_assets_prefix_in_api_url | RED (expected) |
| host-mesh-swim-clip-normalize | web/src/graph/host-mesh-lane.test.ts :: host mesh lane > normalizeSwimClipStart shifts swim tracks to t=0 without changing duration | Revert swim clip time shift in normalizeSwimClipStart | web/node_modules/.bin/vitest run --config ../scripts/revert-proof-vitest-overlay.mjs -t "^host mesh lane > normalizeSwimClipStart shifts swim tracks to t=0 without changing duration$" --reporter=json --outputFile.json=<tmp> -- src/graph/host-mesh-lane.test.ts | RED (expected) |
| pack-asset-stale-cookie-fallback | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie | Revert app csrf fallback when sandbox sends stale cookie only | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie | RED (expected) |

### host-mesh-clear-no-dispose

```
AssertionError: expected "dispose" to be called 3 times, but got 0 times
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### host-mesh-clear-no-mixer-stop

```
AssertionError: expected "stopAllAction" to be called 2 times, but got 0 times
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### host-mesh-clear-no-template-map-clear

```
AssertionError: expected 3 to be +0 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### host-mesh-inflight-no-epoch

```
AssertionError: expected 1 to be +0 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at processTicksAndRejections (node:internal/process/task_queues:105:5)
    at file://<tmp>
```

### host-mesh-strip-assets-prefix

```
tests/test_host_mesh_loader_gaps.py F                                    [100%]

=================================== FAILURES ===================================
_____________ test_host_mesh_lane_strips_assets_prefix_in_api_url ______________

    def test_host_mesh_lane_strips_assets_prefix_in_api_url() -> None:
        text = LANE.read_text(encoding="utf-8")
>       assert 'replace(/^assets\\//i, "")' in text
E       assert 'replace(/^assets\\//i, "")' in 'import * as THREE from "three";\nimport { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";\nimport { MeshoptDe...  }\n  return { assetId, matrices };\n}\n\nexport const HOST_MESH_MAX_FLOATS = HOST_MESH_MAX_INSTANCES_DEFAULT * 16;\n'

tests/test_host_mesh_loader_gaps.py:14: AssertionError
=========================== short test summary info ============================
FAILED tests/test_host_mesh_loader_gaps.py::test_host_mesh_lane_strips_assets_prefix_in_api_url
============================== 1 failed in 0.05s ===============================
```

### host-mesh-swim-clip-normalize

```
AssertionError: expected 0.0416666679084301 to be +0 // Object.is equality
    at Proxy.revertProofBrandedMethod (file://<tmp>
    at <tmp>
    at file://<tmp>
    at file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithCancel (file://<tmp>
    at file://<tmp>
    at new Promise (<anonymous>)
    at runWithTimeout (file://<tmp>
```

### pack-asset-stale-cookie-fallback

```
tests/test_access_sandbox_token.py F                                     [100%]

=================================== FAILURES ===================================
_ SandboxAssetTokenOriginTests.test_null_origin_pack_assets_with_stale_csrf_cookie _

                    },
                )
>       assert resp.status == 200
E       AssertionError: assert 401 == 200
E        +  where 401 = <ClientResponse(http://127.0.0.1:42667/pack-assets/e1d3366b-28dd-4f05-91e4-3d62e3c1169b.lRiPJ3IUn_s-MzXOvSlcu_jqjkMRKm... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sun, 27 Sep 2026 17:41:02 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_access_sandbox_token.py:178: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie
-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie
======================== 1 failed, 6 warnings in 0.18s =========================
```
