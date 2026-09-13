import { displayName, isWeakHostName, type Device, type Flow, type StateMsg, usefulAlias } from "./types";

/**
 * "merge names": collapse internet hosts that share a hostname (the twenty addresses behind one CDN name)
 * into one node whose `members` lists every address. LAN devices are not merged here — factory mDNS names
 * like Android.local are shared by many boxes, and Wi-Fi+Ethernet of one host is already folded by MAC server-side.
 * Flows are re-pointed at the representative address; conversations between members disappear.
 * The map returned translates any raw address to its representative so peer lists from the server still resolve.
 */
export function collapseByName(msg: StateMsg): { msg: StateMsg; map: Map<string, string> } {
  const groups = new Map<string, Device[]>();
  for (const d of msg.devices) {
    const name = displayName(d);
    // LAN boxes often share factory mDNS names (Android.local, Nest-Cam-indoor). Merging those makes one
    // label jump between IPs as traffic shifts. Same-host Wi-Fi+Ethernet is already folded server-side by MAC.
    // Internet CDN names (api.example.com on twenty addresses) still collapse.
    const merge = d.role === "internet" && name !== d.ip && !isWeakHostName(name);
    const key = merge ? `internet|${name.toLowerCase()}` : `ip|${d.ip}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(d);
  }
  const map = new Map<string, string>();
  const devices: Device[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { devices.push(g[0]); continue; }
    // the representative is the busiest online member, so selection, analysis and colours follow the live one
    g.sort((a, b) => Number(b.online) - Number(a.online) || (b.bytes_in + b.bytes_out) - (a.bytes_in + a.bytes_out));
    const rep = g[0];
    const others = g.slice(1);
    for (const d of others) map.set(d.ip, rep.ip);
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    devices.push({
      ...rep,
      hostnames: uniq(g.flatMap((d) => d.hostnames ?? [])),
      names: uniq(g.flatMap((d) => d.names ?? [])),
      sources: uniq(g.flatMap((d) => d.sources ?? [])),
      ports: uniq(g.flatMap((d) => d.ports ?? [])),
      ifaces: uniq(g.flatMap((d) => d.ifaces ?? [])),
      aliases: uniq([...(rep.aliases ?? []), ...others.flatMap((d) => [d.ip, ...(d.aliases ?? [])])].filter(usefulAlias)),
      vendor: rep.vendor || others.find((d) => d.vendor)?.vendor || "",
      mac: rep.mac || others.find((d) => d.mac)?.mac || "",
      first_seen: Math.min(...g.map((d) => d.first_seen || Infinity)),
      last_seen: Math.max(...g.map((d) => d.last_seen || 0)),
      bytes_in: g.reduce((s, d) => s + d.bytes_in, 0),
      bytes_out: g.reduce((s, d) => s + d.bytes_out, 0),
      packets: g.reduce((s, d) => s + d.packets, 0),
      online: g.some((d) => d.online),
      members: g.map((d) => d.ip),
    });
  }
  if (map.size === 0) return { msg, map };

  const rep = (ip: string) => map.get(ip) ?? ip;
  const flows = new Map<string, Flow>();
  for (const f of msg.flows) {
    const a = rep(f.a), b = rep(f.b);
    if (a === b) continue;
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    const cur = flows.get(key);
    if (!cur) { flows.set(key, { ...f, a: x, b: y, ports: [...f.ports], protos: [...f.protos], ifaces: [...(f.ifaces ?? [])] }); continue; }
    cur.bytes += f.bytes;
    cur.packets += f.packets;
    cur.rate += f.rate;
    cur.first_seen = Math.min(cur.first_seen, f.first_seen);
    cur.last_seen = Math.max(cur.last_seen, f.last_seen);
    const seenPorts = new Set(cur.ports);
    for (const p of f.ports) {
      if (seenPorts.size >= 12) break;
      if (seenPorts.has(p)) continue;
      seenPorts.add(p);
      cur.ports.push(p);
    }
    const seenProtos = new Set(cur.protos);
    for (const p of f.protos) {
      if (seenProtos.has(p)) continue;
      seenProtos.add(p);
      cur.protos.push(p);
    }
    const seenIfaces = new Set(cur.ifaces);
    for (const i of f.ifaces ?? []) {
      if (seenIfaces.has(i)) continue;
      seenIfaces.add(i);
      cur.ifaces.push(i);
    }
  }
  return { msg: { ...msg, devices, flows: [...flows.values()] }, map };
}
