# zoto-viz

Discover every device on the home LAN, capture traffic, and render a live 3D graph.

- `service/` — capture + discovery daemon (`python -m service.monitor`) and Three.js UI (`http://127.0.0.1:7020`)
- `zoto-viz` — CLI (batch pipeline, plugin catalog, install). Shebang `#!/usr/bin/env python3`; Windows wrapper `zoto-viz.cmd`
- Optional local **Gemma 4** agent via Ollama (insights, plugin drafts, gated AI Control)

Full documentation: [docs/](docs/) (VitePress). This README is the short path to a running monitor.

## Install

Python 3.12+ must already be on PATH. Then:

```bash
git clone <this-repo> && cd zoto-viz
./zoto-viz install --dry-run    # prereqs + plan
./zoto-viz install              # venv, web build, PATH shim; asks before sudo/brew
# Windows: python zoto-viz install --dry-run
```

`--yes` attempts OS packages and capture permissions (you accept that risk). `--no-system` never does. Open a new terminal afterwards so `zoto-viz` is on PATH.

Manual equivalent (Debian/Ubuntu):

```bash
sudo apt install tshark arp-scan fping nmap avahi-utils nbtscan bind9-dnsutils graphviz openssl
sudo usermod -aG wireshark $USER      # log out and back in
```

macOS:

```bash
brew install python@3.12 node wireshark nmap graphviz arp-scan fping
brew install --cask wireshark-chmodbpf   # log out afterwards
```

Then:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
corepack enable && corepack prepare pnpm@latest --activate
cd web && pnpm install && pnpm build && cd ..
./zoto-viz --help
pnpm start            # backend :7020 + Vite :5173  (pnpm stop / pnpm restart)
# or: .venv/bin/python -m service.monitor   # http://127.0.0.1:7020 only
```

`pnpm start:backend`, `pnpm start:frontend`, `pnpm stop:backend`, `pnpm restart:frontend` (and `:both`) target one side. Logs: `.run/backend.log`, `.run/frontend.log`. A Cursor stop hook restarts the backend when `service/*.py` is newer than the running monitor.

User data: `~/.zoto-viz/` (migrated from `~/.z-netviz` if present). Loopback only; `--bind 0.0.0.0` needs `--insecure-lan`.

```bash
zoto-viz install          # also writes sys-config.yml + systemd override (ZOTO_VIZ_REPO_ROOT)
# Shipped catalog: plugins/src/<id>/. Contrib zips: gitignored plugins/*.zip. Local inventions: ~/.zoto-viz/plugins/local/*.zip. MCP: POST http://127.0.0.1:7020/mcp  (settings, plugins, agent, publish_local_plugin, install_plugin_zip) — see docs/plugins.md
```

```bash
cd web && pnpm test                  # Vitest
.venv/bin/pytest tests
cd docs && pnpm install && pnpm dev   # docs site
```

Optional agent: `ollama pull gemma4`. Optional hopper: see [docs/systemd.md](docs/systemd.md).
