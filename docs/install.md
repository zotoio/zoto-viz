# Install

## Requirements

Linux (`iproute2`), Python 3.12+, `tshark`, Node.js 22.12+ and pnpm. See the repo README table for optional discovery tools.

```bash
sudo apt install tshark arp-scan fping nmap avahi-utils nbtscan bind9-dnsutils graphviz openssl
sudo usermod -aG wireshark $USER   # then log out and back in
git clone <this-repo> && cd zoto-viz
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
corepack enable && corepack prepare pnpm@latest --activate
cd web && pnpm install && pnpm build && cd ..
./zoto-viz.py --help
pnpm start            # backend :7020 + Vite :5173
# or: .venv/bin/python -m service.monitor  # http://127.0.0.1:7020
```

The monitor binds **127.0.0.1** by default. Non-loopback bind is refused unless you pass `--insecure-lan` (no password; anyone who can reach the port can read captures and trigger scans). Do not expose the Ollama proxy on the LAN.

The monitor also serves a loopback MCP endpoint at `http://127.0.0.1:7020/mcp` for installing agent-plugin zips. See `docs/plugins.md`.

In-process plugin Python stays off until `ZOTO_VIZ_PLUGIN_SERVICE=1`. AI Control is a server flag (`~/.zoto-viz/ai-control` or `ZOTO_VIZ_AI_CONTROL`); the UI toggle writes that file.

User data lives in `~/.zoto-viz/` (plugins, profiles, agent transcript/memories, `sys-config.yml`). System RF files live in `~/.config/zoto-viz/`. A one-time migrate copies `~/.z-netviz` if the new directory is missing.

`./zoto-viz.py plugin install` (also the first monitor start) writes `~/.zoto-viz/sys-config.yml` if it is missing: checkout path, hostname, Wi-Fi interfaces, and watched SSIDs, detected from this machine. Existing keys are kept. That file stays local — do not commit it. The Air SSIDs plugin watch default is filled from it. If the user systemd unit is already installed, install also writes `~/.config/systemd/user/zoto-viz-monitor.service.d/override.conf` with `ZOTO_VIZ_ROOT`.
