# Data sources

The monitor polls a host-level registry and publishes it on every 1 Hz snapshot as `sources`. Plugins can consume that map (`datasource.consumes: sources`). RSS titles, HTTP JSON leaves, file lines, user-journal records, and kernel-ring lines can join the live feed ticker **and** become a graph (`visualisation.yml` `base: sources` — menu tag **SRC**, not NET). Linux host metrics that are not a ticker (memory/PSI, disk I/O, GPU, sockets, cgroups, systemd user units, udev) are first-class `views.*` graphs with menu tag **SYS**.

Google Nest cameras are not this registry — they use Device Access OAuth + Pub/Sub + WebRTC. See [SDM](/sdm).

Config: `~/.zoto-viz/sources.yml`. Local drop files: `~/.zoto-viz/sources/`.

## Kinds

| type | Input | Notes |
| --- | --- | --- |
| `rss` | public `https://` URL | RSS 2.0 or Atom. Up to 80 items (title, HTML-stripped summary, enclosure / media image). |
| `http` | public `https://` URL | JSON object/array, or text. 256 KB cap. Optional `fields` map (list / title / caption / image / link / filter / expand) projects JSON onto RSS-shaped `items[]`. |
| `file` | path under `$HOME` or `~/.zoto-viz` | JSON if it parses, otherwise `{text}`. |
| `journal` | optional user-unit name | `journalctl --user` (not the system journal). Optional `unit` filters to one user unit. |
| `kmsg` | none | Live `/dev/kmsg` when the process can open it; otherwise `journalctl -k`. First run (and older registries) seed `journal` and `kmsg` next to HN / NASA. |

Linux SYS graphs (not this registry) live on the 1 Hz snapshot as `views.memory`, `views.disk`, `views.gpu`, `views.sockets`, `views.cgroups`, `views.units`, `views.udev`, plus `views.bridge` (one schematic of those subsystems). CPU cores/load also carry `views.cpu.thermal` (package °C, RAPL/GPU watts when readable) so those views can tint cores and nudge sky brightness without a new menu row. **SYS Syscon** (`plugin:syscon`) is the 2×4 mosaic wall of those SYS graphs (it still wraps `views.bridge` as a catalog row). **NET Cypher CIC** (`plugin:cypher-cic`) is the neon center-hero wall: topology on a holodeck infograph of host gauges, talkers, protocols, and RF, flanked by talkers / protocols / watch / cores / memory / sockets / GPU.

Remote fetches reuse the agent-asset gate: HTTPS, port 443, public DNS, no private/loopback hosts. The browser never fetches source URLs.

## Defaults

A first run seeds **Hacker News** (`hn`), **NASA image of the day** (`nasa`), **APOD** (`apod`, [NASA DEMO_KEY](https://api.nasa.gov/), last eight days — not the random `count=` archive draw), **Earth Observatory** (`earth-iotd`), **Commons picture of the day** (`commons-potd`), **Met highlights** (`met`, object-id expand), **Lobsters** (`lobsters`), **Guardian world** (`guardian`, public world RSS; a leftover `api-key=test` Open Platform URL rewrites once), **Mastodon #space** (`mastodon`), **User journal** (`journal`), and **Kernel ring** (`kmsg`). Existing registries gain the new content rows (and journal / kmsg) on the next load; stale shipped Guardian / APOD URLs rewrite once. Disable them in Settings → Sources rather than deleting if you do not want them re-seeded.

Views that still need a key or OAuth stay out of **dice** until they work: **Nest cams** ([Device Access](https://developers.google.com/nest/device-access), [console](https://console.nest.google.com/device-access)) and any view bound to Guardian while `api-key=test`. Settings → Sources shows the signup links on those rows.

HTTP JSON field maps live on the source row. Example APOD: `title`, `explanation` → caption, `hdurl` / `url` → image, `media_type=image` filter. Met uses `list: objectIDs` plus `expand: https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}`.

Views do not fork a plugin per feed. **Carousel**, **HN Rain**, and **HN Term** are engines; Settings → This view picks `source` and field names. Shipped instances add extra VIEW rows (`plugin:carousel:apod`, `plugin:hn-rain:lobsters`, …). Operator extras: `~/.zoto-viz/plugin-instances.yml` or Settings → Sources → View instances. HN Rain Composer stills save as SVG under `~/.zoto-viz/images` (slug + hash), not the git checkout.

## API / MCP

| Path / tool | Role |
| --- | --- |
| `GET /api/sources` | registry + last poll |
| `GET /api/sources/image?url=` | same-origin still proxy (CSP `img-src 'self'`) |
| `POST /api/sources` | upsert one |
| `PUT /api/sources` | replace the list |
| `PUT /api/sources/{id}` | upsert that id |
| `DELETE /api/sources/{id}` | remove |
| `GET/POST/PUT /api/plugin-instances` | operator view instances (`~/.zoto-viz/plugin-instances.yml`) |
| `PUT/DELETE /api/plugin-instances/{plugin}/{id}` | upsert or remove one instance |
| MCP `list_sources` / `set_source` / `delete_source` | same registry |
| MCP `list_plugin_instances` / `set_plugin_instance` / `delete_plugin_instance` | view instances |

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
