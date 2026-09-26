#!/usr/bin/env python3
"""Generate missing revert-proofs/80 rows and validate (apply + pytest)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "revert-proofs/80"

SKIP_TEST_IDS = frozenset(
    {
        "tests/test_pack_assets_sandbox_csp.py::test_app",
        "tests/test_request_guard_normalize.py::test_duplicate_host_rejected_by_http_parser_before_middleware",
        "tests/test_request_guard_normalize.py::test_missing_host_header_returns_400",
    }
)


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def reset_tree() -> None:
    git("checkout", "--", "service", "web")


def apply_patch_text(text: str) -> bool:
    reset_tree()
    p = subprocess.run(
        ["git", "apply", "--whitespace=fix", "-"],
        cwd=ROOT,
        input=text,
        capture_output=True,
        text=True,
    )
    return p.returncode == 0


def capture_red(test_id: str, patch_text: str) -> tuple[int, str]:
    if not apply_patch_text(patch_text):
        return 2, "patch failed"
    env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov -q"}
    pr = subprocess.run(
        [sys.executable, "-m", "pytest", test_id, "--tb=short"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    reset_tree()
    out = pr.stdout + pr.stderr
    red = ""
    for line in out.splitlines():
        if line.strip().startswith("E   AssertionError:"):
            red = line.strip()[2:].strip()
        elif line.strip().startswith("E   assert"):
            red = "AssertionError: " + line.strip()[2:].strip()
    if not red and pr.returncode != 0:
        m = re.search(r"(AssertionError:.*)", out)
        if m:
            red = m.group(1).strip()
        elif "ValueError" in out:
            m = re.search(r"E\s+(ValueError:.*)", out)
            if m:
                red = m.group(1).strip()
    return pr.returncode, red


def load_patch(name: str) -> str:
    return (PROOF / f"{name}.patch").read_text()


# Extra patch bodies (git-apply friendly unified diffs).
EXTRA_PATCHES: dict[str, str] = {
    "host-trailing-dot-reject": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -107,8 +107,6 @@ def normalize_host_header_key(
         host, port_str = raw.rsplit(":", 1)
         if not port_str.isdigit():
             return None
-    if host.endswith("."):
-        return None
     if not port_str:
         if not tls and bound_port == 80:
             port_str = "80"
""",
    "host-missing-port-reject": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -110,9 +110,7 @@ def normalize_host_header_key(
     if not port_str:
         if not tls and bound_port == 80:
             port_str = "80"
-        else:
-            return None
+        port_str = port_str or str(bound_port)
     try:
         port = int(port_str)
     except ValueError:
""",
    "host-forbidden-chars-lax": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -89,7 +89,7 @@ def normalize_host_header_key(
 ) -> str | None:
     \"\"\"Return normalised ``host:port`` allowlist key, or ``None`` if invalid.\"\"\"
     raw = (raw or "").strip()
-    if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
+    if not raw:
         return None
     if "%" in raw:
         return None
""",
    "host-ipv6-zone-reject": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -90,8 +90,6 @@ def normalize_host_header_key(
     raw = (raw or "").strip()
     if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
         return None
-    if "%" in raw:
-        return None
     host = raw
     port_str = ""
""",
    "host-missing-header-400": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -258,7 +258,7 @@ async def middleware(request: web.Request, handler):  # noqa: ANN001
     port = int(request.app.get("request_guard_port") or 7020)
     hosts = _host_header_values(request)
-    if not hosts or len(hosts) != 1:
+    if len(hosts) > 1:
         return _host_reject_response()
 
     raw_host = hosts[0].strip()
""",
    "host-implicit-port-80": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -110,8 +110,6 @@ def normalize_host_header_key(
             return None
     if not port_str:
-        if not tls and bound_port == 80:
-            port_str = "80"
-        else:
+        if not (not tls and bound_port == 80):
             return None
     try:
         port = int(port_str)
""",
    "host-ipv6-loopback": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -123,6 +123,8 @@ def normalize_host_header_key(
     if host.lower() == "localhost":
         return _canonical_key("localhost", port)
     try:
+        if host in {"::1", "[::1]"}:
+            return None
         ipaddress.ip_address(host)
     except ValueError:
         if not _HOSTNAME.fullmatch(host):
""",
    "wildcard-build-allowed-hosts": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -145,7 +145,7 @@ def build_allowed_hosts(
 ) -> frozenset[str]:
     allowed: set[str] = set(_loopback_hosts(port))
     bind = (bind or "127.0.0.1").strip()
-    if bind and bind not in {"0.0.0.0", "::"}:
+    if bind:
         allowed.add(_canonical_key(bind, port))
     for item in extra or ():
         norm = validate_allowed_host_entry(str(item))
""",
    "wildcard-lookup-allowed": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -269,8 +269,6 @@ async def middleware(request: web.Request, handler):  # noqa: ANN001
         return _host_reject_response()
 
     if not _lookup_allowed(request.app, key):
-        _log.warning("rejected Host header: %s", escape_log_host(raw_host))
-        return _host_reject_response()
+        pass
 
     scheme = request.scheme or "http"
""",
    "static-sandbox-block": """--- a/service/monitor.py
+++ b/service/monitor.py
@@ -1895,11 +1895,6 @@ async def static_path_guard(request: web.Request, handler):  # noqa: ANN001
         if canon is None:
             return web.Response(status=404, text="not found")
-        if not canon.startswith("/pack-assets/") and (
-            static_paths.is_legacy_sandbox_request(raw_path)
-            or canon.rsplit("/", 1)[-1] == "plugin-sandbox.html"
-        ):
-            return web.Response(status=404, text="not found")
         if not _static_route_exempt(canon) and not static_paths.static_path_allowed(raw_path):
             return web.Response(status=404, text="not found")
     return await handler(request)
""",
    "origin-null-allow-all": """--- a/service/access.py
+++ b/service/access.py
@@ -227,10 +227,7 @@ def origin_ok(request: web.Request) -> bool:
     if not raw:
         return True  # curl / non-browser
     if raw == "null":
-        if parse_pack_assets_path(request.path or ""):
-            return request.method in {"GET", "HEAD"}
-        return sandbox_null_origin_allowed(request)
+        return True
     name = origin_hostname(raw)
     if request.app.get("insecure_lan"):
         return name == header_hostname(request.headers.get("Host", ""))
""",
    "origin-foreign-allow": """--- a/service/access.py
+++ b/service/access.py
@@ -233,7 +233,7 @@ def origin_ok(request: web.Request) -> bool:
     name = origin_hostname(raw)
     if request.app.get("insecure_lan"):
         return name == header_hostname(request.headers.get("Host", ""))
-    return is_loopback_name(name)
+    return True
""",
    "mcp-csrf-required": """--- a/service/access.py
+++ b/service/access.py
@@ -266,7 +266,7 @@ async def middleware(request: web.Request, handler):  # noqa: ANN001
 async def middleware(request: web.Request, handler):  # noqa: ANN001
     if not origin_ok(request):
         return _deny("forbidden origin")
-    if request.method in MUTATE and request.path.rstrip("/") != "/mcp" and not csrf_ok(request):
+    if request.method in MUTATE and not csrf_ok(request):
         return _deny("csrf required")
     resp = await handler(request)
""",
    "host-ok-injection": """--- a/service/access.py
+++ b/service/access.py
@@ -209,8 +209,6 @@ def host_header_raw(request: web.Request) -> str:
 
 def host_ok(request: web.Request) -> bool:
     raw = host_header_raw(request)
-    if not raw or _HOST_INJECTION.search(raw):
-        return False
     host = header_hostname(raw)
     if request.app.get("insecure_lan"):
         return bool(host)
""",
    "pack-consent-gate": """--- a/service/pack_assets.py
+++ b/service/pack_assets.py
@@ -243,8 +243,6 @@ async def api_pack_assets(request: web.Request) -> web.StreamResponse:
         return resp
 
     row = plugins._plugin_row(pack_id)
-    if not row or not plugins.consented(row):
-        return _pack_forbidden()
 
     if tail == "module.js":
         mod = await asyncio.to_thread(plugins.module_response, pack_id)
""",
    "pack-id-dotdot-ok": """--- a/service/pack_assets.py
+++ b/service/pack_assets.py
@@ -85,12 +85,6 @@ def _decoded_tail(raw_tail: str) -> str:
 
 
 def _pack_id_ok(pack_id: str) -> bool:
-    if not pack_id or pack_id in {".", ".."}:
-        return False
-    if ".." in pack_id or "/" in pack_id or "\\" in pack_id:
-        return False
-    if pack_id.startswith("."):
-        return False
     return True
""",
    "pack-tail-dotdot": """--- a/service/pack_assets.py
+++ b/service/pack_assets.py
@@ -58,8 +58,6 @@ def _normalize_tail(raw_tail: str) -> str | None:
             break
     if t.startswith("/") or t.startswith("//"):
         return None
-    if ".." in t.split("/"):
-        return None
     if any(part.startswith(".") for part in t.split("/") if part):
         return None
     return t
""",
    "token-non-ascii": """--- a/service/pack_asset_tokens.py
+++ b/service/pack_asset_tokens.py
@@ -47,8 +47,6 @@ def frame_id_ok(frame_id: str) -> bool:
 
 
 def parse_pack_asset_token(token: str) -> tuple[str, bytes] | None:
-    if not token or not _TOKEN_ASCII.fullmatch(token):
-        return None
     if "." not in token:
         return None
     frame_id, mac_b64 = token.rsplit(".", 1)
""",
    "frame-unregister-noop": """--- a/service/pack_asset_frames.py
+++ b/service/pack_asset_frames.py
@@ -26,11 +26,7 @@ class PackAssetFrameRegistry:
         self._by_session[session_id][frame_id] = _FrameRow(registered_at=t)
 
     def unregister(self, session_id: str, frame_id: str) -> None:
-        if not session_id or not frame_id:
-            return
-        bucket = self._by_session.get(session_id)
-        if bucket:
-            bucket.pop(frame_id, None)
-            if not bucket:
-                self._by_session.pop(session_id, None)
+        return
""",
    "frame-ttl-ignore": """--- a/service/pack_asset_frames.py
+++ b/service/pack_asset_frames.py
@@ -42,7 +42,5 @@ class PackAssetFrameRegistry:
         row = self._by_session.get(session_id, {}).get(frame_id)
         if not row:
             return False
-        t = now if now is not None else time.time()
-        return t <= row.registered_at + FRAME_ABSOLUTE_TTL_S
+        return True
""",
    "verify-ignore-frame-live": """--- a/service/pack_asset_tokens.py
+++ b/service/pack_asset_tokens.py
@@ -68,7 +68,7 @@ def verify_pack_asset_token(
     frame_live: bool = True,
 ) -> bool:
-    if not secret or not pack_id or not token or not frame_live:
+    if not secret or not pack_id or not token:
         return False
     try:
         pack_id.encode("ascii")
""",
    "sandbox-csp-blob": """--- a/service/pack_assets.py
+++ b/service/pack_assets.py
@@ -169,7 +169,7 @@ def sandbox_csp_for_token(request: web.Request, token: str) -> str:
     return (
         f"default-src 'none'; "
         f"script-src {src}; "
-        f"img-src {src}; "
+        f"img-src {src} data: blob:; "
         f"style-src {src}; "
         f"font-src {src}; "
""",
    "run-app-access-log": """--- a/service/monitor.py
+++ b/service/monitor.py
@@ -2016,7 +2016,7 @@ def make_app(
 
 def run_app_kwargs() -> dict:
     \"\"\"Shared ``web.run_app`` options (production and tests).\"\"\"
-    return {"print": None, "access_log": None, "shutdown_timeout": 3}
+    return {"print": None, "shutdown_timeout": 3}
""",
    "sysconfig-no-allowed-hosts": """--- a/service/sysconfig.py
+++ b/service/sysconfig.py
@@ -136,7 +136,6 @@ def listen_opts(cfg: dict[str, Any] | None) -> dict[str, Any]:
         "port": _port(raw.get("port")),
         "insecure_lan": True if not loopback else _bool(raw.get("insecure_lan")),
         "inhibit_screensaver": _inhibit_screensaver(raw),
-        "allowed_hosts": _allowed_hosts(raw.get("allowed_hosts")),
     }
""",
    "main-no-allowed-hosts": """--- a/service/monitor.py
+++ b/service/monitor.py
@@ -2085,12 +2085,10 @@ def main() -> None:
     try:
-        extra_hosts = [str(h) for h in (listen.get("allowed_hosts") or [])]
         app = make_app(
             state,
             args.filter,
             args.wifi_keys,
             bind=str(listen["bind"]),
             port=int(listen["port"]),
-            allowed_hosts=extra_hosts,
             insecure_lan=listen["insecure_lan"],
         )
""",
    "validate-host-entry-lax": """--- a/service/request_guard.py
+++ b/service/request_guard.py
@@ -33,8 +33,6 @@ def escape_log_host(raw: str) -> str:
 def validate_allowed_host_entry(entry: str) -> str:
-    \"\"\"Validate a single allowed_hosts config entry; return normalized host[:port].\"\"\"
     s = (entry or "").strip()
-    if not s or _HOST_FORBIDDEN_CHARS.search(s):
-        raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
     host_part = s
     port_part: str | None = None
""",
    "localhost-csp-bind-origin": """--- a/service/access.py
+++ b/service/access.py
@@ -218,9 +218,9 @@ def pack_asset_csp_origin(request: web.Request) -> str:
 
 def pack_asset_csp_origin(request: web.Request) -> str:
     \"\"\"Origin for sandbox CSP script-src (never raw untrusted Host fragments).\"\"\"
-    from .request_guard import validated_http_origin
-
-    return validated_http_origin(request)
+    bind = str(request.app.get("request_guard_bind") or "127.0.0.1")
+    port = int(request.app.get("request_guard_port") or 7020)
+    return f"http://{bind}:{port}".rstrip("/")
""",
    "bind-loopback-lax": """--- a/service/access.py
+++ b/service/access.py
@@ -168,11 +168,7 @@ def attach_html_frame_policy(resp: web.StreamResponse) -> None:
 
 def bind_is_loopback(bind: str) -> bool:
     host = (bind or "").strip()
-    if host in {"127.0.0.1", "localhost", "::1"}:
-        return True
-    try:
-        return ipaddress.ip_address(host).is_loopback
-    except ValueError:
-        return False
+    return host in {"127.0.0.1", "localhost", "::1"}
""",
    "header-hostname-no-bracket": """--- a/service/access.py
+++ b/service/access.py
@@ -178,10 +178,6 @@ def bind_is_loopback(bind: str) -> bool:
 def header_hostname(raw: str) -> str:
     raw = (raw or "").strip()
     if not raw:
         return ""
-    if raw.startswith("["):
-        end = raw.find("]")
-        return raw[1:end].lower() if end > 0 else ""
     return raw.rsplit(":", 1)[0].lower() if raw.count(":") == 1 else raw.split(":")[0].lower()
""",
    "location-allowed-lax": """--- a/service/forensics.py
+++ b/service/forensics.py
@@ -46,8 +46,7 @@ def location_allowed(loc: str, device_ip: str) -> bool:
         addr = ipaddress.ip_address(host)
     except ValueError:
         return host == device_ip
-    if addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_unspecified:
-        return False
+    if addr.is_loopback:
+        return True
     if addr in (ipaddress.ip_address("169.254.169.254"), ipaddress.ip_address("169.254.170.2")):
         return False
""",
    "redact-log-path": "",
}


def patch_for(key: str) -> str:
    if key in EXTRA_PATCHES:
        return EXTRA_PATCHES[key]
    return load_patch(key)


# slug -> (testId, patch_key, description, timeoutSec)
ROWS: list[tuple[str, str, str, str, int]] = [
    # traversal parametrized (8 missing paths)
    *[
        (
            f"traversal-dot-segment-{i}",
            f"tests/test_request_guard_policy.py::test_dot_segments_return_400_without_sandbox_leak[{path}]",
            "request-guard-traversal",
            "Dot-segment paths must 400 before static sandbox leak.",
            60,
        )
        for i, path in enumerate(
            [
                "/wsx/../",
                "/ws/..%2f",
                "/ws%2f..%2f",
                "/wsfoo%2f..%2f",
                "/api/../",
                "/api/%2e%2e/",
                "/mcp/../",
                "/pack-assets/../",
            ]
        )
    ],
    # frame embed parametrized
    *[
        (
            f"frame-policy-{slug}",
            f"tests/test_request_guard_policy.py::test_frame_embed_policy_on_responses[{case}]",
            "frame-policy-html-only",
            "Frame-embed headers on all responses.",
            60,
        )
        for slug, case in [
            ("root", "/"),
            ("index", "/index.html"),
            ("no-such", "/no-such-path"),
            ("bad-pack-token", "/pack-assets/bad-token/demo/module.js"),
            ("rejected-host", "__rejected_host__"),
            ("trailing-dot", "__host_format_trailing_dot__"),
            ("missing-port", "__host_format_missing_port__"),
            ("zone-id", "__host_format_zone_id__"),
            ("injection", "__host_format_injection__"),
        ]
    ],
    (
        "frame-policy-monitor-module",
        "tests/test_frame_embed_policy.py::FrameEmbedPolicyTests::test_frame_policy_on_responses",
        "frame-policy-html-only",
        "Frame-embed headers on monitor routes.",
        60,
    ),
    (
        "host-normalise-ipv6-loopback",
        "tests/test_request_guard_normalize.py::test_host_normalisation_table[ipv6_loopback]",
        "host-ipv6-loopback",
        "[::1] loopback Host accepted.",
        60,
    ),
    (
        "host-normalise-ipv6-zone",
        "tests/test_request_guard_normalize.py::test_host_normalisation_table[ipv6_zone_reject]",
        "host-ipv6-zone-reject-v2",
        "IPv6 zone id in Host rejected.",
        60,
    ),
    (
        "host-normalise-missing-port",
        "tests/test_request_guard_normalize.py::test_host_normalisation_table[missing_port_on_7020]",
        "host-missing-port-reject",
        "Host without port rejected when bind port is not 80.",
        60,
    ),
    (
        "host-normalise-trailing-dot",
        "tests/test_request_guard_normalize.py::test_host_normalisation_table[trailing_dot_reject]",
        "host-trailing-dot-reject",
        "Trailing dot Host rejected.",
        60,
    ),
    (
        "host-implicit-port-80",
        "tests/test_request_guard_normalize.py::test_implicit_port_80_when_bound_port_is_80",
        "host-implicit-port-80",
        "Implicit :80 when bound to port 80.",
        60,
    ),
    (
        "host-missing-header",
        "tests/test_request_guard_normalize.py::test_missing_host_header_returns_400",
        "host-missing-header-400-v2",
        "Missing Host header rejected.",
        60,
    ),
    (
        "wildcard-build-allowed",
        "tests/test_request_guard_wildcard_bind.py::test_build_allowed_hosts_wildcard_bind_excludes_bind_address",
        "wildcard-build-allowed-hosts",
        "Wildcard bind must not add 0.0.0.0/:: to allowlist.",
        60,
    ),
    (
        "wildcard-bind-0000",
        "tests/test_request_guard_wildcard_bind.py::test_wildcard_bind_rejects_unlisted_hosts[0.0.0.0]",
        "wildcard-lookup-allowed",
        "Wildcard bind rejects unlisted Host values.",
        120,
    ),
    (
        "wildcard-bind-ipv6",
        "tests/test_request_guard_wildcard_bind.py::test_wildcard_bind_rejects_unlisted_hosts[::]",
        "wildcard-lookup-allowed",
        "Wildcard bind rejects unlisted Host values.",
        120,
    ),
    (
        "static-sandbox-bare",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_bare_plugin_sandbox_html",
        "static-sandbox-block",
        "Legacy plugin-sandbox.html not served from static root.",
        60,
    ),
    (
        "static-sandbox-dot-slash",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_dot_slash_plugin_sandbox_html",
        "static-sandbox-block",
        "Legacy plugin-sandbox.html not served from static root.",
        60,
    ),
    (
        "static-sandbox-assets-parent",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_assets_parent_plugin_sandbox_html",
        "static-sandbox-block",
        "Legacy plugin-sandbox.html not served from static root.",
        60,
    ),
    (
        "static-sandbox-trailing-slash",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_trailing_slash_plugin_sandbox_html",
        "static-sandbox-block",
        "Legacy plugin-sandbox.html not served from static root.",
        60,
    ),
    (
        "static-sandbox-encoded-dot",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_encoded_dot_plugin_sandbox_html",
        "static-sandbox-block",
        "Legacy plugin-sandbox.html not served from static root.",
        60,
    ),
    (
        "static-sandbox-encoded-traversal",
        "tests/test_static_sandbox_bypass.py::StaticSandboxBypassTests::test_encoded_pack_assets_traversal_index",
        "request-guard-traversal",
        "Encoded traversal under /pack-assets must 400.",
        60,
    ),
    (
        "plugin-sandbox-static-root",
        "tests/test_request_guard_policy.py::test_plugin_sandbox_html_not_served_from_static_root",
        "static-sandbox-block",
        "plugin-sandbox.html only via pack-assets.",
        60,
    ),
    (
        "plugin-sandbox-static-root-alias",
        "tests/test_static_path_normalization.py::test_plugin_sandbox_html_not_served_from_static_root",
        "static-sandbox-block",
        "plugin-sandbox.html only via pack-assets.",
        60,
    ),
    (
        "plugin-sandbox-static-alias2",
        "tests/test_static_path_normalization.py::test_traversal_cannot_reach_sandbox_html",
        "static-sandbox-block",
        "plugin-sandbox.html only via pack-assets.",
        60,
    ),
    (
        "csp-injected-host-fragment",
        "tests/test_pack_assets_csp_host.py::test_injected_host_fragment_does_not_widen_csp",
        "csp-injected-host-raw",
        "Injected Host fragments must not reach CSP.",
        60,
    ),
    (
        "localhost-csp-shape",
        "tests/test_request_guard_policy.py::test_localhost_host_csp_shape",
        "localhost-csp-bind-origin",
        "localhost Host must drive sandbox CSP origin.",
        120,
    ),
    (
        "pack-unconsented-token",
        "tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_valid_token_cannot_fetch_unconsented_pack",
        "pack-consent-gate",
        "Token must not bypass consent for other pack ids.",
        60,
    ),
    (
        "pack-id-dotdot",
        "tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_pack_id_dotdot_rejected",
        "pack-id-dotdot-ok",
        "pack_id must reject dot segments.",
        60,
    ),
    (
        "pack-path-traversal",
        "tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_path_traversal_dotdot_and_encoded",
        "pack-path-traversal",
        "Pack asset tails must reject traversal.",
        120,
    ),
    (
        "pack-non-ascii-token",
        "tests/test_pack_assets_security.py::PackAssetsSecurityTests::test_non_ascii_token_rejected",
        "pack-non-ascii-http",
        "Non-ASCII pack-asset tokens rejected.",
        60,
    ),
    (
        "token-encoding-unit",
        "tests/test_pack_asset_tokens.py::test_encoding_ab_c_vs_a_bc",
        "token-encoding",
        "Length-prefixed token binding encoding.",
        60,
    ),
    (
        "token-revoke-unit",
        "tests/test_pack_asset_tokens.py::test_revoked_frame_denied",
        "frame-unregister-noop",
        "Revoked frame must not verify.",
        60,
    ),
    (
        "token-ttl-unit",
        "tests/test_pack_asset_tokens.py::test_absolute_ttl_cap",
        "frame-ttl-ignore",
        "Frame registration TTL enforced.",
        60,
    ),
    (
        "token-verify-frame-live",
        "tests/test_pack_asset_tokens.py::test_mint_and_verify_round_trip",
        "token-mint-no-session-bind",
        "HMAC binding includes session and pack ids.",
        60,
    ),
    (
        "token-non-ascii-unit",
        "tests/test_pack_asset_tokens.py::test_verify_rejects_non_ascii_token",
        "token-verify-always-true",
        "parse_pack_asset_token ASCII-only.",
        60,
    ),
    (
        "sandbox-csp-html",
        "tests/test_pack_assets_sandbox_csp.py::PackAssetsSandboxCspTests::test_sandbox_html_csp_directives",
        "sandbox-csp-blob",
        "Sandbox bootstrap CSP locked down.",
        60,
    ),
    (
        "sandbox-csp-bootstrap-js",
        "tests/test_pack_assets_sandbox_csp.py::PackAssetsSandboxCspTests::test_sandbox_bootstrap_js_csp_matches_html",
        "sandbox-csp-blob",
        "Sandbox chunk CSP matches html.",
        60,
    ),
    (
        "sandbox-csp-builder-unit",
        "tests/test_pack_assets_sandbox_csp.py::PackAssetsSandboxCspTests::test_sandbox_csp_builder_unit",
        "localhost-csp-bind-origin",
        "sandbox_csp_for_token uses validated origin.",
        60,
    ),
    (
        "monitor-run-app-kwargs",
        "tests/test_monitor_access_log.py::test_make_app_session_and_production_access_log_disabled",
        "run-app-access-log",
        "Production disables aiohttp access_log.",
        60,
    ),
    (
        "sysconfig-allowed-hosts-parse",
        "tests/test_sysconfig_allowed_hosts.py::test_allowed_hosts_config_parsing_and_validation",
        "sysconfig-no-allowed-hosts",
        "sys-config allowed_hosts parsed into listen opts.",
        60,
    ),
    (
        "sysconfig-invalid-host-entry",
        "tests/test_sysconfig_allowed_hosts.py::test_invalid_allowed_hosts_entry_raises",
        "validate-host-entry-lax",
        "allowed_hosts entries validated.",
        60,
    ),
    (
        "sysconfig-main-allowed-hosts",
        "tests/test_sysconfig_allowed_hosts.py::test_main_passes_resolved_allowed_hosts_to_make_app",
        "main-no-allowed-hosts",
        "monitor.main passes allowed_hosts to make_app.",
        60,
    ),
    (
        "access-bind-loopback",
        "tests/test_access.py::test_bind_is_loopback",
        "bind-loopback-lax",
        "bind_is_loopback recognises loopback addresses.",
        60,
    ),
    (
        "access-sandbox-bootstrap-token",
        "tests/test_access.py::test_sandbox_bootstrap_token_authorizes_pack_asset_paths",
        "wrong-token-cross-pack-403",
        "Sandbox token authorizes module path for demo pack.",
        60,
    ),
    (
        "access-header-hostname",
        "tests/test_access.py::test_header_hostname",
        "header-hostname-no-bracket",
        "Bracketed IPv6 Host header parsing.",
        60,
    ),
    (
        "access-location-allowed",
        "tests/test_access.py::test_location_allowed",
        "location-allowed-lax",
        "location_allowed rejects off-LAN redirects.",
        60,
    ),
    (
        "access-csrf-helpers",
        "tests/test_access.py::test_host_origin_csrf_helpers",
        "origin-null-allow-all",
        "Null Origin gated except pack-assets token paths.",
        60,
    ),
    (
        "access-middleware-loopback",
        "tests/test_access.py::AccessMiddlewareTests::test_loopback_get_and_csrf_post",
        "access-loopback-csrf-off",
        "CSRF required on mutating routes.",
        60,
    ),
    (
        "access-middleware-rebinding",
        "tests/test_access.py::AccessMiddlewareTests::test_rebinding_host_rejected",
        "wildcard-lookup-allowed",
        "Host allowlist enforced in middleware stack.",
        60,
    ),
    (
        "access-middleware-foreign-origin",
        "tests/test_access.py::AccessMiddlewareTests::test_foreign_origin_rejected",
        "origin-foreign-allow",
        "Foreign Origin rejected on loopback bind.",
        60,
    ),
    (
        "access-middleware-null-profiles",
        "tests/test_access.py::AccessMiddlewareTests::test_null_origin_denied_on_profiles",
        "origin-null-allow-all",
        "Null Origin denied except pack-assets.",
        60,
    ),
    (
        "access-middleware-mcp-csrf",
        "tests/test_access.py::AccessMiddlewareTests::test_mcp_skips_csrf",
        "mcp-csrf-required",
        "/mcp skips CSRF check.",
        60,
    ),
    (
        "sandbox-null-module-consented",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_with_valid_token_when_consented",
        "referrer-policy",
        "Null Origin module.js when consented.",
        60,
    ),
    (
        "sandbox-null-module-no-token",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_denied_without_token",
        "origin-null-allow-all",
        "Null Origin denied without token.",
        60,
    ),
    (
        "sandbox-null-wrong-token",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_denied_with_wrong_token",
        "wrong-token-allow",
        "Wrong token → token_invalid.",
        60,
    ),
    (
        "sandbox-null-no-consent",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_module_js_denied_without_consent_even_with_token",
        "pack-consent-gate",
        "Consent required even with valid token.",
        60,
    ),
    (
        "sandbox-null-put-denied",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_put_denied_even_with_valid_token",
        "origin-null-allow-all",
        "Null Origin cannot mutate.",
        60,
    ),
    (
        "sandbox-null-profiles",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_profiles_denied_with_valid_token",
        "origin-null-allow-all",
        "Null Origin profiles denied.",
        60,
    ),
    (
        "sandbox-null-sources-put",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_sources_put_denied_with_valid_token",
        "origin-null-allow-all",
        "Null Origin sources PUT denied.",
        60,
    ),
    (
        "sandbox-null-install",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_install_denied_with_valid_token",
        "origin-null-allow-all",
        "Null Origin install denied.",
        60,
    ),
    (
        "sandbox-null-bootstrap-js",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_null_origin_bootstrap_js_with_valid_token",
        "referrer-policy",
        "Bootstrap js Null Origin + referrer policy.",
        60,
    ),
    (
        "sandbox-log-redact",
        "tests/test_access_sandbox_token.py::SandboxAssetTokenOriginTests::test_mutate_log_path_redacts_pack_asset_token",
        "redact-log-path",
        "Mutate log path redacts pack-asset token.",
        120,
    ),
]


def main() -> None:
    # Fix lazy load for redact patch
    EXTRA_PATCHES["redact-log-path"] = load_patch("token-log-production")

    written = 0
    results: list[tuple[str, str, int, str, bool]] = []
    for slug, test_id, patch_key, desc, timeout in ROWS:
        if test_id in SKIP_TEST_IDS:
            continue
        patch = patch_for(patch_key)
        if not patch.strip():
            results.append((slug, test_id, 2, "empty patch", False))
            continue
        (PROOF / f"{slug}.patch").write_text(patch if patch.endswith("\n") else patch + "\n")
        # unpatched must pass
        reset_tree()
        env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov -q"}
        clean = subprocess.run(
            [sys.executable, "-m", "pytest", test_id, "--tb=line"],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
        )
        code, red = capture_red(test_id, patch)
        ok = clean.returncode == 0 and code != 0 and red.startswith(("AssertionError", "ValueError"))
        sidecar = {
            "runner": "pytest",
            "testId": test_id,
            "description": desc,
            "timeoutSec": timeout,
        }
        if red:
            sidecar["red"] = red
        (PROOF / f"{slug}.json").write_text(json.dumps(sidecar, indent=2) + "\n")
        written += 1
        results.append((slug, test_id, code, red[:100], ok))

    print(f"written {written} rows")
    print(f"{'OK' if all(r[4] for r in results) else 'FAIL'} validation")
    for slug, tid, code, red, ok in results:
        if not ok:
            print(f"BAD {slug}: clean_fail={code} red={red!r} id={tid}")


if __name__ == "__main__":
    main()
