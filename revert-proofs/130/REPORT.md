## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| host-mesh-strip-assets-prefix | tests/test_host_mesh_loader_gaps.py :: test_host_mesh_lane_strips_assets_prefix_in_api_url | Revert strip assets/ prefix in host mesh assetUrl | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_host_mesh_loader_gaps.py::test_host_mesh_lane_strips_assets_prefix_in_api_url | RED (expected) |
| pack-asset-stale-cookie-fallback | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie | Revert app csrf fallback when sandbox sends stale cookie only | python3 -m pytest --no-cov -p no:cacheprovider -p revert_proof_pytest_plugin tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie | RED (expected) |
| host-mesh-clear-no-dispose | | | | **ERROR: row host-mesh-clear-no-dispose: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| host-mesh-clear-no-mixer-stop | | | | **ERROR: row host-mesh-clear-no-mixer-stop: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| host-mesh-clear-no-template-map-clear | | | | **ERROR: row host-mesh-clear-no-template-map-clear: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |
| host-mesh-inflight-no-epoch | | | | **ERROR: row host-mesh-inflight-no-epoch: baseline test selection failed (target not found; never a pass) --- baseline output --- JSON report written to <tmp>** |

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

### pack-asset-stale-cookie-fallback

```
tests/test_access_sandbox_token.py F                                     [100%]

=================================== FAILURES ===================================
_ SandboxAssetTokenOriginTests.test_null_origin_pack_assets_with_stale_csrf_cookie _

                    },
                )
>       assert resp.status == 200
E       AssertionError: assert 401 == 200
E        +  where 401 = <ClientResponse(http://127.0.0.1:43485/pack-assets/648cc384-b48f-4f49-86b8-9d2610607f7f.3PscsFO5jyu-P_C4P6hlySBoZMo9B2... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sun, 27 Sep 2026 16:07:08 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_access_sandbox_token.py:178: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie
-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_pack_assets_with_stale_csrf_cookie
======================== 1 failed, 6 warnings in 0.18s =========================
```
