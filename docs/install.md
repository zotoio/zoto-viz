# Install

Python 3.12+, Node.js 22.12+, and `tshark`. Linux also needs `iproute2`. macOS uses Homebrew for Wireshark / ChmodBPF. Optional discovery tools are listed in the README.

If `nvm` is installed and `node -v` is still 18, `zoto-viz install` and `pnpm start` pick a 22.x from `~/.nvm` for that process. New terminals follow nvm’s default — pin them with `nvm alias default 22`. A Node 18 corepack cache looking for `pnpm.cjs` after a Node 22 prepare is repaired by re-running `corepack prepare pnpm@latest --activate` on Node 22.

The CLI is the repo-root script `zoto-viz` (`#!/usr/bin/env python3`, no `.py`). On Windows use `zoto-viz.cmd` from the checkout, or `python zoto-viz …`.

## Automated install

From the checkout:

```bash
# Linux / macOS
./zoto-viz install --dry-run    # prereq check + plan, no changes
./zoto-viz install              # apply local steps; ask before sudo/brew/winget
./zoto-viz install --yes        # also attempt OS packages / capture permissions (you accept the risk)
```

```bat
REM Windows (PowerShell or cmd), Python 3.12 already on PATH
python zoto-viz install --dry-run
python zoto-viz install
python zoto-viz install --yes
```

`install` always prints a prerequisite table. Missing tools get copy-pasteable manual commands (`apt` / `dnf` / `pacman` / `brew` / `winget`, or a download URL). System steps (package installs, `usermod -aG wireshark`, `brew install --cask wireshark-chmodbpf`) are skipped unless you pass `--yes` or type `y` at the risk prompt. `--no-system` never runs them.

### Bootstrap / doctor

For interactive, consent-gated fixes (GitHub CLI, `gh auth login`, capture
tools, venv, pnpm, screensaver backends):

```bash
./zoto-viz doctor              # report only
./zoto-viz doctor --fix        # offer to install missing items one-by-one
./zoto-viz bootstrap --dry-run # plan without changes
./zoto-viz bootstrap -y        # accept all install prompts (use after reading the plan)
```

Never silent-installs: each step asks unless `--yes` or non-interactive dry-run.
Private plugin catalog access needs `gh auth login` (device flow) when using
`auth: gh`. Packet capture needs `tshark` / Wireshark CLI.

Local steps (idempotent):

1. `.venv` + `pip install -r requirements.txt`
2. `corepack` → pnpm, then `web/` install + build, and `service/cursor-bridge/` `pnpm install` (Cursor SDK harness for pytest)
3. PATH shim (`~/.local/bin/zoto-viz` or `%LOCALAPPDATA%\zoto-viz\bin\zoto-viz.cmd`). On macOS the installer also appends that dir to `~/.zprofile` / `~/.zshrc`.
4. `~/.zoto-viz/sys-config.yml` (existing keys kept)
5. Linux: copy the systemd **user** unit and write the checkout override (not enabled)
6. macOS: write `~/Library/LaunchAgents/com.zoto-viz.monitor.plist` (not loaded)

Open a **new** terminal so PATH picks up the shim, then `zoto-viz --help`.

Wi-Fi hopper sudo lines are Linux-only and never run automatically.

## Manual fallback

Debian/Ubuntu:

```bash
sudo apt install tshark iw arp-scan fping nmap avahi-utils nbtscan bind9-dnsutils graphviz openssl
sudo usermod -aG wireshark $USER   # then log out and back in
```

macOS (Homebrew):

```bash
brew install python@3.12 node wireshark nmap graphviz arp-scan fping
brew install --cask wireshark-chmodbpf   # then log out so /dev/bpf* is readable
```

Then on any Unix:

```bash
git clone <this-repo> && cd zoto-viz
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
corepack enable && corepack prepare pnpm@latest --activate
cd web && pnpm install && pnpm build && cd ..
(cd service/cursor-bridge && pnpm install)
./zoto-viz --help
pnpm start            # backend :7020 + Vite :5173
# or: .venv/bin/python -m service.monitor  # http://127.0.0.1:7020
```

Windows (manual): install Python 3.12 (Add to PATH), Node.js 22 LTS, and Wireshark with Npcap. Then `python zoto-viz install --no-system`.

The monitor binds **127.0.0.1** by default. Set `bind` / `port` / `insecure_lan` in `~/.zoto-viz/sys-config.yml` (or pass `--bind` + `--insecure-lan`) to listen on a LAN address — no password; anyone who can reach the port can read captures and trigger scans.

**Screensaver / idle inhibit** is **on by default** for the live monitor so kiosk
displays stay awake. Disable with `--no-inhibit-screensaver`, `inhibit_screensaver: false`
in sys-config, or `ZOTO_VIZ_HEADLESS=1` / `ZOTO_VIZ_NO_SCREENSAVER_INHIBIT=1` for CI
and headless runs. Backends: Linux `systemd-inhibit` (+ optional `xdg-screensaver`
and `xset` on X11), macOS `caffeinate -dimsu`, Windows `SetThreadExecutionState`.
Do not expose the Ollama proxy on the LAN.

The monitor also serves a loopback MCP endpoint at `http://127.0.0.1:7020/mcp` for the live UI (theme, view, motion, physics, mosaic, plugins, dice), LAN state, RF watch, profiles, memories, plugin consent/draft, and contrib zip install. See [Plugins](/plugins). Installing a zip that ships `backend/` or `datasource/` reloads that Python in-process. Checkout `service/*.py` changes are picked up by restarting the monitor (Cursor stop hook, `pnpm restart:backend`, or `systemctl --user restart zoto-viz-monitor`). A running install also `git pull --ff-only`s the checkout every 5 minutes (`ZOTO_VIZ_PULL_S`, `ZOTO_VIZ_NO_AUTO_PULL=1` to skip). A fast-forward rebuilds `web/` when it changed, restarts the monitor, and hard-reloads the open UI. Dirty trees and missing remotes are left alone.

In-process plugin Python stays off until `ZOTO_VIZ_PLUGIN_SERVICE=1`. AI Control is a server flag (`~/.zoto-viz/ai-control` or `ZOTO_VIZ_AI_CONTROL`); the UI toggle writes that file.

## Plugin catalog

Shipped views are `plugins/src/<id>/` trees in this checkout. Contrib zips (`plugins/*.zip`, gitignored) unpack into gitignored `plugins/.runtime/<id>/`. Src trees load in place — no unpack step. You do not copy YAML into a home directory.

User data lives in `~/.zoto-viz/` (profiles, agent transcript/memories, `sys-config.yml`, `plugin-consent.yml`, local plugin zips under `plugins/local/`). System RF files live in `~/.config/zoto-viz/`. A one-time migrate copies `~/.z-netviz` if the new directory is missing.

On first monitor start after upgrade, unknown plugins still in the old user-dir trees are copied into `plugins/src/<id>/` and are live. They are not packed or committed. See [Plugins](/plugins).

## Repo root (`ZOTO_VIZ_REPO_ROOT`)

The catalog is located from the checkout, not from cwd:

1. `ZOTO_VIZ_REPO_ROOT` if set (expanded and resolved)
2. Walk parents of `service/paths.py` until `pyproject.toml` or `.git` is found
3. Else `RuntimeError` — never a silent fallback to `/plugins` or `~/plugins`

Under systemd the user unit must see the same pin. `zoto-viz install` (also the first monitor start via `sysconfig.ensure`) writes `~/.zoto-viz/sys-config.yml` if it is missing: checkout path, hostname, Wi-Fi interfaces, and watched SSIDs, detected from this machine. Existing keys are kept. That file stays local — do not commit it. The Air SSIDs plugin watch default is filled from it.

If the user systemd unit is already installed, `install` also writes `~/.config/systemd/user/zoto-viz-monitor.service.d/override.conf` with both `ZOTO_VIZ_ROOT` and `ZOTO_VIZ_REPO_ROOT` set to the resolved checkout. On macOS the same pin is written into `~/Library/LaunchAgents/com.zoto-viz.monitor.plist`. See [systemd](/systemd).
