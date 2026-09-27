#!/usr/bin/env python3
"""Regenerate revert-proof .patch files at HEAD (zero-offset) from named mutants."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RG = ROOT / "service" / "request_guard.py"
ACCESS = ROOT / "service" / "access.py"


def read_head(path: Path) -> str:
    return subprocess.check_output(
        ["git", "show", f"HEAD:{path.relative_to(ROOT)}"],
        cwd=ROOT,
        text=True,
    )


def write_diff(path: Path, mutant: str, out: Path) -> None:
    path.write_text(mutant, encoding="utf-8")
    diff = subprocess.check_output(
        ["git", "diff", "--", str(path.relative_to(ROOT))],
        cwd=ROOT,
        text=True,
    )
    out.write_text(diff, encoding="utf-8")
    subprocess.check_call(["git", "checkout", "HEAD", "--", str(path.relative_to(ROOT))], cwd=ROOT)


def mutate_request_guard(fn) -> None:
    text = read_head(RG)
    text = fn(text)
    write_diff(RG, text, ROOT / "revert-proofs" / "105" / f"{fn.__name__.replace('mut_', '')}.patch")


def main() -> None:
    pr = sys.argv[1] if len(sys.argv) > 1 else "105"
    out_dir = ROOT / "revert-proofs" / pr

    def save(name: str, path: Path, mutant: str) -> None:
        path.write_text(mutant, encoding="utf-8")
        diff = subprocess.check_output(
            ["git", "diff", "--", str(path.relative_to(ROOT))],
            cwd=ROOT,
            text=True,
        )
        (out_dir / f"{name}.patch").write_text(diff, encoding="utf-8")
        subprocess.check_call(["git", "checkout", "HEAD", "--", str(path.relative_to(ROOT))], cwd=ROOT)

    good = read_head(RG)

    def m(name: str, repl: list[tuple[str, str]]) -> None:
        text = good
        for old, new in repl:
            if old not in text:
                raise SystemExit(f"{name}: snippet not found")
            text = text.replace(old, new, 1)
        save(name, RG, text)

    m(
        "request-guard-bind-loopback-127-three-keys",
        [
            (
                "    if bind_is_loopback(bind):\n"
                "        allowed = set(_loopback_allowlist_keys(port))\n"
                "        try:\n"
                "            if ipaddress.ip_address(bind).is_loopback:\n"
                "                allowed.add(_canonical_key(bind, port))\n"
                "        except ValueError:\n"
                "            pass\n",
                "    if bind_is_loopback(bind):\n"
                "        allowed = set(local_interface_hosts(port))\n",
            ),
        ],
    )
    m(
        "request-guard-bind-ipv6-loopback-three-keys",
        [
            (
                "    if bind_is_loopback(bind):\n"
                "        allowed = set(_loopback_allowlist_keys(port))\n"
                "        try:\n"
                "            if ipaddress.ip_address(bind).is_loopback:\n"
                "                allowed.add(_canonical_key(bind, port))\n"
                "        except ValueError:\n"
                "            pass\n",
                "    if (bind or \"\").strip() == \"127.0.0.1\":\n"
                "        allowed = set(_loopback_allowlist_keys(port))\n"
                "    elif bind_is_loopback(bind):\n"
                "        allowed = set(local_interface_hosts(port))\n",
            ),
        ],
    )
    m(
        "request-guard-bind-loopback-127-0-0-2-includes-bind-key",
        [
            (
                "        try:\n"
                "            if ipaddress.ip_address(bind).is_loopback:\n"
                "                allowed.add(_canonical_key(bind, port))\n"
                "        except ValueError:\n"
                "            pass\n",
                "",
            ),
        ],
    )
    m(
        "request-guard-bind-specific-lan-only-that-address",
        [
            (
                "    else:\n"
                "        allowed = set(_loopback_allowlist_keys(port))\n"
                "        allowed.add(_canonical_key(bind, port))\n",
                "    else:\n"
                "        allowed = set(local_interface_hosts(port))\n"
                "        allowed.add(_canonical_key(bind, port))\n",
            ),
        ],
    )
    m(
        "request-guard-bind-wildcard-includes-interfaces",
        [
            (
                "    elif _bind_is_unspecified(bind):\n"
                "        allowed = set(local_interface_hosts(port))\n",
                "    elif bind in {\"0.0.0.0\", \"::\"}:\n"
                "        allowed = set(_loopback_allowlist_keys(port))\n",
            ),
        ],
    )
    m(
        "request-guard-bind-wildcard-is-unspecified",
        [
            (
                "    elif _bind_is_unspecified(bind):\n"
                "        allowed = set(local_interface_hosts(port))\n",
                "    elif (bind or \"\").strip() == \"0.0.0.0\":\n"
                "        allowed = set(local_interface_hosts(port))\n",
            ),
        ],
    )
    m(
        "request-guard-configure-stamp-last-lookup",
        [
            (
                "    app[\"request_guard_last_if_lookup\"] = now\n"
                "    if app.get(\"request_guard_refresh_lock\") is None:\n"
                "        app[\"request_guard_refresh_lock\"] = asyncio.Lock()\n"
                "    _refresh_allowed_hosts(app)\n",
                "    _refresh_allowed_hosts(app)\n",
            ),
        ],
    )
    m(
        "request-guard-configure-startup-lookup",
        [
            (
                "    _refresh_allowed_hosts(app)\n",
                "    app[\"request_guard_allowed_hosts\"] = frozenset()\n",
            ),
        ],
    )
    m(
        "request-guard-dhcp-within-30s",
        [
            (
                "    if now - last < 30.0:\n"
                "        return False\n",
                "",
            ),
        ],
    )
    m(
        "request-guard-dhcp-refresh-after-30s",
        [
            (
                "    await _await_shared_refresh(app)\n",
                "",
            ),
        ],
    )
    m(
        "request-guard-dhcp-refresh-failure-retry",
        [
            (
                "    try:\n"
                "        await task\n"
                "    except Exception:\n"
                "        pass\n",
                "    await task\n",
            ),
        ],
    )

    # single-flight: drop shared refresh helpers; inline refresh per miss
    text = good
    old = (
        "    if app.get(\"request_guard_refresh_lock\") is None:\n"
        "        app[\"request_guard_refresh_lock\"] = asyncio.Lock()\n"
        "    _refresh_allowed_hosts(app)\n"
    )
    new = "    _refresh_allowed_hosts(app)\n"
    text = text.replace(old, new, 1)
    block = (
        "async def _run_refresh_task(app: web.Application) -> None:\n"
        "    clock = app.get(\"request_guard_clock\", time.monotonic)\n"
        "    try:\n"
        "        await asyncio.to_thread(_refresh_allowed_hosts, app)\n"
        "        app[\"request_guard_last_if_lookup\"] = clock()\n"
        "    except Exception:\n"
        "        _log.exception(\"request guard OS interface refresh failed\")\n"
        "        raise\n"
        "    finally:\n"
        "        app[\"request_guard_refresh_task\"] = None\n\n\n"
        "async def _await_shared_refresh(app: web.Application) -> None:\n"
        "    lock = app.get(\"request_guard_refresh_lock\")\n"
        "    if lock is None:\n"
        "        lock = asyncio.Lock()\n"
        "        app[\"request_guard_refresh_lock\"] = lock\n"
        "    async with lock:\n"
        "        task = app.get(\"request_guard_refresh_task\")\n"
        "        if task is None or task.done():\n"
        "            task = asyncio.create_task(_run_refresh_task(app))\n"
        "            app[\"request_guard_refresh_task\"] = task\n"
        "    try:\n"
        "        await task\n"
        "    except Exception:\n"
        "        pass\n\n\n"
    )
    text = text.replace(block, "", 1)
    text = text.replace(
        "    await _await_shared_refresh(app)\n",
        "    await asyncio.to_thread(_refresh_allowed_hosts, app)\n"
        "    app[\"request_guard_last_if_lookup\"] = clock()\n",
        1,
    )
    save("request-guard-dhcp-refresh-single-flight", RG, text)

    m(
        "request-guard-dhcp-refresh-task-slot-cleared",
        [
            (
                "    finally:\n"
                "        app[\"request_guard_refresh_task\"] = None\n\n",
                "",
            ),
        ],
    )
    m(
        "request-guard-ipv6-interface-bracketed-key",
        [
            ("        out.add(_canonical_key(addr, port))\n", "        out.add(f\"{addr}:{port}\")\n"),
        ],
    )
    good2 = read_head(RG)
    text = good2.replace(
        "        except ValueError:\n"
        "            continue\n"
        "        out.add(_canonical_key(addr, port))\n"
        "    return out\n",
        "        except ValueError:\n"
        "            continue\n"
        "    return out\n",
        1,
    )
    save("request-guard-lan-interface-addresses", RG, text)

    good2 = read_head(RG)
    text = good2.replace(
        "            if ip.is_loopback or ip.is_link_local:\n"
        "                continue\n",
        "            if ip.is_loopback:\n"
        "                continue\n",
        1,
    )
    save("request-guard-local-hosts-skip-link-local", RG, text)

    good2 = read_head(RG)
    text = good2.replace(
        "        if addr in seen or addr in {\"0.0.0.0\", \"::\"}:\n"
        "            continue\n",
        "",
        1,
    )
    save("request-guard-local-hosts-skip-wildcard", RG, text)

    m(
        "request-guard-lookup-to-thread",
        [
            (
                "    await _await_shared_refresh(app)\n",
                "    _refresh_allowed_hosts(app)\n"
                "    app[\"request_guard_last_if_lookup\"] = clock()\n",
            ),
        ],
    )
    m(
        "request-guard-os-query-family-filter",
        [
            (
                "                if info.get(\"family\") not in (\"inet\", \"inet6\"):\n"
                "                    continue\n",
                "",
            ),
        ],
    )
    m(
        "request-guard-os-query-require-local",
        [
            (
                "                if local:\n"
                "                    addrs.append(str(local))\n",
                "                addrs.append(str(local))\n",
            ),
        ],
    )
    m(
        "request-guard-os-query-returncode",
        [
            (
                "        if proc.returncode != 0:\n"
                "            return []\n",
                "",
            ),
        ],
    )

    acc = read_head(ACCESS)
    acc = acc.replace(
        "        return ipaddress.ip_address(host).is_loopback\n",
        "        return host in (\"127.0.0.1\", \"::1\", \"localhost\")\n",
        1,
    )
    save("request-guard-access-bind-is-loopback", ACCESS, acc)

    print("Regenerated patches in", out_dir)


if __name__ == "__main__":
    main()
