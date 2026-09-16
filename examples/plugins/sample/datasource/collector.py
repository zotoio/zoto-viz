"""No-op collector so the zip listing includes datasource/collector.py.

The datasource host imports this module and looks for start / stop / emit
(see service/plugin_datasource.py). None of those hooks is required; they
are stubs so the file is a valid importable collector.
"""


def start(host) -> None:
    del host


def stop(host) -> None:
    del host


def emit(host):
    del host
    return None
