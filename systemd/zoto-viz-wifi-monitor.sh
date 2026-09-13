#!/usr/bin/env bash
# Put a second Wi-Fi radio into monitor mode on the channel (and width) the primary Wi-Fi link is using, so the
# zoto-viz monitor hears every device on that access point rather than only this host's own traffic. Needs root.
#
#   sudo systemd/zoto-viz-wifi-monitor.sh <monitor-radio>              # follow the connected Wi-Fi's channel
#   sudo systemd/zoto-viz-wifi-monitor.sh <monitor-radio> <primary>    # name the primary radio explicitly
#   sudo systemd/zoto-viz-wifi-monitor.sh <monitor-radio> --hop        # …then rotate through the channel plan (below)
#   sudo systemd/zoto-viz-wifi-monitor.sh <monitor-radio> --off        # back to a normal, NetworkManager-managed radio
#
# Radio names live in ~/.zoto-viz/sys-config.yml (`iface`, `monitor_iface`), written by `./zoto-viz.py plugin install`.
#
# The monitor (python -m service.monitor) notices the interface appear within IFACE_RESCAN_S and restarts its capture with the
# radio included; WPA frames are decrypted with the passphrase in ~/.config/zoto-viz/wifi-keys (see README).
# A monitor radio hears one channel: the one the primary link is on. If the primary roams to another mesh point
# or the AP changes channel, re-run this (the systemd unit does so on restart).
#
# --hop keeps running: whenever ~/.config/zoto-viz/wifi-hop.plan exists (the Air SSIDs plugin's watch list, written
# by the monitor as `freq_MHz width_MHz centre_MHz dwell_s ssids` lines) the radio is tuned to each line in turn for
# its dwell, so every watched network is heard in rotation; a changed plan is picked up within a second, a removed
# plan puts the radio back on the primary's channel. The plan lives in the repository owner's home
# (override: ZOTO_VIZ_HOP_PLAN=/path). Only the numbers are used from it, and only in `iw … set freq`.
#
# A USB radio can drop off the bus and re-enumerate (a knock, a hub reset, a driver hiccup); it then comes back as
# a new device that NetworkManager would reclaim. So this also writes two persistent rules, removed by --off:
#   /etc/NetworkManager/conf.d/99-zoto-viz-<iface>.conf   NM never manages this radio (matched by MAC)
#   /etc/udev/rules.d/99-zoto-viz-<iface>.rules            (re)start the systemd unit whenever the radio appears
set -euo pipefail

MON=${1:?usage: $0 <monitor-iface> [<primary-iface>] [--hop|--off]}
shift
ARG2=""
HOP=0
for a in "$@"; do
  case $a in
    --off) ARG2=--off ;;
    --hop) HOP=1 ;;
    *)     ARG2=$a ;;
  esac
done
NM_CONF=/etc/NetworkManager/conf.d/99-zoto-viz-$MON.conf
UDEV_RULE=/etc/udev/rules.d/99-zoto-viz-$MON.rules
UNIT=zoto-viz-wifi-monitor@$MON.service
OWNER_HOME=$(getent passwd "$(stat -c %U "$0")" | cut -d: -f6)
PLAN=${ZOTO_VIZ_HOP_PLAN:-${Z_NETVIZ_HOP_PLAN:-${OWNER_HOME:-/root}/.config/zoto-viz/wifi-hop.plan}}

if [[ $EUID -ne 0 ]]; then echo "run as root (sudo)" >&2; exit 1; fi
for tool in iw ip nmcli; do
  command -v "$tool" >/dev/null || { echo "$tool is required (apt install $tool)" >&2; exit 1; }
done

if [[ $ARG2 == --off ]]; then
  rm -f "$NM_CONF" "$UDEV_RULE"
  nmcli general reload conf >/dev/null 2>&1 || true
  udevadm control --reload >/dev/null 2>&1 || true
  if [[ ! -e /sys/class/net/$MON ]]; then
    echo "$MON is gone (unplugged?); persistent rules removed"
    exit 0
  fi
  ip link set "$MON" down
  iw dev "$MON" set type managed
  nmcli device set "$MON" managed yes || true
  ip link set "$MON" up || true
  echo "$MON: managed mode, handed back to NetworkManager"
  exit 0
fi

[[ -e /sys/class/net/$MON ]] || { echo "no such interface: $MON" >&2; exit 1; }

# the primary: the connected Wi-Fi device that is not the monitor radio
PRI=$ARG2
if [[ -z $PRI ]]; then
  PRI=$(nmcli -t -f DEVICE,TYPE,STATE device status | awk -F: -v m="$MON" '$2=="wifi" && $3=="connected" && $1!=m {print $1; exit}')
fi
[[ -n $PRI ]] || { echo "no connected Wi-Fi to follow; pass the primary interface as the second argument" >&2; exit 1; }

# channel, width and centre frequency of the primary link
#   iw dev wlan0 info -> "channel 149 (5745 MHz), width: 80 MHz, center1: 5775 MHz"
primary_channel() {
  read -r FREQ WIDTH CENTER < <(iw dev "$PRI" info | awk '/channel/ {gsub(/[(),]/, ""); print $3, $6, $9}')
  CENTER=${CENTER:-${FREQ:-}}
  [[ -n ${FREQ:-} ]]
}
primary_channel || { echo "$PRI has no channel (not associated?)" >&2; exit 1; }

tune() {  # <freq MHz> <width MHz> <centre MHz>
  case ${2:-20} in
    40|80|160) iw dev "$MON" set freq "$1" "$2" "$3" ;;
    *)         iw dev "$MON" set freq "$1" ;;
  esac
}

MAC=$(cat "/sys/class/net/$MON/address")
printf '# zoto-viz: %s (%s) is a monitor-mode capture radio, not a network device\n[keyfile]\nunmanaged-devices=mac:%s\n' \
  "$MON" "$MAC" "$MAC" > "$NM_CONF"
nmcli general reload conf >/dev/null 2>&1 || true
if [[ -e /etc/systemd/system/zoto-viz-wifi-monitor@.service ]]; then  # the unit is installed: hot-plug restarts it
  # KERNEL match fires even when ATTR{address} is not yet in sysfs at ACTION==add (common on USB Wi-Fi).
  printf 'SUBSYSTEM=="net", ACTION=="add", KERNEL=="%s", TAG+="systemd", ENV{SYSTEMD_WANTS}+="%s"\nSUBSYSTEM=="net", ACTION=="add", ATTR{address}=="%s", TAG+="systemd", ENV{SYSTEMD_WANTS}+="%s"\n' \
    "$MON" "$UNIT" "$MAC" "$UNIT" > "$UDEV_RULE"
  udevadm control --reload >/dev/null 2>&1 || true
fi

nmcli device set "$MON" managed no 2>/dev/null || true
ip link set "$MON" down
iw dev "$MON" set type monitor
ip link set "$MON" up
tune "$FREQ" "${WIDTH:-20}" "$CENTER"
echo "$MON: monitor mode on $FREQ MHz, ${WIDTH:-20} MHz wide (centre $CENTER), following $PRI"
iw dev "$MON" info | sed 's/^/  /'
[[ $HOP == 1 ]] || exit 0

# --hop: cycle through the plan while it exists; sit on the primary's channel while it does not.
# The plan is re-read every slot, so a rewritten plan (a network appeared, the list changed) carries on from the
# slot after the current channel rather than starting the cycle over.
echo "$MON: hopping through $PLAN whenever it exists"
home=1
idx=0
cur=""
while true; do
  if [[ -s $PLAN ]]; then
    home=0
    stamp=$(stat -c %Y "$PLAN")
    mapfile -t slots < <(grep -E '^[0-9]+ [0-9]+ [0-9]+ [0-9]+( |$)' "$PLAN")
    n=${#slots[@]}
    if (( n == 0 )); then sleep 10; continue; fi  # nothing usable in the plan: do not spin
    if [[ -n $cur ]]; then  # continue after the channel we are on, wherever it sits in this plan
      for (( j = 0; j < n; j++ )); do
        [[ ${slots[j]} == "$cur "* ]] && { idx=$(( j + 1 )); break; }
      done
    fi
    read -r freq width centre dwell ssids <<< "${slots[idx % n]}"
    (( dwell >= 5 && dwell <= 3600 )) || dwell=60
    if tune "$freq" "$width" "$centre" 2>/dev/null || tune "$freq" 20 "$freq" 2>/dev/null; then
      echo "$MON: $freq MHz / $width MHz for ${dwell}s: ${ssids:-?}"
      cur=$freq
    else
      echo "$MON: cannot tune to $freq MHz, skipping" >&2
      cur=$freq
      idx=$(( idx + 1 ))
      sleep 1
      continue
    fi
    for (( i = 0; i < dwell; i++ )); do
      sleep 1
      # a rewritten or removed plan takes effect within a second
      [[ -s $PLAN && $(stat -c %Y "$PLAN") == "$stamp" ]] || break
    done
    idx=$(( idx + 1 ))
  else
    if [[ $home == 0 ]]; then
      if primary_channel && tune "$FREQ" "${WIDTH:-20}" "$CENTER"; then
        echo "$MON: no plan; back on the primary's $FREQ MHz"
      fi
      home=1
    fi
    sleep 10
  fi
done
