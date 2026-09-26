## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| access-logger-class | tests/test_monitor_access_log.py :: test_make_app_session_returns_200_with_redacting_access_logger | make_app must boot with RedactingAccessLogger so /api/session answers on AppRunner. | python -m pytest tests/test_monitor_access_log.py::test_make_app_session_returns_200_with_redacting_access_logger | RED (expected) |
| backend-404 | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_backend_marker_path_is_404 | Backend/service paths must not be exposed via pack-assets. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404 | RED (expected) |
| bootstrap-no-sat-query | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query | Sandbox bootstrap and chunk imports must gate via path-segment token, not ?sat= on static URLs. | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query | RED (expected) |
| dotfile-404 | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_dotfile_under_pack_is_404 | Dotfile paths under a pack must not be served. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404 | RED (expected) |
| multi-file-relative-imports | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files | Unbundled ESM module.js must keep relative imports and serve helper.js siblings via pack-assets. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files | RED (expected) |
| referrer-policy | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented | Pack asset responses must send Referrer-Policy: no-referrer. | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented | RED (expected) |
| token-log-redaction | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token | Access log must redact the sandbox session token path segment (revert prints raw token). | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token | RED (expected) |
| traversal-realpath | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root | Symlink escape outside the pack frontend root must not be served. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root | RED (expected) |
| console-import-error-redaction | | | | **ERROR: row console-import-error-redaction: patch breaks build (tsc --noEmit -p web failed; proves nothing)** |
| csp-tight | | | | **ERROR: row csp-tight: patch breaks build (tsc --noEmit -p web failed; proves nothing)** |
| sandbox-foreign-boot | | | | **ERROR: row sandbox-foreign-boot: patch breaks build (tsc --noEmit -p web failed; proves nothing)** |
| token-encoding | | | | **ERROR: row token-encoding: test stayed GREEN after revert patch (expected failure)** |
| token-pack-binding | | | | **ERROR: row token-pack-binding: git apply --check failed: error: patch failed: service/pack_asset_tokens.py:67 error: service/pack_asset_tokens.py: patch does not apply ** |
| token-rebuild-on-403 | | | | **ERROR: row token-rebuild-on-403: git apply --check failed: error: corrupt patch at line 18 ** |
| token-revocation | | | | **ERROR: row token-revocation: git apply --check failed: error: corrupt patch at line 12 ** |
| token-session-binding | | | | **ERROR: row token-session-binding: git apply --check failed: error: patch failed: service/access.py:72 error: service/access.py: patch does not apply ** |
| token-wall-notice | | | | **ERROR: row token-wall-notice: git apply --check failed: error: corrupt patch at line 13 ** |
| wrong-token-cross-pack-403 | | | | **ERROR: row wrong-token-cross-pack-403: git apply --check failed: error: patch failed: service/access.py:63 error: service/access.py: patch does not apply ** |

### access-logger-class

```
tests/test_monitor_access_log.py F                                       [100%]

=================================== FAILURES ===================================
________ test_make_app_session_returns_200_with_redacting_access_logger ________

        asyncio.run(_session_smoke())
        main_src = inspect.getsource(monitor.main)
>       assert "access_log_class=access.RedactingAccessLogger" in main_src
E       AssertionError: assert 'access_log_class=access.RedactingAccessLogger' in 'def main() -> None:\n    from . import typesafe_proxy\n\n    typesafe_proxy.load_dotenv()\n    p = argparse.ArgumentP...s_log=access.sandbox_access_log(app),\n            shutdown_timeout=3,\n        )\n    finally:\n        hold.stop()\n'

tests/test_monitor_access_log.py:39: AssertionError
=============================== warnings summary ===============================
tests/test_monitor_access_log.py::test_make_app_session_returns_200_with_redacting_access_logger
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/access-logger-class-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_monitor_access_log.py::test_make_app_session_returns_200_with_redacting_access_logger
======================== 1 failed, 4 warnings in 0.15s =========================
```

### backend-404

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
___________ PackAssetsSecurityTests.test_backend_marker_path_is_404 ____________

            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url_raw("backend-pack", "backend/leak.js"), headers={**HOST})
>       assert resp.status == 404
E       AssertionError: assert 200 == 404
E        +  where 200 = <ClientResponse(http://127.0.0.1:39995/pack-assets/11111111-1111-4111-8111-111111111111.jczOPBely5t3hQ0ZvjVjXQDFfY6u7P... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:44 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:220: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/backend-404-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404
======================== 1 failed, 4 warnings in 0.07s =========================
```

### bootstrap-no-sat-query

```
tests/test_access_sandbox_token.py F                                     [100%]

=================================== FAILURES ===================================
_ SandboxAssetTokenOriginTests.test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query _

                html = await self.client.get(pack_url("_sandbox", "plugin-sandbox.html"), headers=NULL)
                chunk = await self.client.get(pack_url("_sandbox", js_name), headers=NULL)
        assert html.status == 200
        assert chunk.status == 200
        body_html = await html.text()
        body_js = await chunk.text()
>       assert "?sat=" not in body_html and "&sat=" not in body_html
E       assert ('?sat=' not in '<html><scri...ript></html>'
E         
E         '?sat=' is contained here:
E         ?           +++++)

tests/test_access_sandbox_token.py:131: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/bootstrap-no-sat-query-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query
======================== 1 failed, 4 warnings in 0.06s =========================
```

### dotfile-404

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
____________ PackAssetsSecurityTests.test_dotfile_under_pack_is_404 ____________

                for tail in (".env", "nested/.hidden.js", "frontend/.env"):
                    resp = await self.client.get(pack_url_raw("dot-pack", tail), headers={**HOST})
>                   assert resp.status == 404, tail
E                   AssertionError: .env
E                   assert 200 == 404
E                    +  where 200 = <ClientResponse(http://127.0.0.1:35927/pack-assets/11111111-1111-4111-8111-111111111111.T25tRpEP0-8feKWp_Igx0DwSxHH9ye... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:48 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:206: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/dotfile-404-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404
======================== 1 failed, 4 warnings in 0.07s =========================
```

### multi-file-relative-imports

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
___ PackAssetsSecurityTests.test_sandbox_fixture_multi_serves_sibling_files ____

        plugins_mod.reset_bundles()
        home = plugins_mod.src_plugin_home("sandbox-fixture-multi")
        assert home is not None
        row = next(p for p in plugins_mod.scan()["plugins"] if p["id"] == "sandbox-fixture-multi")
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "sandbox-fixture-multi" else None):
                helper = await self.client.get(pack_url("sandbox-fixture-multi", "helper.js"), headers=NULL)
                fixture = await self.client.get(pack_url("sandbox-fixture-multi", "fixture.json"), headers=NULL)
        assert mod.status == 200
        assert helper.status == 200
        assert fixture.status == 200
        body = await mod.text()
>       assert "./helper.js" in body
E       assert './helper.js' in '// plugins/src/sandbox-fixture-multi/frontend/helper.js\nfunction pulse() {\n  return 0.55 + 0.45 * Math.sin(Date.now...nvar z = globalThis.zoto;\nz.onPresent = () => {\n  z.writeUniform("uBright", fixture_default.bright * pulse());\n};\n'

tests/test_pack_assets_security.py:240: AssertionError
------------------------------ Captured log call -------------------------------
WARNING  asyncio:base_events.py:1982 Executing <Task pending name='Task-2' coro=<PackAssetsSecurityTests.test_sandbox_fixture_multi_serves_sibling_files() running at /tmp/revert-proof-wt-workspace-35672/tests/test_pack_assets_security.py:233> wait_for=<Future pending cb=[BaseSelectorEventLoop._sock_write_done(15, handle=<Handle BaseS...events.py:317>)(), Task.task_wakeup()] created at /usr/lib/python3.12/asyncio/base_events.py:449> cb=[_run_until_complete_cb() at /usr/lib/python3.12/asyncio/base_events.py:182] created at /usr/lib/python3.12/asyncio/runners.py:100> took 0.293 seconds
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/multi-file-relative-imports-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files
======================== 1 failed, 4 warnings in 0.37s =========================
```

### referrer-policy

```
tests/test_access_sandbox_token.py F                                     [100%]

=================================== FAILURES ===================================
_ SandboxAssetTokenOriginTests.test_null_origin_module_js_with_valid_token_when_consented _

                        headers=NULL,
                    )
        assert resp.status == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "null"
>       assert resp.headers.get("Referrer-Policy") == "no-referrer"
E       AssertionError: assert None == 'no-referrer'
E        +  where None = <built-in method get of multidict._multidict.CIMultiDictProxy object at 0x7fa636e87e50>('Referrer-Policy')
E        +    where <built-in method get of multidict._multidict.CIMultiDictProxy object at 0x7fa636e87e50> = <CIMultiDictProxy('Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Contro...; HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:50 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>.get
E        +      where <CIMultiDictProxy('Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Contro...; HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:50 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')> = <ClientResponse(http://127.0.0.1:44777/pack-assets/11111111-1111-4111-8111-111111111111.YPic55R_dHDr4TYooMrmTEtvgaVVq1... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:50 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.headers

tests/test_access_sandbox_token.py:49: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/referrer-policy-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented
======================== 1 failed, 4 warnings in 0.07s =========================
```

### token-log-redaction

```
tests/test_access_sandbox_token.py F                                     [100%]

=================================== FAILURES ===================================
____ SandboxAssetTokenOriginTests.test_redacting_access_logger_hides_token _____

                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(path, headers={**HOST})
        assert resp.status == 200
        req = type(
            "Req",
        )()
        line = access.RedactingAccessLogger._format_r(req, resp, 0.01)
>       assert tok not in line
E       AssertionError: assert '11111111-11...28pCtWCdo-n4' not in 'GET /pack-a....js HTTP/1.1'
E         
E         '11111111-1111-4111...gaVVq1h28pCtWCdo-n4' is contained here:
E           GET /pack-assets/11111111-1111-4111-8111-111111111111.YPic55R_dHDr4TYooMrmTEtvgaVVq1h28pCtWCdo-n4/demo-pack/module.js HTTP/1.1

tests/test_access_sandbox_token.py:173: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/token-log-redaction-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token
======================== 1 failed, 4 warnings in 0.07s =========================
```

### traversal-realpath

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
____ PackAssetsSecurityTests.test_traversal_realpath_outside_frontend_root _____

            os.symlink(leak, fe / "escape.js")
            os.symlink(outside, fe / "escape-dir")
        except OSError:
            return  # no symlink support in this environment
        row = {"id": "symlink-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
                for tail in ("escape.js", "escape-dir/outside-leak.txt"):
                    resp = await self.client.get(pack_url_raw("symlink-pack", tail), headers={**HOST})
>                   assert resp.status in {403, 404}, tail
E                   AssertionError: escape.js
E                   assert 200 in {403, 404}
E                    +  where 200 = <ClientResponse(http://127.0.0.1:34051/pack-assets/11111111-1111-4111-8111-111111111111.2D3KoKztrAJRQuXzzAp1iNfLj7Piah... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:12:56 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:191: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root
- generated xml file: /tmp/revert-proof-artifacts-rPUrT3/traversal-realpath-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root
======================== 1 failed, 4 warnings in 0.07s =========================
```
