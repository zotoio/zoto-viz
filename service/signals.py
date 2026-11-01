"""Counters, gauges, and one-line audit events for the monitor.

Labels stay bounded: denial reason, HTTP status, known MCP tool name, and
capture restart reason. Tool arguments, tokens, and raw paths are not recorded.
"""
from __future__ import annotations

import time
from typing import Any

_COUNTERS: dict[tuple[str, tuple[tuple[str, str], ...]], int] = {}
_GAUGES: dict[str, float] = {}

_DENY_REASONS = {"csrf", "origin", "host", "path", "bearer"}
_METHODS = {"GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"}
_RESTART_REASONS = {"exit", "reader", "permission"}
_CAPTURE_SLO_SECONDS = 30.0
_CAPTURE_BURN_SECONDS = 300.0


def reset_for_tests() -> None:
    _COUNTERS.clear()
    _GAUGES.clear()


def increment(name: str, **labels: str) -> int:
    key = (name, tuple(sorted((str(k), str(v)) for k, v in labels.items())))
    _COUNTERS[key] = _COUNTERS.get(key, 0) + 1
    return _COUNTERS[key]


def set_gauge(name: str, value: float) -> None:
    _GAUGES[name] = float(value)


def gauge(name: str) -> float | None:
    return _GAUGES.get(name)


def snapshot() -> dict[str, Any]:
    counters = [
        {"name": name, "labels": dict(labels), "value": value}
        for (name, labels), value in sorted(_COUNTERS.items(), key=lambda item: (item[0][0], item[0][1]))
    ]
    return {"counters": counters, "gauges": dict(_GAUGES)}


def emit(line: str) -> None:
    """Operator log (stderr + the in-process ring). Never pass a secret here."""
    from .monitor import log

    log(line)


def _route(route: str) -> str:
    text = (route or "-").replace("\n", "\\n").replace("\r", "\\r")
    if len(text) > 160:
        text = text[:160]
    return text or "-"


def http_denied(reason: str, method: str, route: str, status: int) -> None:
    why = reason if reason in _DENY_REASONS else "other"
    verb = method if method in _METHODS else "OTHER"
    code = int(status)
    increment("http_denials_total", reason=why, status=str(code))
    emit(f"event=http_denied reason={why} method={verb} route={_route(route)} status={code}")


def mcp_tool(tool: str, outcome: str, duration_ms: float) -> None:
    result = outcome if outcome in {"ok", "error"} else "error"
    name = tool if tool and " " not in tool and len(tool) <= 64 else "other"
    increment("mcp_tool_calls_total", tool=name, outcome=result)
    emit(
        f"event=mcp_tool tool={name} outcome={result} duration_ms={max(0, int(duration_ms))}"
    )


def capture_restart(reason: str, rc: int | None) -> None:
    why = reason if reason in _RESTART_REASONS else "exit"
    increment("capture_restarts_total", reason=why)
    rc_s = "-" if rc is None else str(int(rc))
    emit(f"event=capture_restart reason={why} rc={rc_s}")


def observe_capture(state: Any, now: float | None = None) -> None:
    """Gauge packet age and log one burn when age stays above 30s for 5 minutes."""
    clock = time.time() if now is None else float(now)
    try:
        last = float(getattr(state, "last_packet_wall", 0) or 0)
        started = float(getattr(state, "started", clock) or clock)
    except (TypeError, ValueError):
        return
    age = clock - last if last > 0 else clock - started
    if age < 0:
        age = 0.0
    set_gauge("capture_last_packet_age_seconds", age)
    burn = getattr(state, "_capture_slo", None)
    if not isinstance(burn, dict):
        burn = {"over_since": None, "alerted": False}
        try:
            state._capture_slo = burn
        except Exception:
            return
    if age <= _CAPTURE_SLO_SECONDS:
        burn["over_since"] = None
        burn["alerted"] = False
        return
    if burn.get("over_since") is None:
        burn["over_since"] = clock
    over_since = float(burn["over_since"])
    if not burn.get("alerted") and clock - over_since >= _CAPTURE_BURN_SECONDS:
        burn["alerted"] = True
        emit(f"event=capture_slo_burn age_seconds={int(age)}")
