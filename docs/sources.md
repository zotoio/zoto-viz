# Data sources

The monitor polls a host-level registry and publishes it on every 1 Hz snapshot as `sources`. Plugins can consume that map (`datasource.consumes: sources`). RSS titles, HTTP JSON leaves, and file lines can join the live feed ticker **and** become a graph (`visualisation.yml` `base: sources` — menu tag **SRC**, not NET).

Config: `~/.zoto-viz/sources.yml`. Local drop files: `~/.zoto-viz/sources/`.

## Kinds

| type | Input | Notes |
| --- | --- | --- |
| `rss` | public `https://` URL | RSS 2.0 or Atom. Up to 20 items (title + HTML-stripped summary). |
| `http` | public `https://` URL | JSON object/array, or text. 256 KB cap. |
| `file` | path under `$HOME` or `~/.zoto-viz` | JSON if it parses, otherwise `{text}`. |

Remote fetches reuse the agent-asset gate: HTTPS, port 443, public DNS, no private/loopback hosts. The browser never fetches source URLs.

## Defaults

A first run seeds **Hacker News** (`hn`, hnrss.org) and **NASA image of the day** (`nasa`). Disable or remove them in Settings → Sources.

## API / MCP

| Path / tool | Role |
| --- | --- |
| `GET /api/sources` | registry + last poll |
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
| `src:feed:<id>` | gateway | one RSS / HTTP / file row |
| `src:item:…` | lan | RSS titles |
| `src:json:…` | internet | HTTP JSON string leaves |
| `src:line:…` | local | file lines |

This-view **kind** filters `all` / `rss` / `http` / `file`. Shipped wraps: **SRC Source web** (spheres + lines) and **SRC Source cloth** (`style.fabric: tubes` — nodes and edges are an animated mesh with the same hover / selection / edge-glow). Settings → Look → fabric turns the mesh on for any graph view. Sky packs can wrap the same base so they are not forced onto protocols/LAN.
