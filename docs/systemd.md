# systemd and Wi-Fi hopper

User unit: `systemd/zoto-viz-monitor.service`

```bash
mkdir -p ~/.config/systemd/user
cp systemd/zoto-viz-monitor.service ~/.config/systemd/user/
./zoto-viz.py plugin install   # sys-config.yml + override.conf (ZOTO_VIZ_ROOT)
systemctl --user daemon-reload
systemctl --user enable --now zoto-viz-monitor
```

The unit’s `ZOTO_VIZ_ROOT=%h/zoto-viz` is a placeholder. Install writes the drop-in from the detected checkout.

Wi-Fi hopper (root, second radio). The radio name is `monitor_iface` in `~/.zoto-viz/sys-config.yml`:

```bash
sudo install -D systemd/zoto-viz-wifi-monitor.sh /usr/local/sbin/zoto-viz-wifi-monitor
sudo cp systemd/zoto-viz-wifi-monitor@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zoto-viz-wifi-monitor@<monitor-radio>
```

Passphrases: `~/.config/zoto-viz/wifi-keys`. Channel plan: `~/.config/zoto-viz/wifi-hop.plan`. Override path: `ZOTO_VIZ_HOP_PLAN` (legacy `Z_NETVIZ_HOP_PLAN` still works).
