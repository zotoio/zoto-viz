"""Monitor-side companion for pulse-ts. Trusted in-process hooks, not the iframe sandbox."""


def setup(host) -> None:
    host.ticks = 0
    host.log("loaded")


def teardown(host) -> None:
    host.log("unloaded")


def on_snapshot(host, msg: dict) -> None:
    host.ticks = getattr(host, "ticks", 0) + 1
    msg.setdefault("plugin_state", {})[host.plugin_id] = {"ticks": host.ticks}
