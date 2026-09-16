"""Bluetooth advertiser caps: unnamed BLE addresses must not flood the graph."""
from __future__ import annotations

from service import rf


def test_prune_drops_idle_unnamed_and_keeps_named_and_self() -> None:
    radio = rf.Radio()
    radio.set_bt_self("aa:aa:aa:aa:aa:aa", "this host")
    now = 1_000.0
    radio.bt_named("bb:bb:bb:bb:bb:bb", "Hue bulb")
    radio.bt_frame(now, 20, "bluetooth0", "cc:cc:cc:cc:cc:cc", "", "", "", "", "BTLE", "advertisement")
    radio.bts["bt:cc:cc:cc:cc:cc:cc"]["idle_s"] = rf.BT_UNNAMED_KEEP_S + 1
    radio.bts["bt:bb:bb:bb:bb:bb:bb"]["idle_s"] = rf.BT_UNNAMED_KEEP_S + 1
    radio.bts["bt:aa:aa:aa:aa:aa:aa"]["idle_s"] = rf.BT_UNNAMED_KEEP_S + 1
    radio._prune_bts(now)
    assert "bt:aa:aa:aa:aa:aa:aa" in radio.bts
    assert "bt:bb:bb:bb:bb:bb:bb" in radio.bts
    assert "bt:cc:cc:cc:cc:cc:cc" not in radio.bts


def test_views_caps_bluetooth_devices_and_keeps_self() -> None:
    radio = rf.Radio()
    radio.set_bt_self("aa:aa:aa:aa:aa:aa", "this host")
    now = 2_000.0
    for i in range(rf.BT_MAX_DEVICES + 20):
        addr = f"00:00:00:00:00:{i:02x}"
        radio.bt_frame(now + i, 12, "bluetooth0", addr, "", "", "", "", "BTLE", "advertisement")
    view = radio.views(now + 40)
    bt = view["bluetooth"]["devices"]
    assert len(bt) <= rf.BT_MAX_DEVICES
    assert any(d["role"] == "self" for d in bt)
    assert view["bluetooth"]["self"].startswith("bt:")
