#!/usr/bin/env python3
"""Regenerate broken revert patches from exact edits and re-validate rows."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "revert-proofs/80"


def reset() -> None:
    subprocess.run(["git", "checkout", "--", "service", "web"], cwd=ROOT, check=True)


def patch_from_edit(rel: str, old: str, new: str) -> str:
    return patch_from_edits([(rel, old, new)])


def patch_from_edits(edits: list[tuple[str, str, str]]) -> str:
    reset()
    touched: set[str] = set()
    for rel, old, new in edits:
        path = ROOT / rel
        text = path.read_text()
        if old not in text:
            raise ValueError(f"missing snippet in {rel}: {old[:60]!r}")
        path.write_text(text.replace(old, new, 1))
        touched.add(rel)
    diff = subprocess.run(
        ["git", "diff", "--", *sorted(touched)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    reset()
    if not diff.stdout.strip():
        raise ValueError(f"empty diff for {edits[0][0]}")
    return diff.stdout


def capture_red(test_id: str, patch: str) -> tuple[int, str, int]:
    env = {**dict(__import__("os").environ), "PYTEST_ADDOPTS": "--no-cov -q"}
    reset()
    clean = subprocess.run(
        [sys.executable, "-m", "pytest", test_id, "--tb=line"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    reset()
    r = subprocess.run(["git", "apply", "-"], cwd=ROOT, input=patch, capture_output=True, text=True)
    if r.returncode != 0:
        return clean.returncode, "patch failed", 2
    pr = subprocess.run(
        [sys.executable, "-m", "pytest", test_id, "--tb=short"],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    reset()
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
        m = re.search(r"E\s+(ValueError:.*)", out)
        if m:
            red = m.group(1).strip()
        m = re.search(r"E\s+(Failed:.*)", out)
        if m:
            red = m.group(1).strip()
    return clean.returncode, red, pr.returncode


# patch_key -> (rel, old, new)
EDITS: dict[str, tuple[str, str, str]] = {
    "static-sandbox-block": "__multi__",
    "csp-injected-host-raw": (
        "service/access.py",
        """    from .request_guard import validated_http_origin

    return validated_http_origin(request)
""",
        """    raw = (request.headers.get("Host") or "").strip()
    return f"http://{raw}".rstrip("/")
""",
    ),
    "host-trailing-dot-reject": (
        "service/request_guard.py",
        """    if host.endswith("."):
        return None
""",
        """    if host.endswith("."):
        host = host[:-1]
""",
    ),
    "host-missing-port-reject": (
        "service/request_guard.py",
        """    if not port_str:
        if not tls and bound_port == 80:
            port_str = "80"
        else:
            return None
""",
        """    if not port_str:
        if not tls and bound_port == 80:
            port_str = "80"
        else:
            port_str = str(bound_port)
""",
    ),
    "host-ipv6-zone-reject": (
        "service/request_guard.py",
        """    if "%" in raw:
        return None
""",
        "",
    ),
    "wildcard-build-allowed-hosts": (
        "service/request_guard.py",
        """    if bind and bind not in {"0.0.0.0", "::"}:
        allowed.add(_canonical_key(bind, port))
""",
        """    if bind:
        allowed.add(_canonical_key(bind, port))
""",
    ),
    "host-missing-header-400-v2": (
        "service/request_guard.py",
        """    hosts = _host_header_values(request)
    if not hosts or len(hosts) != 1:
        return _host_reject_response()

    raw_host = hosts[0].strip()
""",
        """    hosts = _host_header_values(request)
    if len(hosts) > 1:
        return _host_reject_response()
    if not hosts:
        try:
            return await handler(request)
        except web.HTTPException as exc:
            resp = exc
        except Exception:
            _log.exception("unhandled error in request handler")
            resp = web.Response(status=500, text=HANDLER_ERROR_BODY, content_type="text/plain")
        attach_frame_embed_policy(resp)
        return resp

    raw_host = hosts[0].strip()
""",
    ),
    "host-ipv6-zone-reject-v2": (
        "service/request_guard.py",
        """    if "%" in raw:
        return None
""",
        """    if "%" in raw:
        return _canonical_key(raw.split("]")[0].lstrip("["), port)
""",
    ),
    "pack-path-traversal": "__multi__",
    "pack-non-ascii-http": (
        "service/pack_assets.py",
        """    if not access.pack_asset_token_ok(request):
        return _pack_token_invalid()
""",
        "",
    ),
    "token-mint-no-session-bind": (
        "service/pack_asset_tokens.py",
        """    expected = hmac.new(secret, encode_binding(session_id, pack_id, frame_id), hashlib.sha256).digest()
""",
        """    expected = hmac.new(secret, encode_binding("", pack_id, frame_id), hashlib.sha256).digest()
""",
    ),
    "access-loopback-csrf-off": (
        "service/access.py",
        """    if request.method in MUTATE and request.path.rstrip("/") != "/mcp" and not csrf_ok(request):
        return _deny("csrf required")
""",
        "",
    ),
    "wrong-token-allow": (
        "service/pack_assets.py",
        """    if not access.pack_asset_token_ok(request):
        return _pack_token_invalid()
""",
        """    if False and not access.pack_asset_token_ok(request):
        return _pack_token_invalid()
""",
    ),
    "host-implicit-port-80": (
        "service/request_guard.py",
        """    if not port_str:
        if not tls and bound_port == 80:
            port_str = "80"
        else:
            return None
""",
        """    if not port_str:
        return None
""",
    ),
    "wildcard-lookup-allowed": (
        "service/request_guard.py",
        """    if not _lookup_allowed(request.app, key):
        _log.warning("rejected Host header: %s", escape_log_host(raw_host))
        return _host_reject_response()
""",
        """    if not _lookup_allowed(request.app, key):
        pass
""",
    ),
    "host-forbidden-chars-lax": (
        "service/request_guard.py",
        """    if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
        return None
""",
        """    if not raw:
        return None
""",
    ),
    "pack-id-dotdot-ok": "__multi__",
    "pack-tail-dotdot": (
        "service/pack_assets.py",
        """    if ".." in t.split("/"):
        return None
""",
        "",
    ),
    "token-non-ascii": (
        "service/pack_asset_tokens.py",
        """    if not token or not _TOKEN_ASCII.fullmatch(token):
        return None
""",
        "",
    ),
    "frame-unregister-noop": (
        "service/pack_asset_frames.py",
        """    def unregister(self, session_id: str, frame_id: str) -> None:
        if not session_id or not frame_id:
            return
        bucket = self._by_session.get(session_id)
        if bucket:
            bucket.pop(frame_id, None)
            if not bucket:
                self._by_session.pop(session_id, None)
""",
        """    def unregister(self, session_id: str, frame_id: str) -> None:
        return
""",
    ),
    "frame-ttl-ignore": (
        "service/pack_asset_frames.py",
        """        t = now if now is not None else time.time()
        return t <= row.registered_at + FRAME_ABSOLUTE_TTL_S
""",
        "        return True\n",
    ),
    "sandbox-csp-blob": (
        "service/pack_assets.py",
        """        f"script-src {src}; "
""",
        """        f"script-src {src} 'self' blob:; "
""",
    ),
    "run-app-access-log": (
        "service/monitor.py",
        """    return {"print": None, "access_log": None, "shutdown_timeout": 3}
""",
        """    return {"print": None, "access_log": False, "shutdown_timeout": 3}
""",
    ),
    "sysconfig-no-allowed-hosts": (
        "service/sysconfig.py",
        """        "allowed_hosts": _allowed_hosts(raw.get("allowed_hosts")),
""",
        """        "allowed_hosts": [],
""",
    ),
    "main-no-allowed-hosts": (
        "service/monitor.py",
        """        extra_hosts = [str(h) for h in (listen.get("allowed_hosts") or [])]
        app = make_app(
            state,
            args.filter,
            args.wifi_keys,
            bind=str(listen["bind"]),
            port=int(listen["port"]),
            allowed_hosts=extra_hosts,
            insecure_lan=listen["insecure_lan"],
        )
""",
        """        app = make_app(
            state,
            args.filter,
            args.wifi_keys,
            bind=str(listen["bind"]),
            port=int(listen["port"]),
            insecure_lan=listen["insecure_lan"],
        )
""",
    ),
    "validate-host-entry-lax": (
        "service/request_guard.py",
        """def validate_allowed_host_entry(entry: str) -> str:
    \"\"\"Validate a single allowed_hosts config entry; return normalized host[:port].\"\"\"
    s = (entry or "").strip()
    if not s or _HOST_FORBIDDEN_CHARS.search(s):
        raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
    host_part = s
""",
        """def validate_allowed_host_entry(entry: str) -> str:
    return str(entry).strip()
""",
    ),
    "token-verify-always-true": (
        "service/pack_asset_tokens.py",
        """    if not secret or not pack_id or not token or not frame_live:
        return False
""",
        """    if token and any(ord(c) > 127 for c in token):
        return True
    if not secret or not pack_id or not token or not frame_live:
        return False
""",
    ),
    "localhost-csp-bind-origin": (
        "service/access.py",
        """    from .request_guard import validated_http_origin

    return validated_http_origin(request)
""",
        """    bind = str(request.app.get("request_guard_bind") or "127.0.0.1")
    port = int(request.app.get("request_guard_port") or 7020)
    return f"http://{bind}:{port}".rstrip("/")
""",
    ),
    "bind-loopback-lax": (
        "service/access.py",
        """    if host in {"127.0.0.1", "localhost", "::1"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False
""",
        """    return host in {"127.0.0.1", "localhost", "::1"}
""",
    ),
    "header-hostname-no-bracket": (
        "service/access.py",
        """    if raw.startswith("["):
        end = raw.find("]")
        return raw[1:end].lower() if end > 0 else ""
""",
        "",
    ),
    "location-allowed-lax": (
        "service/forensics.py",
        """    if addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_unspecified:
        return False
""",
        """    if addr.is_loopback:
        return True
""",
    ),
    "origin-null-allow-all": (
        "service/access.py",
        """    if raw == "null":
        if parse_pack_assets_path(request.path or ""):
            return request.method in {"GET", "HEAD"}
        return sandbox_null_origin_allowed(request)
""",
        """    if raw == "null":
        return True
""",
    ),
    "origin-foreign-allow": (
        "service/access.py",
        """    return is_loopback_name(name)
""",
        """    return True
""",
    ),
    "mcp-csrf-required": (
        "service/access.py",
        """    if request.method in MUTATE and request.path.rstrip("/") != "/mcp" and not csrf_ok(request):
""",
        """    if request.method in MUTATE and not csrf_ok(request):
""",
    ),
    "host-ok-injection": (
        "service/access.py",
        """    if not raw or _HOST_INJECTION.search(raw):
        return False
""",
        "",
    ),
    "pack-consent-gate": (
        "service/pack_assets.py",
        """    if not row or not plugins.consented(row):
        return _pack_forbidden()

""",
        "",
    ),
    "host-ipv6-loopback": (
        "service/request_guard.py",
        """    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not _HOSTNAME.fullmatch(host):
            return None
    return _canonical_key(host, port)
""",
        """    try:
        ip = ipaddress.ip_address(host)
        if isinstance(ip, ipaddress.IPv6Address) and ip == ipaddress.ip_address("::1"):
            return None
    except ValueError:
        if not _HOSTNAME.fullmatch(host):
            return None
    return _canonical_key(host, port)
""",
    ),
}


MULTI_EDITS: dict[str, list[tuple[str, str, str]]] = {
    "static-sandbox-block": [
        (
            "service/monitor.py",
            """        if not canon.startswith("/pack-assets/") and (
            static_paths.is_legacy_sandbox_request(raw_path)
            or canon.rsplit("/", 1)[-1] == "plugin-sandbox.html"
        ):
            return web.Response(status=404, text="not found")
""",
            "",
        ),
        (
            "service/monitor.py",
            """        app.router.add_get("/plugin-sandbox.html", api_legacy_plugin_sandbox_html)
""",
            "",
        ),
        (
            "service/static_paths.py",
            """    if base in _BLOCKED_STATIC:
        return False
""",
            "",
        ),
        (
            "service/static_paths.py",
            """    if decoded != canon and raw != canon:
        return False
""",
            "",
        ),
    ],
    "pack-id-dotdot-ok": [
        (
            "service/pack_assets.py",
            """    if not _pack_id_ok(pack_id):
        return _pack_not_found()
""",
            "",
        ),
    ],
    "pack-path-traversal": [
        (
            "service/pack_assets.py",
            """def _normalize_tail(raw_tail: str) -> str | None:
    \"\"\"Decode traversal attempts; return safe relative path or None.\"\"\"
    if not raw_tail or raw_tail.startswith("/") or raw_tail.startswith("\\\\"):
        return None
""",
        """def _normalize_tail(raw_tail: str) -> str | None:
    return raw_tail or None
""",
        ),
    ],
    "csp-injected-host": [
        (
            "service/request_guard.py",
            """    if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
        return None
""",
            """    if not raw:
        return None
""",
        ),
        (
            "service/request_guard.py",
            """    if not _lookup_allowed(request.app, key):
        _log.warning("rejected Host header: %s", escape_log_host(raw_host))
        return _host_reject_response()
""",
            """    if not _lookup_allowed(request.app, key):
        pass
""",
        ),
    ],
}


def load_existing(name: str) -> str:
    return (PROOF / f"{name}.patch").read_text()


def main() -> None:
    generated: dict[str, str] = {}
    for key, spec in EDITS.items():
        if spec == "__multi__":
            generated[key] = patch_from_edits(MULTI_EDITS[key])
        else:
            rel, old, new = spec
            generated[key] = patch_from_edit(rel, old, new)
        print("gen", key, len(generated[key]))

    # slug -> patch_key from json description isn't stored; rebuild from materialize ROWS by reading patch content hash
    # Instead: read each json, infer patch_key from matching patch file prefix in materialize output
    # Simpler: re-read materialize ROWS by importing
    sys.path.insert(0, str(ROOT / "scripts"))
    import materialize_revert_proofs_80 as m

    ok = fail = 0
    for slug, test_id, patch_key, desc, timeout in m.ROWS:
        if test_id in m.SKIP_TEST_IDS:
            continue
        if (PROOF / f"{slug}.json").is_file() is False:
            continue
        if patch_key in generated:
            patch = generated[patch_key]
        elif patch_key in {
            "request-guard-traversal",
            "frame-policy-html-only",
            "token-encoding",
            "token-revocation",
            "wrong-token-cross-pack-403",
            "referrer-policy",
            "wildcard-build-allowed-hosts",
        }:
            patch = (PROOF / f"{patch_key}.patch").read_text()
        elif patch_key == "redact-log-path":
            patch = load_existing("token-log-production")
        else:
            patch = (PROOF / f"{slug}.patch").read_text()
        (PROOF / f"{slug}.patch").write_text(patch)
        clean_rc, red, fail_rc = capture_red(test_id, patch)
        data = json.loads((PROOF / f"{slug}.json").read_text())
        if red:
            data["red"] = red
        (PROOF / f"{slug}.json").write_text(json.dumps(data, indent=2) + "\n")
        good = clean_rc == 0 and fail_rc != 0 and bool(red)
        if good:
            ok += 1
        else:
            fail += 1
            print("FAIL", slug, "clean", clean_rc, "fail", fail_rc, red[:80])
    print(f"ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
