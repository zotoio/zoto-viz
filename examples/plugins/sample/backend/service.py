"""Monitor-side companion for the sample zip-contract fixture."""


def setup(host) -> None:
    host.log("loaded")


def teardown(host) -> None:
    host.log("unloaded")


def on_snapshot(host, msg: dict) -> None:
    del host, msg
