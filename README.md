# zoto-viz

Discover every device on the home LAN, capture traffic, and render a live 3D graph.

- `service/` — capture + discovery daemon (`python -m service.monitor`) and Three.js UI (`http://127.0.0.1:7020`)
- `zoto-viz.py` — one-shot batch pipeline (pcap in, HTML/SVG out)
- Optional local **Gemma 4** agent via Ollama (insights, plugin drafts, gated AI Control)

Full documentation: [docs/](docs/) (VitePress). This README is the short path to a running monitor.

## Install

```bash
sudo apt install tshark arp-scan fping nmap avahi-utils nbtscan bind9-dnsutils graphviz openssl
sudo usermod -aG wireshark $USER      # log out and back in
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
corepack enable && corepack prepare pnpm@latest --activate
cd web && pnpm install && pnpm build && cd ..
./zoto-viz.py --help
pnpm start            # backend :7020 + Vite :5173  (pnpm stop / pnpm restart)
# or: .venv/bin/python -m service.monitor   # http://127.0.0.1:7020 only
```

`pnpm start:backend`, `pnpm start:frontend`, `pnpm stop:backend`, `pnpm restart:frontend` (and `:both`) target one side. Logs: `.run/backend.log`, `.run/frontend.log`.

User data: `~/.zoto-viz/` (migrated from `~/.z-netviz` if present). Loopback only; `--bind 0.0.0.0` needs `--insecure-lan`.

```bash
./zoto-viz.py plugin install   # ~/.zoto-viz/plugins + sys-config.yml (ifaces, SSIDs, checkout path)
```

```bash
cd web && pnpm test                  # Vitest
.venv/bin/pytest tests
cd docs && pnpm install && pnpm dev   # docs site
```

Optional agent: `ollama pull gemma4`. Optional hopper: see [docs/systemd.md](docs/systemd.md).
