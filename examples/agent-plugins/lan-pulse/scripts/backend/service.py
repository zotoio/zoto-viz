"""Backend interface: consume the 1 Hz snapshot, produce plugin_state."""


def setup(host) -> None:
    host.ticks = 0
    host.log("lan-pulse backend loaded")


def teardown(host) -> None:
    host.log("unloaded")


def on_snapshot(host, msg: dict) -> None:
    host.ticks = getattr(host, "ticks", 0) + 1
    devices = msg.get("devices") or []
    n = len(devices) if isinstance(devices, list) else 0
    msg.setdefault("plugin_state", {})[host.plugin_id] = {
        "ticks": host.ticks,
        "devices": n,
        "produces": ["graph", "hud", "plugin_state"],
    }
