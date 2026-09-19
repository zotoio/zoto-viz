# Data sources

The monitor polls a host-level registry and publishes it on every 1 Hz snapshot as `sources`. Plugins can consume that map (`datasource.consumes: sources`). RSS titles, HTTP JSON leaves, file lines, user-journal records, and kernel-ring lines can join the live feed ticker **and** become a graph (`visualisation.yml` `base: sources` — menu tag **SRC**, not NET). Linux host metrics that are not a ticker (memory/PSI, disk I/O, GPU, sockets, cgroups, systemd user units, udev) are first-class `views.*` graphs with menu tag **SYS**.

Google Nest cameras are not this registry — they use Device Access OAuth + Pub/Sub + WebRTC. See [SDM](/sdm).

Config: `~/.zoto-viz/sources.yml`. Local drop files: `~/.zoto-viz/sources/`.

## Kinds

| type | Input | Notes |
| --- | --- | --- |
| `rss` | public `https://` URL | RSS 2.0 or Atom. Up to 20 items (title, HTML-stripped summary, enclosure / media image). |
| `http` | public `https://` URL | JSON object/array, or text. 256 KB cap. |
| `file` | path under `$HOME` or `~/.zoto-viz` | JSON if it parses, otherwise `{text}`. |
| `journal` | optional user-unit name | `journalctl --user` (not the system journal). Optional `unit` filters to one user unit. |
| `kmsg` | none | Live `/dev/kmsg` when the process can open it; otherwise `journalctl -k`. First run (and older registries) seed `journal` and `kmsg` next to HN / NASA. |

Linux SYS graphs (not this registry) live on the 1 Hz snapshot as `views.memory`, `views.disk`, `views.gpu`, `views.sockets`, `views.cgroups`, `views.units`, `views.udev`, plus `views.bridge` (one schematic of those subsystems). CPU cores/load also carry `views.cpu.thermal` (package °C, RAPL/GPU watts when readable) so those views can tint cores and nudge sky brightness without a new menu row. **SYS Syscon** (`plugin:syscon`) is the 2×4 mosaic wall of those SYS graphs (it still wraps `views.bridge` as a catalog row).

Remote fetches reuse the agent-asset gate: HTTPS, port 443, public DNS, no private/loopback hosts. The browser never fetches source URLs.

## Defaults

A first run seeds **Hacker News** (`hn`, hnrss.org), **NASA image of the day** (`nasa`), **User journal** (`journal`), and **Kernel ring** (`kmsg`). Existing registries that predate those last two gain them on the next load. Disable or remove them in Settings → Sources.

## API / MCP

| Path / tool | Role |
| --- | --- |
| `GET /api/sources` | registry + last poll |
| `GET /api/sources/image?url=` | same-origin still proxy (CSP `img-src 'self'`) |
| `POST /api/sources` | upsert one |
| `PUT /api/sources` | replace the list |
| `PUT /api/sources/{id}` | upsert that id |
| `DELETE /api/sources/{id}` | remove |
| MCP `list_sources` / `set_source` / `delete_source` | same registry |

`set_settings` `{ feed: { includeSources } }` shows or hides headlines on the ticker. Source rows themselves are not a live UI patch — they persist on the server.

## Graph (`base: sources`)

The LAN snapshot is swapped for a synthetic graph:

| Node | Role | From |
| --- | --- | --- |
| `src:hub` | self | registry root |
| `src:feed:<id>` | gateway | one RSS / HTTP / file / journal / kmsg row |
| `src:item:…` | lan | RSS titles |
| `src:json:…` | internet | HTTP JSON string leaves |
| `src:line:…` | local | file lines |
| `src:item:…` | local / multicast | journal / kmsg titles |

This-view **kind** filters `all` / `rss` / `http` / `file` / `journal` / `kmsg`. Shipped wraps: **SRC Source web** (spheres + lines) and **SRC Source cloth** (`style.fabric: tubes` — nodes and edges are an animated mesh with the same hover / selection / edge-glow). Settings → Look → fabric turns the mesh on for any graph view. Sky packs can wrap the same base so they are not forced onto protocols/LAN.
