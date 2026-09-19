import type { SourceLive } from "./sources";
import type { Device, Flow, Role } from "./types";

export const SRC_HUB = "src:hub";
export const SRC_MAX_NODES = 64;
export const SRC_MAX_NODES_CEILING = 120;
const SRC_MAX_PER_FEED = 16;

export type SourceGraphKind = "all" | "rss" | "http" | "file" | "journal" | "kmsg";

const KIND_ROLE: Record<string, Role> = {
  rss: "lan",
  http: "internet",
  file: "local",
  journal: "local",
  kmsg: "multicast",
};

function blankDevice(over: Partial<Device> & Pick<Device, "ip" | "role">): Device {
  return {
    mac: "",
    vendor: "",
    hostnames: [],
    names: [],
    sources: [],
    ports: [],
    ifaces: [],
    aliases: [],
    first_seen: 0,
    last_seen: 0,
    bytes_in: 0,
    bytes_out: 0,
    packets: 0,
    online: true,
    ...over,
  };
}

function flow(a: string, b: string, packets: number, proto: string): Flow {
  return {
    a, b, bytes: packets * 80, packets, ports: [], protos: [proto],
    ifaces: ["sources"], first_seen: 0, last_seen: 0, rate: packets, rate_ab: packets, rate_ba: 0,
  };
}

function wantKind(opts: Record<string, string>): SourceGraphKind {
  const k = (opts.kind ?? "all").toLowerCase();
  if (k === "rss" || k === "http" || k === "file" || k === "journal" || k === "kmsg") return k;
  return "all";
}

function capTop(opts: Record<string, string>): number {
  const n = Number(opts.top);
  if (!Number.isFinite(n)) return SRC_MAX_NODES;
  return Math.min(SRC_MAX_NODES_CEILING, Math.max(8, Math.trunc(n)));
}

/** Pull short display strings from a JSON value (object keys, string leaves, array rows). */
export function jsonLeaves(value: unknown, cap: number, path = ""): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, p: string, depth: number): void => {
    if (out.length >= cap || depth > 6) return;
    if (v == null) return;
    if (typeof v === "string") {
      const text = v.trim();
      if (text.length >= 2) out.push({ path: p || "value", text: text.slice(0, 120) });
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out.push({ path: p || "value", text: String(v) });
      return;
    }
    if (Array.isArray(v)) {
      v.slice(0, 12).forEach((item, i) => walk(item, p ? `${p}[${i}]` : `[${i}]`, depth + 1));
      return;
    }
    if (typeof v === "object") {
      const rec = v as Record<string, unknown>;
      const preferred = ["title", "name", "label", "headline", "text", "id"];
      for (const key of preferred) {
        if (typeof rec[key] === "string") walk(rec[key], p ? `${p}.${key}` : key, depth + 1);
      }
      for (const [key, child] of Object.entries(rec)) {
        if (preferred.includes(key)) continue;
        walk(child, p ? `${p}.${key}` : key, depth + 1);
        if (out.length >= cap) return;
      }
    }
  };
  walk(value, path, 0);
  return out;
}

function fileLines(text: string, cap: number): string[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, cap);
}

function childrenOf(live: SourceLive, cap: number): { id: string; text: string }[] {
  const kind = (live.kind || "").toLowerCase();
  if (kind === "http" && live.json !== undefined) {
    return jsonLeaves(live.json, cap).map((row, i) => ({
      id: `src:json:${live.id}:${i}`,
      text: row.text,
    }));
  }
  if (live.items?.length) {
    return live.items.slice(0, cap).map((item, i) => ({
      id: `src:item:${live.id}:${i}`,
      text: (item.title || item.summary || item.link || "").trim().slice(0, 120),
    })).filter((row) => row.text);
  }
  if (live.text) {
    return fileLines(live.text, cap).map((text, i) => ({
      id: `src:line:${live.id}:${i}`,
      text: text.slice(0, 120),
    }));
  }
  return [];
}

/**
 * Build a LAN-shaped slice from the host sources registry so the graph engine
 * can layout RSS / HTTP / file data the same way it layouts devices.
 */
export function sourcesSlice(
  sources: Record<string, SourceLive> | undefined,
  opts: Record<string, string> = {},
): { devices: Device[]; flows: Flow[]; gateway: string; localIp: string } {
  const kind = wantKind(opts);
  const top = capTop(opts);
  const now = Date.now() / 1000;
  const devices: Device[] = [];
  const flows: Flow[] = [];

  const hub = blankDevice({
    ip: SRC_HUB,
    role: "self",
    names: ["Sources"],
    hostnames: ["sources"],
    vendor: "hub",
    ports: ["src"],
    online: true,
    last_seen: now,
    packets: 1,
  });
  devices.push(hub);

  const feeds = Object.values(sources ?? {}).filter((live) => {
    if (!live) return false;
    if (kind !== "all" && (live.kind || "").toLowerCase() !== kind) return false;
    return true;
  });

  let childBudget = Math.max(0, top - 1 - feeds.length);
  for (const live of feeds) {
    const k = (live.kind || "rss").toLowerCase();
    const feedId = `src:feed:${live.id}`;
    const ok = live.ok !== false && !live.paused;
    devices.push(blankDevice({
      ip: feedId,
      role: "gateway",
      names: [live.label || live.id],
      hostnames: [live.id],
      vendor: k,
      sources: [live.id],
      ports: [k],
      online: ok,
      last_seen: live.ts ?? now,
      packets: (live.items?.length ?? 0) + (live.text ? 1 : 0),
      bytes_out: (live.items?.length ?? 0) * 40,
    }));
    flows.push(flow(SRC_HUB, feedId, ok ? 4 : 1, k));

    if (!ok) continue;
    const take = Math.min(SRC_MAX_PER_FEED, Math.max(0, childBudget));
    const kids = childrenOf(live, take);
    childBudget -= kids.length;
    const childRole = KIND_ROLE[k] ?? "lan";
    for (const kid of kids) {
      devices.push(blankDevice({
        ip: kid.id,
        role: childRole,
        names: [kid.text],
        hostnames: [live.label || live.id],
        vendor: k,
        sources: [live.id],
        ports: [k],
        online: true,
        last_seen: live.ts ?? now,
        packets: 1 + Math.min(20, kid.text.length / 8),
        bytes_in: kid.text.length,
      }));
      flows.push(flow(feedId, kid.id, 2, k));
    }
  }

  return { devices, flows, gateway: SRC_HUB, localIp: SRC_HUB };
}
