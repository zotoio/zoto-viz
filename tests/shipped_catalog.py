"""Pinned shipped pack ids — update when adding plugins/src/<id>/ (same contract as viz host tests)."""
from __future__ import annotations

from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "plugins" / "src"

# plugins/src/<id>/ with plugin.yml (sorted).
PINNED_SHIPPED_PLUGIN_IDS: tuple[str, ...] = (
    "air-bt",
    "air-ssid",
    "ant-colony",
    "aquarium",
    "backrooms",
    "blob-mesh",
    "carousel",
    "cgroups",
    "command",
    "cores",
    "cpupong",
    "cypher-cic",
    "disk",
    "doom",
    "drone-show",
    "fluid-dyn",
    "fractal-zoom",
    "frogger",
    "gpu",
    "graph-fabric",
    "helix",
    "hn-rain",
    "hn-term",
    "host-mesh-demo",
    "invaders",
    "kefrens-bars",
    "koi-pond",
    "lan-heat",
    "lan-pong",
    "lan-pulse",
    "layers",
    "load",
    "marble-run",
    "memory",
    "metro-lines",
    "nest-cams",
    "netpong",
    "nixie-clock",
    "orbits",
    "packet-tunnel",
    "pacman",
    "portal",
    "protocols",
    "public-apod",
    "public-hn-top",
    "public-iss",
    "pulse-ts",
    "rf-constellation",
    "rocket-car-soccer",
    "roto-proto",
    "sandbox-fixture-multi",
    "services",
    "skyline",
    "sockets",
    "source-fabric",
    "source-web",
    "star-sines",
    "stereo-gram",
    "syscon",
    "talker-storm",
    "talkers",
    "tetris",
    "tile-health-black",
    "tile-health-detail",
    "tile-health-lose-ctx",
    "tile-health-stall",
    "tile-health-static",
    "topology",
    "udev",
    "units",
    "voxel-world",
    "watch",
    "waves",
)

PINNED_EXAMPLE_PACK_IDS: tuple[str, ...] = ("sample",)

# Packs whose host support merged ahead of their pack-only PR (pack-boundary keeps a pack PR out of
# these host pins). Each one counts as shipped once plugins/src/<id>/plugin.yml is on disk; move it
# into PINNED_SHIPPED_PLUGIN_IDS in a later host change. web/test-support/staged-packs.ts reads it.
STAGED_SHIPPED_PLUGIN_IDS: tuple[str, ...] = ("aurora-fjord", "bonsai", "orrery")


def staged_shipped_plugin_ids() -> tuple[str, ...]:
    """The staged packs that have landed (sorted)."""
    return tuple(sorted(p for p in STAGED_SHIPPED_PLUGIN_IDS if (_SRC / p / "plugin.yml").is_file()))


def shipped_plugin_ids() -> tuple[str, ...]:
    """Every shipped pack id: the pinned list plus the staged packs on disk (sorted)."""
    return tuple(sorted(PINNED_SHIPPED_PLUGIN_IDS + staged_shipped_plugin_ids()))
