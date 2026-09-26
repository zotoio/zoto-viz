## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| access-logger-class | tests/test_monitor_access_log.py :: test_make_app_session_returns_200_with_redacting_access_logger | make_app must boot with RedactingAccessLogger so /api/session answers on AppRunner. | python -m pytest tests/test_monitor_access_log.py::test_make_app_session_returns_200_with_redacting_access_logger | RED (expected) |
| backend-404 | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_backend_marker_path_is_404 | Backend/service paths must not be exposed via pack-assets. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404 | RED (expected) |
| bootstrap-no-sat-query | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query | Sandbox bootstrap and chunk imports must gate via path-segment token, not ?sat= on static URLs. | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query | RED (expected) |
| console-import-error-redaction | src/plugins/plugin-pack-feed.test.ts :: plugin pack feed notices > redacts session token from boot failure console lines | Host classify/log paths must redact session token before console.warn. | web/node_modules/.bin/vitest run src/plugins/plugin-pack-feed.test.ts -t "plugin pack feed notices > redacts session token from boot failure console lines" | RED (expected) |
| csp-tight | src/plugins/host.csp.test.ts :: page CSP bootstrap policy > loads plugin sandbox from same-origin html + module (no srcdoc) | plugin-sandbox.html CSP must stay minimal (no broad connect-src to loopback hosts). | web/node_modules/.bin/vitest run src/plugins/host.csp.test.ts -t "page CSP bootstrap policy > loads plugin sandbox from same-origin html + module (no srcdoc)" | RED (expected) |
| dotfile-404 | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_dotfile_under_pack_is_404 | Dotfile paths under a pack must not be served. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404 | RED (expected) |
| multi-file-relative-imports | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files | Unbundled ESM module.js must keep relative imports and serve helper.js siblings via pack-assets. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files | RED (expected) |
| referrer-policy | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented | Pack asset responses must send Referrer-Policy: no-referrer. | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented | RED (expected) |
| sandbox-foreign-boot | src/plugins/sandbox-frame.security.test.ts :: sandbox-frame boot security > ignores boot postMessage from a foreign frame | Sandbox must ignore boot messages not from the parent frame. | web/node_modules/.bin/vitest run src/plugins/sandbox-frame.security.test.ts -t "sandbox-frame boot security > ignores boot postMessage from a foreign frame" | RED (expected) |
| token-expired | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_expired_token_denied | Expired pack asset tokens must be rejected. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_expired_token_denied | RED (expected) |
| token-log-redaction | tests/test_access_sandbox_token.py :: SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token | Access log must redact the sandbox session token path segment (revert prints raw token). | python -m pytest tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token | RED (expected) |
| token-pack-binding | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_token_bound_to_pack_id | Token minted for pack X must not authorize paths under pack Y. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_pack_id | RED (expected) |
| token-session-binding | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_token_bound_to_session_id | Pack asset token must verify the caller CSRF session id. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_session_id | RED (expected) |
| traversal-realpath | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root | Symlink escape outside the pack frontend root must not be served. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root | RED (expected) |
| wrong-token-cross-pack-403 | tests/test_pack_assets_security.py :: PackAssetsSecurityTests::test_wrong_token_denied_for_any_pack_path | Wrong session token in /pack-assets/<token>/… must return 403, not serve module.js. | python -m pytest tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_wrong_token_denied_for_any_pack_path | RED (expected) |

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
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/access-logger-class-patched-pytest.xml -
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
E        +  where 200 = <ClientResponse(http://127.0.0.1:33737/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535890.WrmODVzZiEUQ8Bt_L-K... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:50 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:191: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/backend-404-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_backend_marker_path_is_404
======================== 1 failed, 3 warnings in 0.06s =========================
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
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/bootstrap-no-sat-query-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query
======================== 1 failed, 3 warnings in 0.06s =========================
```

### console-import-error-redaction

```
AssertionError: expected 'module.js fetch failed (network/CORS)…' not to contain 'super-secret-session-token'
    at /tmp/revert-proof-wt-workspace-22579/web/src/plugins/plugin-pack-feed.test.ts:52:24
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### csp-tight

```
AssertionError: expected '<!doctype html>\n<html lang="en">\n  …' to contain 'connect-src \'none\''
    at /tmp/revert-proof-wt-workspace-22579/web/src/plugins/host.csp.test.ts:24:21
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
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
E                    +  where 200 = <ClientResponse(http://127.0.0.1:35455/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535895.LAqUTc5ga_Y7c7nF0RO... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:55 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:177: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/dotfile-404-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_dotfile_under_pack_is_404
======================== 1 failed, 3 warnings in 0.06s =========================
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

tests/test_pack_assets_security.py:211: AssertionError
------------------------------ Captured log call -------------------------------
WARNING  asyncio:base_events.py:1982 Executing <Task pending name='Task-2' coro=<PackAssetsSecurityTests.test_sandbox_fixture_multi_serves_sibling_files() running at /tmp/revert-proof-wt-workspace-22579/tests/test_pack_assets_security.py:204> wait_for=<Future pending cb=[BaseSelectorEventLoop._sock_write_done(15, handle=<Handle BaseS...events.py:317>)(), Task.task_wakeup()] created at /usr/lib/python3.12/asyncio/base_events.py:449> cb=[_run_until_complete_cb() at /usr/lib/python3.12/asyncio/base_events.py:182] created at /usr/lib/python3.12/asyncio/runners.py:100> took 0.298 seconds
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/multi-file-relative-imports-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_sandbox_fixture_multi_serves_sibling_files
======================== 1 failed, 3 warnings in 0.37s =========================
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
E        +  where None = <built-in method get of multidict._multidict.CIMultiDictProxy object at 0x7f034d20c090>('Referrer-Policy')
E        +    where <built-in method get of multidict._multidict.CIMultiDictProxy object at 0x7f034d20c090> = <CIMultiDictProxy('Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Contro...; HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:57 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>.get
E        +      where <CIMultiDictProxy('Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Contro...; HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:57 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')> = <ClientResponse(http://127.0.0.1:36881/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535897.Xh3pKKnM-dCFtO6xzVC... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:57 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.headers

tests/test_access_sandbox_token.py:49: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/referrer-policy-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented
======================== 1 failed, 3 warnings in 0.07s =========================
```

### sandbox-foreign-boot

```
AssertionError: expected true to be false // Object.is equality
    at /tmp/revert-proof-wt-workspace-22579/web/src/plugins/sandbox-frame.security.test.ts:24:26
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:1628:35
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:2783:26
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3319:20
    at new Promise (<anonymous>)
    at runWithCancel (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3314:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3299:20
    at new Promise (<anonymous>)
    at runWithTimeout (file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3257:10)
    at file:///tmp/revert-proof-wt-workspace-22579/web/node_modules/.pnpm/vitest@5.0.0_@types+node@22.20.2_@vitest+coverage-v8@5.0.0_happy-dom@20.14.5_vite@8.2.2_795fd615d962206b97849f7d61ee963d/node_modules/vitest/dist/chunks/run.CQOUYP-x.js:3876:64
```

### token-expired

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
______________ PackAssetsSecurityTests.test_expired_token_denied _______________

                        tmock.time.return_value = exp + 5
                        resp = await self.client.get(pack_url("demo-pack", "module.js", token=tok), headers=NULL)
>       assert resp.status == 403
E       AssertionError: assert 200 == 403
E        +  where 200 = <ClientResponse(http://127.0.0.1:44375/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790449559.JD4GnP-kS-d87jC4YOV... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:04:59 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:96: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_expired_token_denied
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/token-expired-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_expired_token_denied
======================== 1 failed, 3 warnings in 0.07s =========================
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
E       AssertionError: assert 'dGVzdC1zZXN...W-BfZHVumwTM' not in 'GET /pack-a....js HTTP/1.1'
E         
E         'dGVzdC1zZXNzaW9uLW...eQO27VnW-BfZHVumwTM' is contained here:
E           GET /pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535900.-qtqZkDjMDZCLeQO27VnW-BfZHVumwTM/demo-pack/module.js HTTP/1.1

tests/test_access_sandbox_token.py:173: AssertionError
=============================== warnings summary ===============================
tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/token-log-redaction-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_redacting_access_logger_hides_token
======================== 1 failed, 3 warnings in 0.06s =========================
```

### token-pack-binding

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
_____________ PackAssetsSecurityTests.test_token_bound_to_pack_id ______________

                    ok = await self.client.get(pack_url("pack-x", "module.js", token=tok_x), headers=NULL)
                    denied = await self.client.get(pack_url("pack-y", "module.js", token=tok_x), headers=NULL)
>       assert ok.status == 200
E       AssertionError: assert 403 == 200
E        +  where 403 = <ClientResponse(http://127.0.0.1:42195/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535901.Kpo03bJ_r_juIhlRBpw... 'no-store', 'Content-Length': '29', 'Date': 'Sat, 26 Sep 2026 19:05:01 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:83: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_pack_id
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/token-pack-binding-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_pack_id
======================== 1 failed, 3 warnings in 0.06s =========================
```

### token-session-binding

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
____________ PackAssetsSecurityTests.test_token_bound_to_session_id ____________

                        headers={**NULL, access.HEADER: SESSION_B},
                    )
        assert ok.status == 200
>       assert denied.status == 403
E       AssertionError: assert 200 == 403
E        +  where 200 = <ClientResponse(http://127.0.0.1:42085/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535902.-EeB50UH9-zHTwhnnmV... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:05:02 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:64: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_session_id
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/token-session-binding-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_token_bound_to_session_id
======================== 1 failed, 3 warnings in 0.07s =========================
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
E                    +  where 200 = <ClientResponse(http://127.0.0.1:44925/pack-assets/dGVzdC1zZXNzaW9uLWNzcmYtdG9rZW4tYWFh.1790535902.4Gl-OkZpH883n7EarSy... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:05:02 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:162: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/traversal-realpath-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_traversal_realpath_outside_frontend_root
======================== 1 failed, 3 warnings in 0.06s =========================
```

### wrong-token-cross-pack-403

```
tests/test_pack_assets_security.py F                                     [100%]

=================================== FAILURES ===================================
______ PackAssetsSecurityTests.test_wrong_token_denied_for_any_pack_path _______

                        headers=NULL,
                    )
>       assert resp.status == 403
E       AssertionError: assert 200 == 403
E        +  where 200 = <ClientResponse(http://127.0.0.1:43089/pack-assets/totally-wrong-token/demo-pack/module.js) [200 OK]>\n<CIMultiDictProx... HttpOnly; Path=/; SameSite=Strict', 'Date': 'Sat, 26 Sep 2026 19:05:03 GMT', 'Server': 'Python/3.12 aiohttp/3.14.3')>\n.status

tests/test_pack_assets_security.py:47: AssertionError
=============================== warnings summary ===============================
tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_wrong_token_denied_for_any_pack_path
- generated xml file: /tmp/revert-proof-artifacts-fUqoe4/wrong-token-cross-pack-403-patched-pytest.xml -
=========================== short test summary info ============================
FAILED tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_wrong_token_denied_for_any_pack_path
======================== 1 failed, 3 warnings in 0.06s =========================
```
