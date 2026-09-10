# net-test

Discover every device on the home LAN, capture traffic, and render the device /
connection graph. One script (`netviz.py`) drives the standard Linux tools:

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

## Run

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
