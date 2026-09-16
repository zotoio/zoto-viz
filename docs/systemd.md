# systemd and Wi-Fi hopper

User unit: `systemd/zoto-viz-monitor.service`

```bash
mkdir -p ~/.config/systemd/user
cp systemd/zoto-viz-monitor.service ~/.config/systemd/user/
./zoto-viz install          # sys-config.yml + override.conf (ZOTO_VIZ_ROOT + ZOTO_VIZ_REPO_ROOT)
systemctl --user daemon-reload
systemctl --user enable --now zoto-viz-monitor
```

The unit’s `ZOTO_VIZ_ROOT=%h/zoto-viz` is a placeholder. Install writes the drop-in from the detected checkout (`Environment=ZOTO_VIZ_ROOT` and `Environment=ZOTO_VIZ_REPO_ROOT`). See [Install](/install) for catalog detection order. A Cursor stop hook restarts this unit when checkout `service/*.py` is newer than the process (`ZOTO_VIZ_NO_AUTO_RESTART=1` disables it).

Wi-Fi hopper (root, second radio). The radio name is `monitor_iface` in `~/.zoto-viz/sys-config.yml`. `./zoto-viz install` prints the sudo lines; a USB `wlx*` stick stays DOWN until that unit is enabled:

```bash
sudo install -D systemd/zoto-viz-wifi-monitor.sh /usr/local/sbin/zoto-viz-wifi-monitor
sudo cp systemd/zoto-viz-wifi-monitor@.service /etc/systemd/system/
sudo install -D -m 644 /dev/stdin /etc/zoto-viz/hopper.env <<EOF
ZOTO_VIZ_HOP_PLAN=$HOME/.config/zoto-viz/wifi-hop.plan
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now zoto-viz-wifi-monitor@<monitor-radio>
```

Passphrases: `~/.config/zoto-viz/wifi-keys`. Channel plan: `~/.config/zoto-viz/wifi-hop.plan`. The hopper env file points the root unit at that plan (an installed script is owned by root and would otherwise look in `/root`). Override path: `ZOTO_VIZ_HOP_PLAN` (legacy `Z_NETVIZ_HOP_PLAN` still works).
