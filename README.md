# net-test

Discover every device on the home LAN, capture traffic, and render the device /
connection graph. Two entry points:

- `monitor.py`: constant capture + discovery daemon with a live Three.js UI
- `netviz.py`: one-shot batch pipeline (pcap in, HTML/SVG graph out)

## Live monitor (`monitor.py` + `web/`)

```bash
cd web && pnpm install && pnpm build && cd ..     # builds web/dist once
./monitor.py                                      # http://127.0.0.1:8765
```

What runs: a continuous `tshark -T fields` stream on every up interface
(except `lo` and `veth*`, whose traffic is already on the bridge) feeding an
in-memory model of devices, flows and names, each tagged with the interface it
was seen on; the interface set is rechecked every 15 s and the capture restarts
when one appears or disappears (Docker bridges, VPN tunnels). A discovery pass
runs every 60 s (`ip neigh`, mDNS, NetBIOS, OUI vendors); unnamed TLS peers get
certificate probes; a 1 Hz WebSocket snapshot goes to every browser tab; state
is persisted to `data/monitor-state.json` every 30 s.

The UI is a force-directed 3D graph: gateway at the centre, this host and
`local` devices (Docker containers, VMs, tunnel peers on secondary subnets)
close in, LAN devices on a ring, internet endpoints on an outer sphere,
multicast groups in between.
Traffic shows as particles along edges, edge brightness follows bytes/s, node
size follows total bytes. Hover for a label, click for the detail panel
(MAC, vendor, names, open ports, top conversations, click-through). Filters in
the header hide internet / multicast / offline nodes and labels. Escape
deselects. IPv6 addresses are folded onto the IPv4 device with the same MAC
(via the frame or the SLAAC EUI-64), so one box is one node.

`redact` (or key `R`) partially masks identifiers for screenshots and
screen-sharing: private IPv4 hides the subnet octet (`192.168.xx.73`), public
IPv4 the last two, IPv6 keeps two groups, MACs keep the OUI, public names keep
the registrable domain (`….cursor.sh`), local device names keep three
characters (`And….local`). Rules live in `web/src/redact.ts`.

### View modes

The `view` selector (or keys `1`–`6`) switches how the same live graph is
drawn; each mode has its own options next to the selector and its own legend.
Choices persist in the browser.

| # | Mode | What it shows | Options |
| - | ---- | ------------- | ------- |
| 1 | Topology | Default: shells by role, LAN edges blue, internet edges purple, brightness = rate. | |
| 2 | Top talkers | Sphere size = share of total volume (or of current rate), colour = heat of the current rate, labels with rate/total on the top N. | rank by, label top N |
| 3 | Services | Internet hosts pulled into clusters by organisation (registrable domain of their TLS/rDNS name, CDN families folded); a tag per cluster gives host count, volume, rate. | arrange by, pool singletons |
| 4 | Protocols | Edges coloured by protocol family derived from ports (TLS, QUIC, DNS, plaintext, discovery, remote, mail, NTP, media); devices take the family that moved most of their bytes. Focus one family to dim the rest. | focus |
| 5 | Layers | Sankey-style layered view: internet on top, gateway, LAN, then containers/tunnels, ordered by volume; edges fade between the role colours, brightness = volume. | order by |
| 6 | Watch | Everything grey except: devices that appeared after monitoring began (orange), plaintext protocols (red edges), LAN devices talking to the internet directly (amber). | new-within window, LAN→internet |

Modes are plug-ins in `web/src/modes.ts`: a `ViewMode` answers optional hooks
for node colour/size/label, edge colour/brightness, layout forces, overlays and
camera; the scene falls back to Topology for anything a mode leaves undefined.

Options: `--iface X` (repeatable, restrict capture to named interfaces),
`--bind 0.0.0.0` (LAN access), `--port`, `-f '<bpf>'` (capture filter),
`--fresh` (ignore persisted state). JSON snapshot at
`/api/state`. Frontend dev loop: `cd web && pnpm dev` (proxies to :8765).

Run it permanently as a user service: see `systemd/netviz-monitor.service`.

## Batch pipeline (`netviz.py`)

One script drives the standard Linux tools:

| Stage | Tools | Output |
| --- | --- | --- |
| `discover` | `arp-scan`, `fping`, `nmap -sn`, `avahi-browse`, `nbtscan` | `data/devices.json` |
| `capture` | `dumpcap` (Wireshark) | `data/capture-<ts>.pcapng` |
| `analyse` | `tshark -z conv,*`, `-z io,phs`, DNS/DHCP/NBNS field extraction | `data/flows-<ts>.json` |
| `graph` | `networkx`, `pyvis`, `graphviz` | `out/network.html`, `out/network.svg` |

## Setup

```bash
sudo apt install arp-scan fping avahi-utils nbtscan tshark iftop nethogs ngrep graphviz nmap
sudo usermod -aG wireshark $USER      # log out/in afterwards for root-less capture
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

## Run the batch pipeline

```bash
source .venv/bin/activate
./netviz.py all -s 300               # 5-minute capture, everything in one go
xdg-open out/network.html
```

Or stage by stage:

```bash
./netviz.py discover --ports         # sudo prompt: arp-scan and nmap need raw sockets
./netviz.py capture -s 600 -f 'not port 22'
./netviz.py analyse                  # newest pcap in data/
./netviz.py graph --lan-only         # hide internet endpoints
```

## Reading the graph

- blue star: this machine; orange diamond: gateway; green dots: LAN devices;
  purple squares: internet endpoints; grey triangles: broadcast / multicast groups
- edge width scales with bytes; hover for byte / frame counts and service ports
- dashed edges mean "discovered, but no traffic seen from here": drawn to the
  gateway so the topology reads as a star

## Limits of capturing from a Wi-Fi client

On Wi-Fi (and switched Ethernet) this laptop only sees its own unicast traffic
plus broadcast / multicast (ARP, mDNS, SSDP, DHCP, NBNS). Other devices'
conversations with the internet are invisible from here. To get the full picture,
pick one:

1. Mirror / tap at the router (best; some routers or a managed switch can do it)
2. Run the capture on the router itself (OpenWrt: `tcpdump -w`, then `analyse` here)
3. Wi-Fi monitor mode (`iw dev wlp59s0 set type monitor`); WPA traffic stays
   encrypted per client, so only management frames and device presence are useful
4. ARP spoofing (`bettercap`), intrusive and noisy: not installed, not recommended
   on a shared home network

Also disconnect Cloudflare WARP before capturing (`warp-cli disconnect`); while it
is up, this host's traffic is one encrypted tunnel to Cloudflare.

## Live tools (no script needed)

```bash
sudo iftop -i wlp59s0 -n            # live per-host bandwidth
sudo nethogs wlp59s0                # per-process bandwidth
sudo tshark -i wlp59s0 -Y 'mdns || ssdp || dhcp' -T fields -e ip.src -e _ws.col.Info
```
