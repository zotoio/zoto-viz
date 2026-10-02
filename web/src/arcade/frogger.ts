import type { NetScene } from "../graph/scene";
import { readArcadeKnob } from "../core/arcade-knob";
import { Select } from "../ui/ui";
import { categorize, hashColor, orgOf } from "../core/modes";
import { rName } from "../core/redact";
import { type Device, type Packet } from "../core/types";
import { ArcadeView, DevicePicker, FadeLog, MISS_RED, OK_GREEN, ROW_TTL_S, clamp, css, fade, fitText, isKnown, roundRect, sprite } from "./arcade";
import { arcadeHudRate, type ArcadeIdleShaper } from "./arcade-idle-feed";
import { shapeFroggerIdle } from "./arcade-idle-shapers";

/**
 * Frogger: do connections get established, and where do they die.
 *
 * Every connection a LAN device opens is a frog. It starts on the bank in its device's column and hops up
 * through the stages of getting connected, one lane per stage, waiting in each lane for the packet that lets it
 * cross: DNS (a query is out, an address must come back), then the median (resolved, nothing sent yet), connect
 * (a SYN or a QUIC Initial is out, the far end must accept), handshake (a Client Hello is out, a Server Hello
 * must come back), data (connected, the first payload byte must arrive), and home: the lily pad of the
 * organisation it reached. Whatever kills a stage squashes the frog where it stood: NXDOMAIN, a blocked answer
 * (0.0.0.0), a RST, a TLS alert, or silence past the stage's timeout. The cars in each lane are the other packets
 * of that stage seen in the same second, so lane density is load. The log above the footer says who died where
 * and why, and the HUD keeps a per-lane body count: over a few minutes it tells whether your problem is
 * resolution, filtering, or the far end.
 */

const LOG_ROWS = 5;
const HUD_H = 60;
const PAD_H = 44;
const BANK_H = 40;
const HOP_S = 0.22;
const T_DNS = 2.5, T_CONNECT = 3, T_HANDSHAKE = 3, T_DATA = 5, T_MEDIAN = 10;
const HOME_TTL_S = 8;
const SPLAT_TTL_S = 3;
const CAR_S = 4.5;               // a car takes this long to cross at speed 1x
const MAX_CARS_PER_LANE = 6;
const KEY_DEVICES = "zoto-viz.frogger.devices";
const KEY_SPEED = "zoto-viz.frogger.speed";

/** logical stages (waiting for …) and their visual slot */
type Stage = "dns" | "median" | "connect" | "handshake" | "data" | "home";
const STAGES: Stage[] = ["dns", "median", "connect", "handshake", "data", "home"];
const LANE_LABEL: Record<Stage, string> = { dns: "DNS", median: "resolved", connect: "connect", handshake: "handshake", data: "data", home: "home" };
const LANE_HINT: Record<Stage, string> = { dns: "query out, waiting for an address", median: "resolved, nothing sent yet", connect: "SYN / QUIC Initial out, waiting to be accepted", handshake: "Client Hello out, waiting for Server Hello", data: "connected, waiting for the first byte back", home: "reached" };
const LANE_COLOR: Record<Stage, string> = { dns: css(0x26a69a), median: "#455a64", connect: css(0x29b6f6), handshake: css(0x7e57c2), data: css(0x66bb6a), home: OK_GREEN };
const TIMEOUT: Record<Stage, number> = { dns: T_DNS, median: T_MEDIAN, connect: T_CONNECT, handshake: T_HANDSHAKE, data: T_DATA, home: Infinity };

const FROG = ["#..#..#..#", "##########", ".########.", ".#.####.#.", ".########.", "#.##..##.#", "#........#"];
const SPLAT = ["#..#...#..#", ".#..#.#..#.", "..#.###.#..", "#..#####..#", "..#.###.#..", ".#..#.#..#.", "#..#...#..#"];

interface VisEvent { at: number; stage: Stage; kind: "hop" | "squash" | "vanish" }
interface Frog {
  id: number;
  dev: string;
  /** destination: the DNS name asked, or the peer's name */
  name: string;
  peer: string;
  tag: string;
  stage: Stage;
  /** wall time the frog began waiting at this stage */
  since: number;
  wall: number;
  dead: string | null;
  quic: boolean;
  /** DNS: the record types asked and the ones answered without data */
  asked: Set<string>; nodata: Set<string>;
  addrs: string[];
  attempts: number;
  color: string;
  info: string;
  // visual
  x: number; y: number; vis: Stage | "bank"; hop: { from: number; to: number; t0: number } | null;
  events: VisEvent[];
  diedAt: number; homeAt: number; vanishAt: number;
  pad: Pad | null;
}
interface Pad { name: string; color: string; slot: number; x: number; count: number; last: number }
interface Col { dev: string; slot: number; x: number; last: number }
interface Car { stage: Stage; x: number; y: number; w: number; dir: number; t0: number; color: string }

let frogSeq = 0;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class FroggerView extends ArcadeView {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly speedSel: Select;
  private readonly log = new FadeLog(LOG_ROWS, "SQUASHED", "every connection got through in the last few seconds");
  private frogs: Frog[] = [];
  private cols = new Map<string, Col>();
  private pads = new Map<string, Pad>();
  private cars: Car[] = [];
  /** dev|name → frog waiting for DNS; dev|addr → resolved frog waiting for a connection; dev|peer|tag → frog in flight */
  private dnsWait = new Map<string, Frog>();
  private resolved = new Map<string, Frog>();
  private conn = new Map<string, Frog>();
  private stats: Record<Stage, number> & { home: number } = { dns: 0, median: 0, connect: 0, handshake: 0, data: 0, home: 0 };
  private colSlot = 0; private padSlot = 0;
  private hover: { text: string; x: number; y: number; ip?: string; col?: boolean } | null = null;
  private geom = { top: 0, padY: 0, laneY: {} as Record<Stage, number>, laneH: 0, bankY: 0, bottom: 0 };
  private overflowPads = 0;

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "frogDevices", caption: "devices", key: KEY_DEVICES,
      title: "whose connections are shown: every LAN device, or one device",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.speedSel = new Select({
      caption: "speed", title: "how fast the traffic moves",
      options: [{ value: "0.5", label: "slow" }, { value: "1", label: "normal" }, { value: "2", label: "fast" }],
      value: readArcadeKnob(KEY_SPEED, "1"),
      onChange: (v) => localStorage.setItem(KEY_SPEED, v),
    });
    this.controls = [this.picker.el, this.speedSel.el];
  }

  private get speed(): number { return Number(this.speedSel.value) || 1; }

  protected override onStart(preferIp: string | null): void {
    if (preferIp && isKnown(this.deviceAt(preferIp))) this.picker.set(preferIp, false);
  }

  protected override onSnapshot(): void { if (this.msg) this.picker.update(this.msg); }

  protected override onClick(e: MouseEvent): void {
    if (!this.hover?.ip) return;
    if (this.hover.col) this.picker.set(this.picker.isGroup || e.shiftKey ? this.hover.ip : "lan");
  }

  protected override idleShaper(): ArcadeIdleShaper<Packet> { return shapeFroggerIdle; }
  protected override idleMe(): string { return this.picker.isGroup ? "" : this.picker.ip(); }

  protected query(): { ip: string } | null {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected override reset(): void {
    super.reset();
    this.frogs = []; this.cars = [];
    this.cols.clear(); this.pads.clear();
    this.dnsWait.clear(); this.resolved.clear(); this.conn.clear();
    this.log.clear();
    this.stats = { dns: 0, median: 0, connect: 0, handshake: 0, data: 0, home: 0 };
    this.colSlot = 0; this.padSlot = 0;
  }

  // ------------------------------------------------------------------ data

  protected ingest(fresh: Packet[], first: number, newest: number): void {
    const group = this.picker.isGroup;
    const me = this.picker.ip();
    const now = performance.now() / 1000;
    const at = (t: number) => now + Math.min(3, Math.max(0, t - first));
    const laneCount: Record<Stage, { n: number; t: number }> = { dns: { n: 0, t: 0 }, median: { n: 0, t: 0 }, connect: { n: 0, t: 0 }, handshake: { n: 0, t: 0 }, data: { n: 0, t: 0 }, home: { n: 0, t: 0 } };
    // packet times are rounded to the millisecond, so a DNS answer can be ordered before its query: keep the
    // batch's answers so a query can find one that "already" arrived
    const answers: { dev: string; t: number; info: string }[] = [];
    for (const p of fresh) {
      if (p[1] !== "in" || p[3] !== "DNS" || !/^Standard query response/.test(p[7])) continue;
      const dev = group ? this.scene.resolve(p[9] ?? "") : me;
      if (dev) answers.push({ dev, t: p[0], info: p[7] });
    }

    for (const p of fresh) {
      const [t, dir, rawPeer, proto, tag, , , info, , member] = p;
      const peer = this.scene.resolve(rawPeer);
      const dev = group ? this.scene.resolve(member ?? "") : me;
      if (!dev || dev === peer) continue;
      const isDns = proto === "DNS";
      const isTcp = proto === "TCP";
      const isTls = /^(TLS|SSL)/.test(proto);
      const isQuic = proto === "QUIC";
      const stageOf = (): Stage | null => {
        if (isDns) return "dns";
        if (isTcp && /\[(SYN|FIN|RST)/.test(info)) return "connect";
        if (isQuic && /Initial|Handshake/.test(info)) return "handshake";
        if (isTls && /Hello|Certificate|Key Exchange|Change Cipher|Encrypted Handshake|Alert/.test(info)) return "handshake";
        if (isTcp || isTls || isQuic || /^UDP$/.test(proto) || proto.length > 0) return "data";
        return null;
      };
      const st = stageOf();
      if (st) { laneCount[st].n++; if (!laneCount[st].t) laneCount[st].t = t; }

      const ckey = `${dev}|${peer}|${tag}`;
      if (dir === "out") {
        if (isDns) {
          const q = /^Standard query (0x[0-9a-f]+) (\S+) (\S+)/.exec(info);
          if (!q || /response/.test(info)) continue;
          const [, , type, name] = q;
          if (!/^(A|AAAA|HTTPS|CNAME|SVCB)$/.test(type) || /\.arpa$/i.test(name)) continue;
          const key = `${dev}|${name.toLowerCase()}`;
          let f = this.dnsWait.get(key);
          if (f) { f.asked.add(type); f.attempts++; continue; }
          // the A answer came already and the AAAA / HTTPS query follows: the same frog, not a new one
          const lower = name.toLowerCase();
          const same = this.frogs.find((x) => x.dev === dev && !x.dead && x.stage !== "home" && !x.tag && x.name.toLowerCase() === lower);
          if (same) { same.asked.add(type); continue; }
          f = this.spawn(dev, name, "", t, at(t), "dns", info);
          f.asked.add(type);
          this.dnsWait.set(key, f);
          // an answer of the same millisecond that was ordered before the query
          const early = answers.find((a) => a.dev === dev && a.t >= t - 0.005 && a.t <= t && this.dnsMatches(f!, a.info));
          if (early) this.dnsAnswer(f, key, early.info, early.t, at(early.t) + 0.05);
          continue;
        }
        if (isTcp && /\[SYN\]/.test(info)) {
          let f = this.conn.get(ckey);
          if (f && f.stage === "connect") { f.attempts++; f.info = info; continue; }
          f = this.claimResolved(dev, peer) ?? this.spawn(dev, this.nameOf(peer), tag, t, at(t), "connect", info);
          f.peer = peer; f.tag = tag; f.info = info;
          this.move(f, "connect", t, at(t));
          this.conn.set(ckey, f);
          continue;
        }
        if (isQuic && /Initial/.test(info)) {
          let f = this.conn.get(ckey);
          if (f && f.stage === "connect") { f.attempts++; continue; }
          f = this.claimResolved(dev, peer) ?? this.spawn(dev, this.nameOf(peer), tag, t, at(t), "connect", info);
          f.peer = peer; f.tag = tag; f.quic = true; f.info = info;
          this.move(f, "connect", t, at(t));
          this.conn.set(ckey, f);
          continue;
        }
        if (isTls && /Client Hello/.test(info)) {
          const sni = /SNI=([^)\s]+)/.exec(info)?.[1];
          let f = this.conn.get(ckey);
          if (!f || f.dead || f.stage === "home") {
            // a connection that predates the view, or a resumed session: it joins at the handshake lane
            f = this.spawn(dev, sni ?? this.nameOf(peer), tag, t, at(t), "handshake", info);
            f.peer = peer;
            this.conn.set(ckey, f);
            continue;
          }
          if (sni) f.name = sni;
          f.info = info;
          // only forward: a Server Hello of the same millisecond may already have moved it on
          if (f.stage === "connect") this.move(f, "handshake", t, at(t));
          continue;
        }
        continue;
      }

      // inbound
      if (isDns) {
        if (!/^Standard query response/.test(info)) continue;
        for (const [key, f] of this.dnsWait) {
          if (f.dev !== dev || !this.dnsMatches(f, info)) continue;
          this.dnsAnswer(f, key, info, t, at(t));
          break;
        }
        continue;
      }
      const f = this.conn.get(ckey);
      if (!f || f.dead || f.stage === "home") continue;
      // payload came back: a Len > 0, a PSH, or a segment tshark folded into a reassembled PDU (no Len in its info)
      const len = Number(/Len=(\d+)/.exec(info)?.[1] ?? (isTcp ? 0 : 1)) || (isTcp && /\[PSH|reassembled PDU|Continuation|Retransmission/.test(info) ? 1 : 0);
      if (isTcp && /\[RST/.test(info)) { this.squash(f, f.stage === "connect" ? "refused · RST" : "reset by the far end", t, at(t)); continue; }
      if (isTcp && /\[SYN, ACK\]/.test(info)) {
        if (f.stage !== "connect") continue;
        const cat = categorize([tag]).id;
        this.move(f, cat === "tls" || cat === "mail" ? "handshake" : "data", t, at(t));
        continue;
      }
      if (isQuic) {
        if (/Initial|Handshake/.test(info) && f.stage === "connect") { this.move(f, "handshake", t, at(t)); this.move(f, "data", t, at(t) + HOP_S); }
        if (/Protected Payload|0-RTT|1-RTT/.test(info)) this.home(f, t, at(t));
        continue;
      }
      if (isTls && /Alert/.test(info) && f.stage !== "data") { this.squash(f, "TLS alert", t, at(t)); continue; }
      if (isTls && /Server Hello/.test(info) && (f.stage === "handshake" || f.stage === "connect")) this.move(f, "data", t, at(t));
      if ((isTls && /Application Data|Continuation Data|Encrypted/.test(info)) || (isTcp && len > 0)) {
        if (f.stage === "handshake" || f.stage === "connect") this.move(f, "data", t, at(t));
        this.home(f, t, at(t) + (f.stage === "data" ? 0 : HOP_S));
      }
    }

    // timeouts against the wire clock
    for (const f of this.frogs) {
      if (f.dead || f.stage === "home") continue;
      const limit = TIMEOUT[f.stage];
      if (newest - f.since <= limit) continue;
      if (f.stage === "median") { this.vanish(f, newest, now); continue; }
      const why = f.stage === "dns" ? "no DNS answer" : f.stage === "connect" ? (f.quic ? "no QUIC handshake" : `no SYN-ACK${f.attempts > 1 ? ` · ${f.attempts} tries` : ""}`) : f.stage === "handshake" ? "no Server Hello" : "no data back";
      this.squash(f, why, newest, now);
    }
    for (const [k, f] of this.resolved) if (f.dead || f.stage !== "median") this.resolved.delete(k);
    for (const [k, f] of this.dnsWait) if (f.dead || f.stage !== "dns") this.dnsWait.delete(k);
    for (const [k, f] of this.conn) if (f.dead || f.stage === "home") this.conn.delete(k);

    // cars: the lane's packets this second, a few per lane
    for (const st of STAGES) {
      if (st === "median" || st === "home") continue;
      const { n, t } = laneCount[st];
      if (!n) continue;
      const cars = Math.min(MAX_CARS_PER_LANE, Math.ceil(Math.log2(1 + n)));
      const dir = st === "dns" || st === "handshake" ? 1 : -1;
      for (let i = 0; i < cars; i++) {
        this.cars.push({ stage: st, x: 0, y: 0, w: 14 + 6 * Math.min(4, Math.log10(1 + n / cars)), dir, t0: at(t) + (i / cars) * 0.9, color: LANE_COLOR[st] });
      }
    }
  }

  private dnsMatches(f: Frog, info: string): boolean {
    return new RegExp(`(^|\\s)${esc(f.name)}(\\s|$)`, "i").test(info);
  }

  /** A DNS answer for a waiting frog: an address moves it to the median, a failure squashes it, "no data" may leave it waiting for the other record type. */
  private dnsAnswer(f: Frog, key: string, info: string, t: number, at: number): void {
    this.dnsWait.delete(key);
    f.info = info;
    if (/No such name/.test(info)) { this.squash(f, "NXDOMAIN", t, at); return; }
    if (/Server failure/.test(info)) { this.squash(f, "SERVFAIL", t, at); return; }
    if (/Refused/.test(info)) { this.squash(f, "refused by the resolver", t, at); return; }
    const addrs = [...info.matchAll(/\bA (\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((m) => m[1]).concat([...info.matchAll(/\bAAAA ([0-9a-f]*:[0-9a-f:]+)\b/gi)].map((m) => m[1]));
    if (addrs.length && addrs.every((a) => a === "0.0.0.0" || a === "::")) { this.squash(f, "blocked · answered 0.0.0.0", t, at); return; }
    if (addrs.length) {
      f.addrs = addrs;
      this.move(f, "median", t, at);
      for (const a of addrs) this.resolved.set(`${f.dev}|${this.scene.resolve(a)}`, f);
      return;
    }
    // no data: an AAAA / HTTPS with nothing is normal; an A with nothing is a failure
    const type = /response 0x[0-9a-f]+ (\S+)/.exec(info)?.[1] ?? "";
    f.nodata.add(type);
    if (type === "A") { this.squash(f, "no address", t, at); return; }
    if ([...f.asked].every((x) => f.nodata.has(x))) { this.vanish(f, t, at); return; }
    this.dnsWait.set(key, f); // still waiting for the other type
  }

  private spawn(dev: string, name: string, tag: string, t: number, at: number, stage: Stage, info: string): Frog {
    let col = this.cols.get(dev);
    if (!col) { col = { dev, slot: this.colSlot++, x: -1, last: at }; this.cols.set(dev, col); }
    col.last = at;
    const f: Frog = {
      id: frogSeq++, dev, name, peer: "", tag, stage, since: t, wall: t, dead: null, quic: false,
      asked: new Set(), nodata: new Set(), addrs: [], attempts: 1, color: this.devColor(dev), info,
      x: 0, y: 0, vis: "bank", hop: null, events: [{ at, stage, kind: "hop" }], diedAt: 0, homeAt: 0, vanishAt: 0, pad: null,
    };
    this.frogs.push(f);
    return f;
  }

  private devColor(ip: string): string {
    const d = this.deviceAt(ip);
    if (d && (d.role === "gateway" || d.role === "self" || d.role === "local")) return this.roleCss(d.role);
    return css(hashColor(ip));
  }

  /** A resolved frog for this destination, taken off the median. */
  private claimResolved(dev: string, peer: string): Frog | null {
    const f = this.resolved.get(`${dev}|${peer}`);
    if (!f || f.dead || f.stage !== "median") return null;
    for (const a of f.addrs) this.resolved.delete(`${dev}|${this.scene.resolve(a)}`);
    return f;
  }

  private move(f: Frog, stage: Stage, t: number, at: number): void {
    if (f.dead) return;
    f.stage = stage; f.since = t;
    f.events.push({ at, stage, kind: "hop" });
  }

  private home(f: Frog, t: number, at: number): void {
    if (f.dead || f.stage === "home") return;
    f.stage = "home"; f.since = t;
    this.stats.home++;
    const padName = this.padName(f);
    let pad = this.pads.get(padName);
    if (!pad) { pad = { name: padName, color: css(hashColor(padName)), slot: this.padSlot++, x: -1, count: 0, last: at }; this.pads.set(padName, pad); }
    pad.count++; pad.last = at;
    f.pad = pad;
    f.events.push({ at, stage: "home", kind: "hop" });
  }

  private padName(f: Frog): string {
    const d = f.peer ? this.deviceAt(f.peer) : undefined;
    if (d && d.role !== "internet") return this.nameOf(f.peer);
    if (d) return orgOf(d);
    return orgOf({ ip: f.peer, names: [f.name], hostnames: [] } as unknown as Device);
  }

  private squash(f: Frog, why: string, t: number, at: number): void {
    if (f.dead) return;
    f.dead = why;
    this.stats[f.stage]++;
    f.events.push({ at, stage: f.stage, kind: "squash" });
    this.log.push({
      key: `${f.dev}|${f.name}|${f.tag}|${f.stage}|${why}`, t: at, wall: t,
      mark: "✕", markColor: MISS_RED, color: f.color,
      head: `${this.shortName(f.dev)} → ${rName(f.name)}${f.tag ? ` :${f.tag.split("/")[1]}` : ""}`,
      tail: `died in ${LANE_LABEL[f.stage]} · ${why}`,
    });
  }

  /** Quiet exit: resolved but never connected, or a DNS type that had nothing to say. Not a failure. */
  private vanish(f: Frog, t: number, at: number): void {
    if (f.dead) return;
    f.dead = "vanished"; f.since = t;
    f.events.push({ at, stage: f.stage, kind: "vanish" });
  }

  // ------------------------------------------------------------------ step

  private layout(dt: number): void {
    const top = this.barTop();
    const bottom = this.footTop() - this.log.height;
    const padY = top + HUD_H + PAD_H / 2;
    const laneTop = top + HUD_H + PAD_H + 6, bankY = bottom - BANK_H / 2;
    const units = 4 + 0.6; // four lanes and a narrower median
    const laneH = Math.max(24, (bankY - BANK_H / 2 - laneTop) / units);
    const laneY = {} as Record<Stage, number>;
    let y = bankY - BANK_H / 2;
    for (const st of ["dns", "median", "connect", "handshake", "data"] as Stage[]) {
      const h = st === "median" ? laneH * 0.6 : laneH;
      laneY[st] = y - h / 2; y -= h;
    }
    laneY.home = padY;
    this.geom = { top, padY, laneY, laneH, bankY, bottom };

    const live = [...this.cols.values()].sort((a, b) => a.slot - b.slot);
    const usable = this.W - 60;
    const sp = clamp(usable / Math.max(1, live.length), 40, 170);
    const x0 = 30 + (usable - sp * live.length) / 2;
    live.forEach((c, i) => {
      const x = x0 + (i + 0.5) * sp;
      c.x = c.x < 0 ? x : c.x + (x - c.x) * Math.min(1, dt / 0.3);
    });
    const pads = [...this.pads.values()].sort((a, b) => b.count - a.count || a.slot - b.slot);
    const cap = Math.max(1, Math.floor((this.W - 40) / 120));
    this.overflowPads = pads.length > cap ? pads.length - (cap - 1) : 0;
    const shown = this.overflowPads ? cap : pads.length;
    const psp = clamp((this.W - 40) / Math.max(1, shown), 90, 220);
    const px0 = 20 + ((this.W - 40) - psp * shown) / 2;
    pads.forEach((p, i) => {
      const x = px0 + (Math.min(i, cap - 1) + 0.5) * psp;
      p.x = p.x < 0 ? x : p.x + (x - p.x) * Math.min(1, dt / 0.4);
    });
  }

  private frogX(f: Frog): number {
    const col = this.cols.get(f.dev);
    const jitter = ((f.id * 7919) % 29) - 14;
    return (col?.x ?? this.W / 2) + jitter;
  }

  private stageY(f: Frog, s: Stage | "bank"): number {
    if (s === "bank") return this.geom.bankY;
    if (s === "home") return f.pad ? this.geom.padY : this.geom.laneY.home;
    return this.geom.laneY[s];
  }

  protected step(now: number, dt: number): void {
    this.layout(dt);
    for (const f of this.frogs) {
      while (f.events.length && f.events[0].at <= now) {
        const e = f.events.shift()!;
        if (e.kind === "hop") { f.hop = { from: this.stageY(f, f.vis), to: this.stageY(f, e.stage), t0: now }; f.vis = e.stage; if (e.stage === "home") f.homeAt = now; }
        else if (e.kind === "squash") f.diedAt = now;
        else f.vanishAt = now;
      }
      const ty = this.stageY(f, f.vis);
      if (f.hop) {
        const p = Math.min(1, (now - f.hop.t0) / HOP_S);
        f.y = f.hop.from + (f.hop.to - f.hop.from) * p;
        if (p >= 1) f.hop = null;
      } else f.y += (ty - f.y) * Math.min(1, dt / 0.3);
      if (f.y === 0) f.y = ty;
      // home frogs slide over to their pad
      const tx = f.vis === "home" && f.pad ? f.pad.x + (((f.id * 31) % 41) - 20) : this.frogX(f);
      f.x = f.x === 0 ? tx : f.x + (tx - f.x) * Math.min(1, dt / (f.vis === "home" ? 0.5 : 0.3));
    }
    this.frogs = this.frogs.filter((f) =>
      (!f.diedAt || now - f.diedAt < SPLAT_TTL_S) && (!f.homeAt || now - f.homeAt < HOME_TTL_S) && (!f.vanishAt || now - f.vanishAt < 0.6));
    for (const c of this.cars) {
      const p = (now - c.t0) / (CAR_S / this.speed);
      c.y = this.geom.laneY[c.stage];
      c.x = c.dir > 0 ? -c.w + p * (this.W + 2 * c.w) : this.W + c.w - p * (this.W + 2 * c.w);
    }
    this.cars = this.cars.filter((c) => now - c.t0 < CAR_S / this.speed);
    this.log.expire(now);
    for (const [k, c] of this.cols) if (now - c.last > ROW_TTL_S && !this.frogs.some((f) => f.dev === k)) this.cols.delete(k);
    for (const [k, p] of this.pads) if (now - p.last > ROW_TTL_S * 2 && !this.frogs.some((f) => f.pad === p)) this.pads.delete(k);

    this.hover = null;
    const { x: px, y: py } = this.pointer;
    if (px >= 0) {
      let best: Frog | null = null, bd = 14;
      for (const f of this.frogs) {
        if (now < (f.events[0]?.at ?? -Infinity) && f.vis === "bank") continue;
        const d = Math.hypot(px - f.x, py - f.y);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) {
        const where = best.dead && best.dead !== "vanished" ? `squashed in ${LANE_LABEL[best.stage]} · ${best.dead}` : best.stage === "home" ? `home · ${best.pad?.name ?? ""}` : `waiting in ${LANE_LABEL[best.stage]} · ${LANE_HINT[best.stage]}`;
        this.hover = { text: `${this.nameOf(best.dev)} → ${rName(best.name)}${best.tag ? ` :${best.tag.split("/")[1]}` : ""} · ${where}`, x: best.x, y: best.y - 20 };
      } else if (Math.abs(py - this.geom.bankY) < BANK_H / 2) {
        for (const c of this.cols.values()) if (Math.abs(px - c.x) < 20) { this.hover = { ip: c.dev, col: true, text: this.nameOf(c.dev), x: c.x, y: this.geom.bankY - 26 }; break; }
      }
    }
    this.canvas.style.cursor = this.hover?.col ? "pointer" : "";
  }

  // ------------------------------------------------------------------ draw

  protected draw(now: number): void {
    const g = this.g, u = this.theme.ui, { top, padY, laneY, laneH, bankY, bottom } = this.geom;
    g.textBaseline = "middle";

    // HUD
    g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("FROGGER", 16, top + 8);
    let x = 16;
    const put = (n: string, label: string, color: string) => {
      g.font = `600 14px ${this.font}`; g.fillStyle = color; g.fillText(n, x, top + 30); x += g.measureText(n).width + 5;
      g.font = `11px ${this.font}`; g.fillStyle = u.muted; g.fillText(label, x, top + 31); x += g.measureText(label).width + 16;
    };
    put(String(this.stats.home), "home", this.stats.home ? OK_GREEN : u.fg);
    for (const st of ["dns", "connect", "handshake", "data"] as Stage[]) put(`${this.stats[st]}✕`, LANE_LABEL[st], this.stats[st] ? MISS_RED : u.fg);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    const waiting = this.frogs.filter((f) => !f.dead && f.stage !== "home").length;
    g.fillText(`${arcadeHudRate(this.pps, this.idleShowing)} · ${waiting} frog${waiting === 1 ? "" : "s"} crossing · ${this.pads.size} pad${this.pads.size === 1 ? "" : "s"}`, 16, top + 48);
    g.textAlign = "right";
    g.font = `600 14px ${this.font}`; g.fillStyle = this.picker.isGroup ? this.roleCss("lan") : this.devColor(this.picker.ip());
    g.fillText(this.picker.label((ip) => this.nameOf(ip)), this.W - 16, top + 30);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText(this.picker.isGroup ? `${this.picker.count()} devices · a frog per connection they open` : "one device · shift-click a name on the bank to pick another, click to go back to the LAN", this.W - 16, top + 48);

    // lanes
    for (const st of ["dns", "median", "connect", "handshake", "data"] as Stage[]) {
      const h = st === "median" ? laneH * 0.6 : laneH, y = laneY[st];
      g.fillStyle = st === "median" ? u.chip : "transparent";
      if (st === "median") { g.globalAlpha = 0.5; g.fillRect(16, y - h / 2, this.W - 32, h); g.globalAlpha = 1; }
      g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash(st === "median" ? [] : [6, 6]);
      g.beginPath(); g.moveTo(16, y + h / 2); g.lineTo(this.W - 16, y + h / 2); g.stroke();
      g.setLineDash([]);
      g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = LANE_COLOR[st]; g.globalAlpha = 0.9;
      g.fillText(LANE_LABEL[st].toUpperCase(), 20, y - h / 2 + 9);
      g.fillStyle = u.muted; g.globalAlpha = 0.7;
      g.fillText(LANE_HINT[st], 20 + g.measureText(LANE_LABEL[st].toUpperCase()).width + 8, y - h / 2 + 9);
      g.globalAlpha = 1;
    }
    g.strokeStyle = u.line; g.beginPath(); g.moveTo(16, laneY.data - laneH / 2); g.lineTo(this.W - 16, laneY.data - laneH / 2); g.stroke();

    // cars
    for (const c of this.cars) {
      if (now < c.t0) continue;
      g.globalAlpha = 0.28; g.fillStyle = c.color;
      roundRect(g, c.x - c.w / 2, c.y - 5, c.w, 10, 3); g.fill();
      g.globalAlpha = 0.7; g.fillStyle = u.fg;
      g.fillRect(c.dir > 0 ? c.x + c.w / 2 - 3 : c.x - c.w / 2 + 1, c.y - 3, 2, 2);
      g.fillRect(c.dir > 0 ? c.x + c.w / 2 - 3 : c.x - c.w / 2 + 1, c.y + 1, 2, 2);
    }
    g.globalAlpha = 1;

    // pads
    const pads = [...this.pads.values()].sort((a, b) => b.count - a.count || a.slot - b.slot);
    const cap = Math.max(1, Math.floor((this.W - 40) / 120));
    pads.forEach((p, i) => {
      if (this.overflowPads && i >= cap - 1) {
        if (i === cap - 1) { g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = u.muted; g.fillText(`… ${this.overflowPads} more`, p.x, padY); }
        return;
      }
      g.globalAlpha = fade(now, p.last, ROW_TTL_S * 2, 10);
      g.fillStyle = p.color; g.globalAlpha *= 0.25;
      g.beginPath(); g.ellipse(p.x, padY + 6, 44, 12, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = fade(now, p.last, ROW_TTL_S * 2, 10);
      g.textAlign = "center"; g.font = `600 11px ${this.font}`; g.fillStyle = p.color;
      g.fillText(fitText(g, rName(p.name), 110), p.x, padY - 10);
      g.font = `10px ${this.font}`; g.fillStyle = u.muted;
      g.fillText(`${p.count} home`, p.x, padY + 20);
      g.globalAlpha = 1;
    });
    if (!this.pads.size) { g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = u.muted; g.fillText("HOME · organisations reached", 20, padY - 10); }

    // frogs
    for (const f of this.frogs) {
      if (f.vis === "bank" && f.events.length && now < f.events[0].at) continue;
      if (f.diedAt) {
        const p = (now - f.diedAt) / SPLAT_TTL_S;
        g.globalAlpha = 1 - p * p;
        sprite(g, SPLAT, f.x, f.y, 2, MISS_RED);
        g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = MISS_RED;
        g.fillText(fitText(g, `${rName(f.name)} · ${f.dead}`, 160), f.x + 14, f.y);
        g.globalAlpha = 1;
        continue;
      }
      if (f.vanishAt) g.globalAlpha = 1 - (now - f.vanishAt) / 0.6;
      else if (f.homeAt) g.globalAlpha = clamp((HOME_TTL_S - (now - f.homeAt)) / 3, 0, 1);
      const scale = f.hop ? 1 + 0.5 * Math.sin(Math.PI * Math.min(1, (now - f.hop.t0) / HOP_S)) : 1;
      sprite(g, FROG, f.x, f.y, 2 * scale, f.vis === "home" ? OK_GREEN : f.color);
      if (f.vis !== "home" && !f.hop) {
        g.textAlign = "left"; g.font = `9.5px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(fitText(g, rName(f.name), 80), f.x + 13, f.y);
      }
      g.globalAlpha = 1;
    }

    // bank: the devices' columns
    g.strokeStyle = u.line; g.beginPath(); g.moveTo(16, bankY - BANK_H / 2); g.lineTo(this.W - 16, bankY - BANK_H / 2); g.stroke();
    const cols = [...this.cols.values()].sort((a, b) => a.x - b.x);
    const sp = cols.length > 1 ? cols[1].x - cols[0].x : 170;
    cols.forEach((c, i) => {
      g.globalAlpha = fade(now, c.last);
      g.fillStyle = this.devColor(c.dev); g.beginPath(); g.arc(c.x, bankY - 6, 3.5, 0, Math.PI * 2); g.fill();
      g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = this.hover?.ip === c.dev ? u.accent : u.fg;
      g.fillText(fitText(g, this.shortName(c.dev), Math.max(40, sp * 2 - 8)), c.x, bankY + 6 + (i % 2) * 12);
      g.globalAlpha = 1;
    });
    if (!this.cols.size) g.fillStyle = u.muted, g.textAlign = "left", g.font = `10px ${this.font}`, g.fillText("BANK · devices opening connections", 20, bankY);

    const seen = this.lastT || this.idleShowing;
    if (!this.frogs.length && seen) this.drawIdle(now, `no new connections from ${this.picker.label((ip) => this.nameOf(ip))} in the last few seconds`, this.W / 2, laneY.connect);
    else if (!seen) this.drawIdle(now, "waiting for packets…", this.W / 2, laneY.connect);

    this.log.draw(g, u, this.font, 16, bottom, this.W - 30, now);

    if (this.hover) {
      g.font = `11px ${this.font}`;
      const tw = g.measureText(this.hover.text).width + 14;
      const x = clamp(this.hover.x - tw / 2, 8, this.W - tw - 8), y = this.hover.y;
      g.fillStyle = u.panel; g.strokeStyle = u.lineStrong;
      roundRect(g, x, y - 10, tw, 20, 5); g.fill(); g.stroke();
      g.fillStyle = u.fg; g.textAlign = "left"; g.fillText(this.hover.text, x + 7, y + 1);
    }
  }
}