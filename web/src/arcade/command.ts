import type { NetScene } from "../graph/scene";
import { Select } from "../ui/ui";
import { categorize, hashColor } from "../core/modes";
import { rIp } from "../core/redact";
import { type Device, type Packet } from "../core/types";
import { ArcadeView, DevicePicker, FadeLog, MISS_RED, ROW_TTL_S, clamp, css, fade, fitText, isExchangeStart, isKnown, noReplyExpected, portRole, portSuffix, roundRect, sizeOf } from "./arcade";

/**
 * Command: what arrives unsolicited, and does anything answer.
 *
 * Missile Command with NetPong's request / answer pairing turned around. The cities along the bottom are the
 * LAN devices (width = how many ports they serve); incoming missiles are packets aimed at a city that are not the
 * answer to anything the city sent: a peer opening a connection to it, a probe of a closed port, a scan. The
 * missile's trail takes the protocol family's colour and starts from the attacker's silo at the top edge. When
 * the city answers within the reply window the missile lands: red burst, the city flashes, "your device talked
 * to a stranger". A refusal (RST, ICMP unreachable) is an interception just above the city; no answer at all
 * and the missile fizzles in the air: the device dropped it. One attacker hitting several cities or ports in
 * the same second splits its missiles from one warhead, which is what a scan or sweep looks like. Discovery
 * chatter (mDNS, SSDP, NetBIOS) and the LAN's expected requests to the gateway (DNS, DHCP, NTP) are flak: drawn
 * faint, never scored. Every outcome is written to the log above the footer.
 */

const FLIGHT_S = 2.6;
const REPLY_WINDOW_S = 2.5;
const CONV_S = 10;            // the city sent to this peer this recently: an ongoing conversation, not a new missile
const HUD_H = 60;
const SILO_H = 30;
const MAX_PER_POLL = 40;
const MIRV_MIN = 3;           // one attacker, this many targets in one poll: missiles split from one warhead
const LOG_ROWS = 5;
const CITY_MIN_SPACING = 38;
const KEY_CITIES = "zoto-viz.command.cities";
const KEY_FROM = "zoto-viz.command.from";
const KEY_SPEED = "zoto-viz.command.speed";
const C_REFUSED = "#4fc3f7";
const C_DROPPED = "#9e9e9e";
const C_FLAK = "#607d8b";

type Outcome = "landed" | "refused" | "dropped" | "flak";
interface Rec { t: number; answered: boolean; refused: boolean; answeredAt: number }
interface Silo { ip: string; slot: number; x: number; last: number; count: number; landed: number }
interface City { ip: string; x: number; w: number; last: number; landed: number; refused: number; dropped: number; flak: number; flash: number; refusedFlash: number; overflow: boolean }
interface Missile {
  silo: Silo; city: City; lane: string; label: string; color: string; flak: boolean;
  rec: Rec; t0: number; dur: number; size: number; count: number; wall: number; info: string;
  via: { x: number; y: number } | null;
  x: number; y: number; outcome: Outcome | null; done: boolean;
}
interface Blast { x: number; y: number; t0: number; dur: number; r: number; color: string; fill: boolean }

const ipKey = (ip: string): string => ip.includes(":") ? `z${ip}` : ip.split(".").map((n) => n.padStart(3, "0")).join(".");

export class CommandView extends ArcadeView {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly fromSel: Select;
  private readonly speedSel: Select;
  private readonly log = new FadeLog(LOG_ROWS, "INCOMING", "nothing unsolicited in the last few seconds");
  private silos = new Map<string, Silo>();
  private cities = new Map<string, City>();
  private cityOrder: City[] = [];
  private overflowCities = 0;
  private missiles: Missile[] = [];
  private blasts: Blast[] = [];
  /** city|peer → time of the city's latest packet to that peer; city|peer|lane → the same per lane */
  private lastOut = new Map<string, number>();
  private pending = new Map<string, Rec[]>();
  private stats = { landed: 0, refused: 0, dropped: 0, flak: 0 };
  private siloSlot = 0;
  private hover: { text: string; x: number; y: number; ip?: string; city?: boolean } | null = null;
  private geom = { top: 0, siloY: 0, cityY: 0, bottom: 0 };

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "cmdCities", caption: "cities", key: KEY_CITIES,
      title: "which devices are the cities: every LAN device, or one device",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.fromSel = new Select({
      id: "cmdFrom", caption: "from", title: "whose unsolicited packets to show: any peer, internet hosts only, or LAN peers only",
      options: [
        { value: "any", label: "any", hint: "every peer" },
        { value: "internet", label: "internet", hint: "peers off the local network" },
        { value: "lan", label: "LAN", hint: "peers on the local segment" },
      ],
      value: localStorage.getItem(KEY_FROM) ?? "any",
      onChange: (v) => { localStorage.setItem(KEY_FROM, v); this.resync(); },
    });
    this.speedSel = new Select({
      caption: "speed", title: "how fast missiles fall",
      options: [{ value: "0.5", label: "slow" }, { value: "1", label: "normal" }, { value: "2", label: "fast" }],
      value: localStorage.getItem(KEY_SPEED) ?? "1",
      onChange: (v) => localStorage.setItem(KEY_SPEED, v),
    });
    this.controls = [this.picker.el, this.fromSel.el, this.speedSel.el];
  }

  private get speed(): number { return Number(this.speedSel.value) || 1; }

  protected override onStart(preferIp: string | null): void {
    if (preferIp && isKnown(this.deviceAt(preferIp))) this.picker.set(preferIp, false);
  }

  protected override onSnapshot(): void {
    if (!this.msg) return;
    this.picker.update(this.msg);
    this.rebuildCities();
  }

  protected override onClick(e: MouseEvent): void {
    if (!this.hover?.ip) return;
    if (this.hover.city) this.picker.set(this.picker.isGroup || e.shiftKey ? this.hover.ip : "lan");
  }

  protected query(): { ip: string } | null {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  /** the attacker filter is client-side but changes what is on screen: a change restarts the view */
  protected override variant(): string { return this.fromSel.value; }
  private get attackerFilter(): string { return this.fromSel.value; }

  protected override reset(): void {
    super.reset();
    this.silos.clear(); this.missiles = []; this.blasts = [];
    this.lastOut.clear(); this.pending.clear(); this.log.clear();
    this.stats = { landed: 0, refused: 0, dropped: 0, flak: 0 };
    this.siloSlot = 0;
    for (const c of this.cities.values()) { c.landed = c.refused = c.dropped = c.flak = 0; c.flash = c.refusedFlash = -1; }
    this.rebuildCities();
  }

  /** The cities are every online known device (or the one picked), in address order, kept across snapshots. */
  private rebuildCities(): void {
    const m = this.msg;
    if (!m) return;
    const want = this.picker.isGroup
      ? m.devices.filter((d) => isKnown(d) && d.online && !/^fe80:/i.test(d.ip))
      : m.devices.filter((d) => d.ip === this.picker.ip());
    const keep = new Set(want.map((d) => d.ip));
    for (const ip of [...this.cities.keys()]) if (!keep.has(ip) && !this.missiles.some((x) => x.city.ip === ip)) this.cities.delete(ip);
    for (const d of want) {
      const c = this.cities.get(d.ip);
      const w = 26 + 4 * Math.min(10, d.ports.length);
      if (c) c.w = w;
      else this.cities.set(d.ip, { ip: d.ip, x: -1, w, last: 0, landed: 0, refused: 0, dropped: 0, flak: 0, flash: -1, refusedFlash: -1, overflow: false });
    }
    this.cityOrder = [...this.cities.values()].sort((a, b) => ipKey(a.ip).localeCompare(ipKey(b.ip)));
  }

  private attackerOk(peer: string, d: Device | undefined): boolean {
    switch (this.attackerFilter) {
      case "internet": return d?.role === "internet";
      case "lan": return d?.role !== "internet";
      default: return true;
    }
  }

  // ------------------------------------------------------------------ data

  protected ingest(fresh: Packet[], first: number, newest: number): void {
    const group = this.picker.isGroup;
    const me = this.picker.ip();
    const gateway = this.msg?.gateway ?? "";
    interface Spawn { city: string; peer: string; lane: string; tag: string; proto: string; t: number; bytes: number; count: number; info: string; rec: Rec; flak: boolean }
    interface Out { t: number; refusing: boolean }
    let spawns: Spawn[] = [];
    // Packet times are rounded to the millisecond and a group's rings are merged by time, so two packets of the
    // same millisecond can come back in either order (a city's SYN-ACK after the ACK that answers it). First pass:
    // every outbound packet of the batch, by city|peer|lane, so an inbound packet can see an outbound of the same
    // millisecond whichever came first.
    const outs = new Map<string, Out[]>();
    const outsAny = new Map<string, number[]>();
    for (const p of fresh) {
      const [t, dir, rawPeer, proto, tag, , , info, , member] = p;
      if (dir !== "out") continue;
      const peer = this.scene.resolve(rawPeer);
      const city = group ? this.scene.resolve(member ?? "") : me;
      if (!city || city === peer) continue;
      const lane = tag || proto || "?";
      const icmpErr = /^icmp/i.test(proto) && /unreachable|prohibited/i.test(info);
      const o: Out = { t, refusing: /\[RST/.test(info) || icmpErr };
      const k = `${city}|${peer}|${lane}`;
      (outs.get(k) ?? outs.set(k, []).get(k)!).push(o);
      (outsAny.get(`${city}|${peer}`) ?? outsAny.set(`${city}|${peer}`, []).get(`${city}|${peer}`)!).push(t);
      if (icmpErr) { const k2 = `${city}|${peer}|*`; (outs.get(k2) ?? outs.set(k2, []).get(k2)!).push(o); }
    }
    const TOL = 0.005;
    /** the city sent to the peer (on this lane, or at all) within CONV_S before the inbound packet, this batch or earlier */
    const conversational = (city: string, peer: string, lane: string | null, t: number): boolean => {
      const prev = this.lastOut.get(lane ? `${city}|${peer}|${lane}` : `${city}|${peer}`) ?? -Infinity;
      if (t - prev < CONV_S) return true;
      const list = lane ? outs.get(`${city}|${peer}|${lane}`)?.map((o) => o.t) : outsAny.get(`${city}|${peer}`);
      return !!list?.some((o) => o <= t + TOL && t - o < CONV_S);
    };

    for (const p of fresh) {
      const [t, dir, rawPeer, proto, tag, size, , info, ports, member] = p;
      const peer = this.scene.resolve(rawPeer);
      const city = group ? this.scene.resolve(member ?? "") : me;
      if (!city || city === peer) continue;
      const lane = tag || proto || "?";
      if (dir === "out") {
        this.lastOut.set(`${city}|${peer}`, t);
        this.lastOut.set(`${city}|${peer}|${lane}`, t);
        // an answer to a missile from an earlier batch? a RST or an ICMP error is a refusal
        const icmpErr = /^icmp/i.test(proto) && /unreachable|prohibited/i.test(info);
        const refusing = /\[RST/.test(info) || icmpErr;
        const keys = icmpErr ? [...this.pending.keys()].filter((k) => k.startsWith(`${city}|${peer}|`)) : [`${city}|${peer}|${lane}`];
        for (const k of keys) {
          const rec = this.pending.get(k)?.find((x) => !x.answered && t >= x.t - TOL && t - x.t <= REPLY_WINDOW_S);
          if (rec) { rec.answered = true; rec.answeredAt = t; rec.refused = refusing; if (!icmpErr) break; }
        }
        continue;
      }
      // inbound: is it unsolicited?
      const dev = this.deviceAt(peer);
      if (dev?.role === "multicast" || noReplyExpected(peer) || !this.attackerOk(peer, dev)) continue;
      const role = portRole(proto, tag, ports);
      if (role === "answer") continue; // a reply to the city's own request
      if (!isExchangeStart(proto, info)) continue; // TLS app data / keep-alive / ACK-only is not a probe
      if (conversational(city, peer, role === "request" ? lane : null, t)) continue; // part of an ongoing conversation
      const cat = tag ? categorize([tag]).id : "";
      const flak = cat === "discovery" || (city === gateway && (cat === "dns" || cat === "ntp" || tag === "udp/67" || tag === "udp/68"));
      const rec: Rec = { t, answered: false, refused: false, answeredAt: 0 };
      // answered within this batch (possibly in the same millisecond, ordered before us)?
      const reply = outs.get(`${city}|${peer}|${lane}`)?.find((o) => o.t >= t - TOL && o.t - t <= REPLY_WINDOW_S)
        ?? outs.get(`${city}|${peer}|*`)?.find((o) => o.t >= t - TOL && o.t - t <= REPLY_WINDOW_S);
      if (reply) { rec.answered = true; rec.answeredAt = reply.t; rec.refused = reply.refusing; }
      const key = `${city}|${peer}|${lane}`;
      (this.pending.get(key) ?? this.pending.set(key, []).get(key)!).push(rec);
      spawns.push({ city, peer, lane, tag, proto, t, bytes: size, count: 1, info, rec, flak });
    }
    for (const [k, list] of this.pending) {
      const keep = list.filter((x) => newest - x.t < REPLY_WINDOW_S * 4);
      if (keep.length) this.pending.set(k, keep); else this.pending.delete(k);
    }
    if (this.lastOut.size > 5000) for (const [k, t] of this.lastOut) if (newest - t > CONV_S * 6) this.lastOut.delete(k);
    if (!spawns.length) return;

    if (spawns.length > MAX_PER_POLL) {
      const grouped = new Map<string, Spawn>();
      for (const s of spawns) {
        const k = `${s.peer}|${s.city}|${s.lane}`;
        const e = grouped.get(k);
        if (e) { e.bytes += s.bytes; e.count++; } else grouped.set(k, { ...s });
      }
      spawns = [...grouped.values()];
      if (spawns.length > MAX_PER_POLL) spawns = spawns.sort((a, b) => Number(a.flak) - Number(b.flak) || b.bytes - a.bytes).slice(0, MAX_PER_POLL);
      spawns.sort((a, b) => a.t - b.t);
    }

    // MIRV: an attacker with several targets in this poll sends them from one warhead that splits mid-air
    const perAttacker = new Map<string, Set<string>>();
    for (const s of spawns) if (!s.flak) (perAttacker.get(s.peer) ?? perAttacker.set(s.peer, new Set()).get(s.peer)!).add(`${s.city}|${s.lane}`);

    const now = performance.now() / 1000;
    const dur = FLIGHT_S / this.speed;
    for (const s of spawns) {
      let silo = this.silos.get(s.peer);
      if (!silo) { silo = { ip: s.peer, slot: this.siloSlot++, x: -1, last: now, count: 0, landed: 0 }; this.silos.set(s.peer, silo); }
      silo.last = now; silo.count += s.count;
      let city = this.cities.get(s.city);
      if (!city) {
        city = { ip: s.city, x: -1, w: 30, last: now, landed: 0, refused: 0, dropped: 0, flak: 0, flash: -1, refusedFlash: -1, overflow: false };
        this.cities.set(s.city, city);
        this.cityOrder = [...this.cities.values()].sort((a, b) => ipKey(a.ip).localeCompare(ipKey(b.ip)));
      }
      city.last = now;
      const mirv = (perAttacker.get(s.peer)?.size ?? 0) >= MIRV_MIN;
      const color = s.flak ? C_FLAK : css(s.tag ? categorize([s.tag]).color : hashColor(s.proto));
      const delay = Math.min(3, Math.max(0, s.t - first));
      this.missiles.push({
        silo, city, lane: s.lane, label: `${this.shortName(s.city)} ${portSuffix(s.tag, s.proto)}`, color, flak: s.flak,
        rec: s.rec, t0: now + delay, dur, size: sizeOf(s.bytes), count: s.count, wall: s.t, info: s.info,
        via: mirv ? { x: 0, y: 0 } : null, x: 0, y: 0, outcome: null, done: false,
      });
    }
  }

  // ------------------------------------------------------------------ step

  private layout(dt: number): void {
    const top = this.barTop();
    const bottom = this.footTop() - this.log.height;
    this.geom = { top, siloY: top + HUD_H + SILO_H, cityY: bottom - 26, bottom };
    // silos pack left → right in arrival order
    const live = [...this.silos.values()].sort((a, b) => a.slot - b.slot);
    const usable = this.W - 60;
    const sp = clamp(usable / Math.max(1, live.length), 28, 170);
    const x0 = 30 + (usable - sp * live.length) / 2;
    live.forEach((s, i) => {
      const x = x0 + (i + 0.5) * sp;
      s.x = s.x < 0 ? x : s.x + (x - s.x) * Math.min(1, dt / 0.3);
    });
    // cities: address order, capacity from the width, the rest share a last slot
    const cap = Math.max(1, Math.floor((this.W - 40) / CITY_MIN_SPACING));
    const n = this.cityOrder.length;
    this.overflowCities = n > cap ? n - (cap - 1) : 0;
    const shown = this.overflowCities ? cap : n;
    const csp = clamp((this.W - 40) / Math.max(1, shown), CITY_MIN_SPACING, 160);
    const cx0 = 20 + ((this.W - 40) - csp * shown) / 2;
    this.cityOrder.forEach((c, i) => {
      c.overflow = this.overflowCities > 0 && i >= cap - 1;
      const x = cx0 + (Math.min(i, cap - 1) + 0.5) * csp;
      c.x = c.x < 0 ? x : c.x + (x - c.x) * Math.min(1, dt / 0.3);
      c.w = Math.min(c.w, csp - 6);
    });
  }

  protected step(now: number, dt: number): void {
    this.layout(dt);
    const { siloY, cityY } = this.geom;
    for (const m of this.missiles) {
      const p = (now - m.t0) / m.dur;
      if (p < 0) continue;
      const x0 = m.silo.x, y0 = siloY, x1 = m.city.x, y1 = cityY - 10;
      if (m.via) { m.via.x = x0 + (x1 - x0) * 0.35; m.via.y = y0 + (y1 - y0) * 0.35; }
      // decide the outcome when the missile is most of the way down: the reply window has nearly passed by then
      if (!m.outcome && p >= 0.8) {
        m.outcome = m.flak ? "flak" : m.rec.answered ? (m.rec.refused ? "refused" : "landed") : "dropped";
        if (m.outcome !== "landed") {
          const q = 0.8;
          const bx = x0 + (x1 - x0) * q, by = y0 + (y1 - y0) * q;
          if (m.outcome === "refused") { this.blasts.push({ x: bx, y: by, t0: now, dur: 0.5, r: 14 + m.size, color: C_REFUSED, fill: true }); m.city.refusedFlash = now; }
          else if (m.outcome === "dropped") this.blasts.push({ x: bx, y: by, t0: now, dur: 0.4, r: 6 + m.size * 0.5, color: C_DROPPED, fill: false });
          // flak just fades out
          this.settle(m, now);
          m.done = true;
          continue;
        }
      }
      const q = Math.min(1, p);
      m.x = x0 + (x1 - x0) * q; m.y = y0 + (y1 - y0) * q;
      if (p >= 1 && !m.done) {
        m.done = true;
        this.blasts.push({ x: m.x, y: m.y, t0: now, dur: 0.8, r: 22 + m.size * 2, color: MISS_RED, fill: true });
        m.city.flash = now;
        this.settle(m, now);
      }
    }
    this.missiles = this.missiles.filter((m) => !m.done);
    this.blasts = this.blasts.filter((b) => now - b.t0 < b.dur);
    this.log.expire(now);
    for (const [k, s] of this.silos) if (now - s.last > ROW_TTL_S && !this.missiles.some((m) => m.silo === s)) this.silos.delete(k);

    this.hover = null;
    const { x: px, y: py } = this.pointer;
    if (px >= 0) {
      if (Math.abs(py - (siloY - 10)) < 14) {
        for (const s of this.silos.values()) if (Math.abs(px - s.x) < 14) { this.hover = { ip: s.ip, text: `${this.nameOf(s.ip)} · ${rIp(s.ip)} · ${s.count} sent · ${s.landed} landed`, x: s.x, y: siloY + 16 }; break; }
      } else if (py > cityY - 30 && py < cityY + 40) {
        for (const c of this.cityOrder) {
          if (c.overflow || Math.abs(px - c.x) > Math.max(16, c.w / 2)) continue;
          const d = this.deviceAt(c.ip);
          this.hover = { ip: c.ip, city: true, text: `${this.nameOf(c.ip)} · ${d?.ports.length ?? 0} ports served · ${c.landed} landed · ${c.refused} refused · ${c.dropped} dropped`, x: c.x, y: cityY - 44 };
          break;
        }
      }
    }
    this.canvas.style.cursor = this.hover?.city ? "pointer" : "";
  }

  private settle(m: Missile, now: number): void {
    const o = m.outcome!;
    m.city[o] += m.count;
    this.stats[o] += m.count;
    if (o === "landed") m.silo.landed += m.count;
    if (o === "flak") return;
    const tail = o === "landed" ? `answered in ${Math.max(0, m.rec.answeredAt - m.rec.t).toFixed(2)} s` : o === "refused" ? "refused" : `no answer within ${REPLY_WINDOW_S} s`;
    this.log.push({
      key: `${m.silo.ip}|${m.city.ip}|${m.lane}|${o}`, t: now, wall: m.wall,
      mark: o === "landed" ? "↯" : o === "refused" ? "✕" : "·",
      markColor: o === "landed" ? MISS_RED : o === "refused" ? C_REFUSED : C_DROPPED,
      color: this.roleColor(m.silo.ip),
      head: `${this.nameOf(m.silo.ip)} → ${m.label}`,
      tail: `${m.info ? `${m.info.slice(0, 60)} · ` : ""}${tail}`,
    });
  }

  // ------------------------------------------------------------------ draw

  protected draw(now: number): void {
    const g = this.g, u = this.theme.ui, { top, siloY, cityY, bottom } = this.geom;
    g.textBaseline = "middle";

    // HUD
    g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("COMMAND", 16, top + 8);
    const s = this.stats;
    const parts: [string, string][] = [[`${s.landed}`, "landed"], [`${s.refused}`, "refused"], [`${s.dropped}`, "dropped"], [`${s.flak}`, "flak"]];
    let x = 16;
    for (const [n, label] of parts) {
      g.font = `600 14px ${this.font}`; g.fillStyle = label === "landed" && s.landed ? MISS_RED : label === "refused" && s.refused ? C_REFUSED : u.fg;
      g.fillText(n, x, top + 30); x += g.measureText(n).width + 5;
      g.font = `11px ${this.font}`; g.fillStyle = u.muted;
      g.fillText(label, x, top + 31); x += g.measureText(label).width + 16;
    }
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText(`${Math.round(this.pps)} pkt/s · ${this.silos.size} attacker${this.silos.size === 1 ? "" : "s"} · from ${this.attackerFilter === "any" ? "any peer" : this.attackerFilter === "lan" ? "the LAN" : "the internet"}`, 16, top + 48);
    g.textAlign = "right";
    g.font = `600 14px ${this.font}`; g.fillStyle = this.picker.isGroup ? this.roleCss("lan") : this.roleColor(this.picker.ip());
    g.fillText(this.picker.label((ip) => this.nameOf(ip)), this.W - 16, top + 30);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText(this.picker.isGroup ? `${this.cityOrder.length} cities · landed = the device answered a stranger` : "one city · shift-click a city to pick another, click to go back to the LAN", this.W - 16, top + 48);

    // silos: attackers along the top edge
    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([2, 6]);
    g.beginPath(); g.moveTo(16, siloY); g.lineTo(this.W - 16, siloY); g.stroke();
    g.setLineDash([]);
    const silos = [...this.silos.values()].sort((a, b) => a.x - b.x);
    const sp = silos.length > 1 ? silos[1].x - silos[0].x : 170;
    silos.forEach((si, i) => {
      g.globalAlpha = fade(now, si.last);
      const color = this.roleColor(si.ip);
      g.fillStyle = color;
      g.beginPath(); g.moveTo(si.x - 6, siloY - 1); g.lineTo(si.x + 6, siloY - 1); g.lineTo(si.x, siloY - 8); g.closePath(); g.fill();
      g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = this.hover?.ip === si.ip ? u.accent : u.fg;
      g.fillText(fitText(g, this.shortName(si.ip), Math.max(40, sp * 2 - 8)), si.x, siloY - 18 - (i % 2) * 12);
      g.globalAlpha = 1;
    });

    // missiles: trail from the silo (via the warhead split) to the head
    for (const m of this.missiles) {
      if (now < m.t0) continue;
      g.globalAlpha = m.flak ? 0.3 : 0.9;
      g.strokeStyle = m.color; g.lineWidth = m.flak ? 1 : Math.max(1, m.size * 0.3);
      g.beginPath(); g.moveTo(m.silo.x, siloY);
      if (m.via) {
        // the head has not passed the split yet: the trail is the shared stem only
        const stem = Math.hypot(m.via.x - m.silo.x, m.via.y - siloY), full = stem + Math.hypot(m.city.x - m.via.x, cityY - 10 - m.via.y);
        const p = Math.min(1, (now - m.t0) / m.dur);
        if (p * full <= stem) {
          const q = (p * full) / stem;
          m.x = m.silo.x + (m.via.x - m.silo.x) * q; m.y = siloY + (m.via.y - siloY) * q;
          g.lineTo(m.x, m.y);
        } else {
          const q = (p * full - stem) / (full - stem);
          m.x = m.via.x + (m.city.x - m.via.x) * q; m.y = m.via.y + (cityY - 10 - m.via.y) * q;
          g.lineTo(m.via.x, m.via.y); g.lineTo(m.x, m.y);
        }
      } else g.lineTo(m.x, m.y);
      g.stroke();
      g.fillStyle = m.flak ? m.color : u.fg;
      g.beginPath(); g.arc(m.x, m.y, m.flak ? 1.5 : Math.max(2, m.size * 0.45), 0, Math.PI * 2); g.fill();
      if (m.count >= 3 && !m.flak) {
        g.font = `10px ${this.font}`; g.fillStyle = u.fg; g.textAlign = "left";
        g.fillText(`×${m.count}`, m.x + 6, m.y - 6);
      }
    }
    g.globalAlpha = 1;
    for (const b of this.blasts) {
      const p = (now - b.t0) / b.dur;
      const r = b.fill ? b.r * Math.sin(p * Math.PI) : 2 + b.r * p;
      g.globalAlpha = b.fill ? 0.75 : (1 - p) * 0.7;
      if (b.fill) { g.fillStyle = b.color; g.beginPath(); g.arc(b.x, b.y, Math.max(0, r), 0, Math.PI * 2); g.fill(); }
      else { g.strokeStyle = b.color; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.stroke(); }
    }
    g.globalAlpha = 1;

    // ground and cities
    g.strokeStyle = u.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(16, cityY + 10); g.lineTo(this.W - 16, cityY + 10); g.stroke();
    let overflowDrawn = false;
    const csp = this.cityOrder.length > 1 ? Math.abs(this.cityOrder[1].x - this.cityOrder[0].x) : 160;
    this.cityOrder.forEach((c, i) => {
      if (c.overflow) {
        if (overflowDrawn) return;
        overflowDrawn = true;
        g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(`… ${this.overflowCities} more`, c.x, cityY);
        return;
      }
      const d = this.deviceAt(c.ip);
      const color = d?.role === "lan" ? css(hashColor(c.ip)) : this.roleColor(c.ip);
      const hit = now - c.flash < 0.5, refused = now - c.refusedFlash < 0.4;
      const h = 10 + Math.min(14, (d?.ports.length ?? 0) * 1.5);
      if (d?.role === "gateway") {
        // the central base: a pyramid
        g.fillStyle = hit ? MISS_RED : color;
        g.beginPath(); g.moveTo(c.x - c.w / 2, cityY + 10); g.lineTo(c.x + c.w / 2, cityY + 10); g.lineTo(c.x, cityY - h - 4); g.closePath(); g.fill();
      } else {
        // a skyline: a few blocks, taller when it serves more ports
        g.fillStyle = hit ? MISS_RED : color;
        const bw = Math.max(4, (c.w - 4) / 3);
        for (let k = 0; k < 3; k++) {
          const bh = h * (k === 1 ? 1 : 0.6 + 0.25 * ((c.ip.charCodeAt(c.ip.length - 1 - k) || 0) % 2));
          g.fillRect(c.x - c.w / 2 + k * (bw + 2), cityY + 10 - bh, bw, bh);
        }
      }
      if (refused) { g.strokeStyle = C_REFUSED; g.lineWidth = 1.5; g.globalAlpha = 0.8; roundRect(g, c.x - c.w / 2 - 3, cityY - h - 6, c.w + 6, h + 16, 3); g.stroke(); g.globalAlpha = 1; }
      g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = this.hover?.ip === c.ip ? u.accent : c.landed ? u.fg : u.muted;
      g.fillText(fitText(g, this.shortName(c.ip), Math.max(36, csp * 2 - 8)), c.x, cityY + 22 + (i % 2) * 12);
      if (c.landed) { g.font = `10px ${this.font}`; g.fillStyle = MISS_RED; g.fillText(`${c.landed}↯`, c.x, cityY - h - 12); }
    });

    if (!this.missiles.length && this.lastT && !this.log.lines.length) this.drawIdle(now, `nothing unsolicited for ${this.picker.label((ip) => this.nameOf(ip))} in the last few seconds`, this.W / 2, (siloY + cityY) / 2);
    else if (!this.lastT) this.drawIdle(now, "waiting for packets…", this.W / 2, (siloY + cityY) / 2);

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
