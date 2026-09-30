import type { Packet, TrafficMsg } from "../core/types";
import type { IdleVizDemoHost } from "../plugins/fixtures/idle-viz-frame";
import type { ArcadeIdleShapeCtx, ArcadeIdleShaper } from "./arcade-idle-feed";

/**
 * #181: the per-engine demo shapers of the arcade idle feed. Each returns rows of its engine's own packet row type
 * (the tuple the engine's `ingest` parses) and is fed only through that `ingest`, so a parser change breaks tsc or
 * turns an `arcade-idle-*` row red. Every endpoint and name comes from `ctx.hosts` (IDLE_VIZ_DEMO_HOSTS): no host
 * is written here. A single-device pick (`ctx.me`) is never written into a row either: the engines use the pick
 * itself for that end, so the rows carry only the demo peers.
 */

/** Frogger parses `/api/traffic` rows: `[t, dir, peer, proto, tag, size, iface, info, ports, member]`. */
export type FroggerRow = Packet;
/** Invaders parses the same rows (peer role, direction, size, member). */
export type InvadersRow = Packet;
/** NetPong parses the rows of a `TrafficMsg` (it takes the whole message). */
export type PongRow = TrafficMsg["packets"][number];

const IFACE = "demo";

interface Link { dev: IdleVizDemoHost; dst: IdleVizDemoHost }

function linksOf(hosts: readonly IdleVizDemoHost[]): Link[] {
  const by = new Map(hosts.map((h) => [h.ip, h] as const));
  return hosts.flatMap((h) => h.opens.flatMap((d) => (by.has(d) ? [{ dev: h, dst: by.get(d)! }] : [])));
}

const eph = (r: () => number): number => 49152 + Math.floor(r() * 16000);
const between = (r: () => number, lo: number, hi: number): number => Math.round(lo + r() * (hi - lo));
const hex = (n: number): string => `0x${n.toString(16).padStart(4, "0")}`;

// ------------------------------------------------------------------ frogger

/** An exchange spans three steps (one per poll): DNS + SYN, SYN-ACK + Client Hello, Server Hello + data. */
const FROG_STAGES = 3;

/**
 * One connection per step along the demo links (a different link each step, in list order), each walked through
 * the frogger lanes over three polls. Seeded fates: most reach home, some are refused (RST) or stall before the
 * Server Hello, so the log and the per-lane counts have something to say.
 */
export const shapeFroggerIdle: ArcadeIdleShaper<FroggerRow> = (ctx: ArcadeIdleShapeCtx) => {
  const all = linksOf(ctx.hosts);
  // one device picked: the engine is that device's; one link per destination so two exchanges never share a key
  const links = ctx.me ? all.filter((l, i) => all.findIndex((x) => x.dst.ip === l.dst.ip) === i) : all;
  if (links.length < FROG_STAGES) return [];
  const gateway = ctx.hosts.find((h) => h.role === "gateway");
  const rows: FroggerRow[] = [];
  for (let k = 0; k < FROG_STAGES; k++) {
    const ex = ctx.step - k;
    if (ex < 0) continue;
    const { dev, dst } = links[ex % links.length];
    const r = ctx.rng(ex);
    const fate = r();
    const member = ctx.me ? undefined : dev.ip;
    const port = eph(r), qid = Math.floor(r() * 0xffff);
    const t = ctx.t0 + (ex % links.length) * 0.07;
    const row = (dt: number, dir: "in" | "out", peer: string, proto: string, tag: string, size: number, info: string, ports: string): FroggerRow =>
      member ? [t + dt, dir, peer, proto, tag, size, IFACE, info, ports, member] : [t + dt, dir, peer, proto, tag, size, IFACE, info, ports];
    const out = `${port}→443`, back = `443→${port}`;
    if (k === 0) {
      // the resolver: the gateway for the LAN, a demo internet resolver for the gateway itself
      const resolver = gateway && gateway.ip !== dev.ip ? gateway : ctx.hosts.find((h) => h.role === "internet" && h.ip !== dst.ip) ?? ctx.hosts.find((h) => h.role === "internet");
      if (resolver) {
        rows.push(row(0.02, "out", resolver.ip, "DNS", "udp/53", 74, `Standard query ${hex(qid)} A ${dst.name}`, `${port}→53`));
        rows.push(row(0.09, "in", resolver.ip, "DNS", "udp/53", 90, `Standard query response ${hex(qid)} A ${dst.name} A ${dst.ip}`, `53→${port}`));
      }
      rows.push(row(0.25, "out", dst.ip, "TCP", "tcp/443", 74, `${port} → 443 [SYN] Seq=0 Win=64240 Len=0 MSS=1460`, out));
    } else if (k === 1) {
      if (fate < 0.12) { rows.push(row(0.08, "in", dst.ip, "TCP", "tcp/443", 60, `443 → ${port} [RST, ACK] Seq=1 Ack=1 Win=0 Len=0`, back)); continue; }
      rows.push(row(0.06, "in", dst.ip, "TCP", "tcp/443", 74, `443 → ${port} [SYN, ACK] Seq=0 Ack=1 Win=65160 Len=0 MSS=1460`, back));
      rows.push(row(0.18, "out", dst.ip, "TLSv1.3", "tcp/443", between(r, 300, 620), `Client Hello (SNI=${dst.name})`, out));
    } else {
      if (fate < 0.24) continue; // refused one poll ago, or stalls here: frogger's own timeout squashes it
      rows.push(row(0.07, "in", dst.ip, "TLSv1.3", "tcp/443", between(r, 1400, 4200), "Server Hello, Change Cipher Spec", back));
      rows.push(row(0.3, "in", dst.ip, "TLSv1.3", "tcp/443", between(r, 200, 1500), "Application Data", back));
    }
  }
  return rows;
};

// ------------------------------------------------------------------ invaders

/**
 * Invaders only draws internet peers: every demo link with an internet end is a cannon (the LAN end) firing at an
 * alien (the internet end), with the downloads coming back as bombs. One device picked: that device's cannon
 * against every demo internet host.
 */
export const shapeInvadersIdle: ArcadeIdleShaper<InvadersRow> = (ctx) => {
  const internet = ctx.hosts.filter((h) => h.role === "internet");
  const pairs: { cannon?: string; alien: IdleVizDemoHost }[] = ctx.me
    ? internet.map((alien) => ({ alien }))
    : linksOf(ctx.hosts).flatMap(({ dev, dst }) =>
      dev.role !== "internet" && dst.role === "internet" ? [{ cannon: dev.ip, alien: dst }]
        : dev.role === "internet" && dst.role !== "internet" ? [{ cannon: dst.ip, alien: dev }] : []);
  const rows: InvadersRow[] = [];
  pairs.forEach(({ cannon, alien }, i) => {
    const r = ctx.rng(ctx.step * 64 + i);
    const port = eph(r);
    const row = (dt: number, dir: "in" | "out", size: number, info: string): InvadersRow => {
      const ports = dir === "out" ? `${port}→443` : `443→${port}`;
      return cannon ? [ctx.t0 + dt, dir, alien.ip, "TLSv1.3", "tcp/443", size, IFACE, info, ports, cannon] : [ctx.t0 + dt, dir, alien.ip, "TLSv1.3", "tcp/443", size, IFACE, info, ports];
    };
    const shots = 1 + Math.floor(r() * 3), bombs = 2 + Math.floor(r() * 4);
    for (let s = 0; s < shots; s++) rows.push(row(0.05 + r() * 0.85, "out", between(r, 60, 700), "Application Data"));
    for (let b = 0; b < bombs; b++) rows.push(row(0.05 + r() * 0.85, "in", between(r, 400, 1460), "Application Data"));
  });
  return rows;
};

// ------------------------------------------------------------------ netpong

/** The service a demo peer answers on: the gateway resolves names, everything else serves HTTPS. */
function service(h: IdleVizDemoHost): { proto: string; tag: string; svc: number; dns: boolean } {
  return h.role === "gateway" ? { proto: "DNS", tag: "udp/53", svc: 53, dns: true } : { proto: "TLSv1.3", tag: "tcp/443", svc: 443, dns: false };
}

/** A name a host would look up: another demo host's (never its own, never the resolver's). */
function lookupName(hosts: readonly IdleVizDemoHost[], asker: string, resolver: string, n: number): IdleVizDemoHost {
  const pool = hosts.filter((h) => h.ip !== asker && h.ip !== resolver);
  return pool.length ? pool[n % pool.length] : hosts[n % hosts.length];
}

/**
 * Request / answer pairs. A group source: every demo link asks its destination's service, in the copies the
 * server's per-device rings would return for that pick (`ctx.scope`; both ends' copies for a conversation inside
 * it). One device picked: the demo LAN hosts ask that device (DNS and HTTPS). Seeded misses (no answer) feed the
 * failed-request log.
 */
export const shapePongIdle: ArcadeIdleShaper<PongRow> = (ctx) => {
  const rows: PongRow[] = [];
  const exchange = (asker: IdleVizDemoHost, server: IdleVizDemoHost | null, s: ReturnType<typeof service>, r: () => number, n: number) => {
    const id = Math.floor(r() * 0xffff);
    if (!s.dns) return { ask: server ? `Client Hello (SNI=${server.name})` : "Client Hello", reply: "Server Hello, Change Cipher Spec" };
    const q = lookupName(ctx.hosts, asker.ip, server?.ip ?? "", n);
    return { ask: `Standard query ${hex(id)} A ${q.name}`, reply: `Standard query response ${hex(id)} A ${q.name} A ${q.ip}` };
  };
  if (ctx.me) {
    // one device picked (it serves): the demo LAN hosts ask it for names and HTTPS; its own name is the pick's
    const askers = ctx.hosts.filter((h) => h.role === "lan");
    askers.forEach((h, i) => {
      for (const s of [service({ ...h, role: "gateway" }), service(h)]) {
        const r = ctx.rng(ctx.step * 64 + i * 2 + s.svc);
        const port = eph(r), t = ctx.t0 + 0.05 + r() * 0.7;
        const { ask, reply } = exchange(h, null, s, r, ctx.step + i);
        rows.push([t, "in", h.ip, s.proto, s.tag, between(r, 70, 520), IFACE, ask, `${port}→${s.svc}`]);
        if (r() >= 0.12) rows.push([t + 0.04 + r() * 0.3, "out", h.ip, s.proto, s.tag, between(r, 90, 1400), IFACE, reply, `${s.svc}→${port}`]);
      }
    });
    return rows;
  }
  // which members' rings the server would answer for this source pick
  const inScope = (h: IdleVizDemoHost) => ctx.scope === "any" || (ctx.scope === "internet" ? h.role === "internet" : h.role !== "internet");
  linksOf(ctx.hosts).forEach(({ dev, dst }, i) => {
    const s = service(dst);
    const r = ctx.rng(ctx.step * 64 + i);
    const port = eph(r), t = ctx.t0 + 0.05 + r() * 0.7, ta = t + 0.04 + r() * 0.3;
    const answered = r() >= 0.12;
    const { ask, reply } = exchange(dev, dst, s, r, ctx.step + i);
    const qs = between(r, 70, 520), as = between(r, 90, 1400);
    if (inScope(dev)) {
      rows.push([t, "out", dst.ip, s.proto, s.tag, qs, IFACE, ask, `${port}→${s.svc}`, dev.ip]);
      if (answered) rows.push([ta, "in", dst.ip, s.proto, s.tag, as, IFACE, reply, `${s.svc}→${port}`, dev.ip]);
    }
    if (inScope(dst)) {
      rows.push([t, "in", dev.ip, s.proto, s.tag, qs, IFACE, ask, `${port}→${s.svc}`, dst.ip]);
      if (answered) rows.push([ta, "out", dev.ip, s.proto, s.tag, as, IFACE, reply, `${s.svc}→${port}`, dst.ip]);
    }
  });
  return rows;
};
