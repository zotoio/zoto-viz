import type { NetScene } from "../graph/scene";
import { readArcadeKnob } from "../core/arcade-knob";
import { Select } from "../ui/ui";
import { categorize, hashColor, orgOf } from "../core/modes";
import { rName } from "../core/redact";
import { fmtBytes, type Packet } from "../core/types";
import { ArcadeView, DevicePicker, MISS_RED, ROW_TTL_S, clamp, css, fade, fitText, isKnown, sizeOf, sprite } from "./arcade";
import { arcadeHudRate, type ArcadeIdleShaper } from "./arcade-idle-feed";
import { shapeInvadersIdle } from "./arcade-idle-shapers";

/**
 * Invaders: who is pulling data down, and what is going up.
 *
 * The formation is made of internet organisations: one row per organisation (registrable domain of the hosts'
 * names, CDN families folded), one alien per host. Rows rank by the inbound bytes of the last ~30 s and the
 * busiest sits lowest, closest to the cannons: the organisation pulling the most data at you is the one about
 * to land. The formation marches left and right in step with the packet rate. Cannons along the bottom are the
 * LAN devices; every outbound packet is a shot from its cannon up to the alien it is for, every inbound packet a
 * bomb falling from the alien onto the device receiving it, so upload / download asymmetry per device is the
 * shape of the fire: a backup agent is a cannon on rapid fire with nothing coming back, a TV streaming is one
 * row raining bombs on one cannon. A saucer crosses the top when something deserves a look: a plaintext
 * protocol to the internet, or a device that just appeared on the network.
 */

const FLIGHT_S = 1.6;
const VOL_DECAY_S = 30;
const ROW_MOVE_S = 0.4;
const ROW_H = 34;
const ALIEN_W = 30;
const HUD_H = 58;
const LABEL_W = 230;           // room for the row label left of the formation
const MAX_PER_POLL = 48;
const CANNON_H = 62;           // cannon sprite + two label rows
const UFO_S = 7;
const KEY_CANNONS = "zoto-viz.invaders.cannons";
const KEY_SPEED = "zoto-viz.invaders.speed";
const C_NEW = "#ffa726";

const ALIEN_A = ["..#.....#..", "...#...#...", "..#######..", ".##.###.##.", "###########", "#.#######.#", "#.#.....#.#", "...##.##..."];
const ALIEN_B = ["..#.....#..", "#..#...#..#", "#.#######.#", "###.###.###", "###########", ".#########.", "..#.....#..", ".#.......#."];
const CANNON = ["......#......", ".....###.....", ".....###.....", ".###########.", "#############", "#############", "#############"];
const UFO = ["......####......", "....########....", "..############..", ".##.##.##.##.##.", "################", "...###....###..."];

interface Alien { ip: string; last: number; vol: number; x: number; y: number; flash: number; down: number; up: number }
interface Row { name: string; color: string; aliens: Map<string, Alien>; vol: number; inRate: number; outRate: number; inPoll: number; outPoll: number; rank: number; y: number; last: number; slot: number }
interface Cannon { ip: string; slot: number; x: number; last: number; up: number; down: number; glow: number; hit: number; color: string }
interface Shot { kind: "shot" | "bomb"; cannon: Cannon; alien: Alien; row: Row; t0: number; dur: number; size: number; count: number; x: number; y: number; done: boolean }
interface Ufo { key: string; label: string; color: string; t0: number }
interface Burst { x: number; y: number; t0: number; color: string; r: number }

export class InvadersView extends ArcadeView {
  readonly controls: HTMLElement[];
  private readonly picker: DevicePicker;
  private readonly speedSel: Select;
  private rows = new Map<string, Row>();
  private cannons = new Map<string, Cannon>();
  private shots: Shot[] = [];
  private ufos: Ufo[] = [];
  private bursts: Burst[] = [];
  private ufoSeen = new Map<string, number>();
  /** devices present when the session started: anything else that shows up is "new" */
  private baseline: Set<string> | null = null;
  private march = { x: 0, dir: 1, acc: 0, frame: 0 };
  private stats = { up: 0, down: 0, shots: 0, bombs: 0 };
  private rowSlot = 0;
  private hover: { text: string; x: number; y: number; ip?: string; cannon?: boolean } | null = null;
  private geom = { top: 0, bottom: 0, formTop: 0, formBottom: 0, cannonY: 0, maxRows: 1, maxPerRow: 1 };
  private overflowRows = 0;

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.picker = new DevicePicker({
      id: "invCannons", caption: "cannons", key: KEY_CANNONS,
      title: "whose traffic is shown: every LAN device as a cannon, or one device",
      group: { label: "LAN", hint: "this host, the gateway, LAN and local devices" },
      onChange: () => this.resync(),
    }, scene);
    this.speedSel = new Select({
      caption: "speed", title: "how fast shots and bombs travel",
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

  protected override onSnapshot(): void {
    const m = this.msg;
    if (!m) return;
    this.picker.update(m);
    // a device that appears after the session began is announced by the saucer
    const known = m.devices.filter((d) => d.role === "lan" || d.role === "local");
    if (!this.baseline) this.baseline = new Set(known.map((d) => d.ip));
    else {
      for (const d of known) {
        if (this.baseline.has(d.ip)) continue;
        this.baseline.add(d.ip);
        if (m.ts - d.first_seen < 300) this.ufo(`new|${d.ip}`, `new device · ${this.nameOf(d.ip)}`, C_NEW);
      }
    }
  }

  protected override onClick(e: MouseEvent): void {
    if (!this.hover?.ip) return;
    if (this.hover.cannon) this.picker.set(this.picker.isGroup || e.shiftKey ? this.hover.ip : "lan");
  }

  protected override idleShaper(): ArcadeIdleShaper<Packet> { return shapeInvadersIdle; }
  protected override idleMe(): string { return this.picker.isGroup ? "" : this.picker.ip(); }

  protected query(): { ip: string } | null {
    const ip = this.picker.token();
    return ip ? { ip } : null;
  }

  protected override reset(): void {
    super.reset();
    this.rows.clear(); this.cannons.clear();
    this.shots = []; this.bursts = [];
    this.stats = { up: 0, down: 0, shots: 0, bombs: 0 };
    this.rowSlot = 0;
  }

  private ufo(key: string, label: string, color: string): void {
    const now = performance.now() / 1000;
    const last = this.ufoSeen.get(key);
    if (last !== undefined && now - last < 60) return;
    this.ufoSeen.set(key, now);
    // one saucer at a time on screen; the next queues behind it
    const tail = this.ufos.length ? this.ufos[this.ufos.length - 1].t0 + UFO_S * 0.7 : now;
    this.ufos.push({ key, label, color, t0: Math.max(now, tail) });
  }

  // ------------------------------------------------------------------ data

  protected ingest(fresh: Packet[], first: number): void {
    const group = this.picker.isGroup;
    const me = this.picker.ip();
    interface Spawn { kind: "shot" | "bomb"; cannon: string; peer: string; t: number; bytes: number; count: number }
    let spawns: Spawn[] = [];
    for (const p of fresh) {
      const [t, dir, rawPeer, , tag, size, , , , member] = p;
      const peer = this.scene.resolve(rawPeer);
      const dev = this.deviceAt(peer);
      if (dev?.role !== "internet") continue;
      const cannon = group ? this.scene.resolve(member ?? "") : me;
      if (!cannon) continue;
      spawns.push({ kind: dir === "out" ? "shot" : "bomb", cannon, peer, t, bytes: size, count: 1 });
      if (tag && categorize([tag]).id === "plain") this.ufo(`plain|${cannon}|${peer}|${tag}`, `plaintext ${tag} · ${this.shortName(cannon)} → ${this.nameOf(peer)}`, MISS_RED);
    }
    if (!spawns.length) return;
    if (spawns.length > MAX_PER_POLL) {
      const grouped = new Map<string, Spawn>();
      for (const s of spawns) {
        const k = `${s.kind}|${s.cannon}|${s.peer}`;
        const e = grouped.get(k);
        if (e) { e.bytes += s.bytes; e.count++; } else grouped.set(k, { ...s });
      }
      spawns = [...grouped.values()];
      if (spawns.length > MAX_PER_POLL) spawns = spawns.sort((a, b) => b.bytes - a.bytes).slice(0, MAX_PER_POLL);
      spawns.sort((a, b) => a.t - b.t);
    }

    const now = performance.now() / 1000;
    const dur = FLIGHT_S / this.speed;
    for (const r of this.rows.values()) { r.inPoll = 0; r.outPoll = 0; }
    for (const s of spawns) {
      const org = orgOf(this.deviceAt(s.peer)!);
      let row = this.rows.get(org);
      if (!row) {
        row = { name: org, color: css(hashColor(org)), aliens: new Map(), vol: 0, inRate: 0, outRate: 0, inPoll: 0, outPoll: 0, rank: -1, y: 0, last: now, slot: this.rowSlot++ };
        this.rows.set(org, row);
      }
      row.last = now;
      let alien = row.aliens.get(s.peer);
      if (!alien) { alien = { ip: s.peer, last: now, vol: 0, x: 0, y: 0, flash: -1, down: 0, up: 0 }; row.aliens.set(s.peer, alien); }
      alien.last = now;
      let cannon = this.cannons.get(s.cannon);
      if (!cannon) {
        const used = new Set([...this.cannons.values()].map((c) => c.slot));
        let slot = 0; while (used.has(slot)) slot++;
        cannon = { ip: s.cannon, slot, x: -1, last: now, up: 0, down: 0, glow: 0, hit: 0, color: this.cannonColor(s.cannon) };
        this.cannons.set(s.cannon, cannon);
      }
      cannon.last = now;
      if (s.kind === "bomb") { row.vol += s.bytes; alien.vol += s.bytes; row.inPoll += s.bytes; alien.down += s.bytes; cannon.down += s.bytes; this.stats.down += s.bytes; this.stats.bombs += s.count; }
      else { row.outPoll += s.bytes; alien.up += s.bytes; cannon.up += s.bytes; this.stats.up += s.bytes; this.stats.shots += s.count; alien.vol += s.bytes * 0.1; }
      const delay = Math.min(3, Math.max(0, s.t - first));
      this.shots.push({ kind: s.kind, cannon, alien, row, t0: now + delay, dur, size: sizeOf(s.bytes), count: s.count, x: 0, y: 0, done: false });
    }
    for (const r of this.rows.values()) { r.inRate = r.inRate * 0.6 + r.inPoll * 0.4; r.outRate = r.outRate * 0.6 + r.outPoll * 0.4; }
  }

  private cannonColor(ip: string): string {
    const d = this.deviceAt(ip);
    if (d && (d.role === "gateway" || d.role === "self" || d.role === "local")) return this.roleCss(d.role);
    return css(hashColor(ip));
  }

  // ------------------------------------------------------------------ step

  private layout(dt: number): void {
    const top = this.barTop(), bottom = this.footTop();
    const formTop = top + HUD_H + 8;
    const cannonY = bottom - CANNON_H + 14;
    const formBottom = formTop + Math.max(ROW_H, (cannonY - 40 - formTop) * 0.8);
    this.geom = {
      top, bottom, formTop, formBottom, cannonY,
      maxRows: Math.max(1, Math.floor((formBottom - formTop) / ROW_H)),
      maxPerRow: Math.max(2, Math.min(16, Math.floor((this.W - 2 * LABEL_W) / ALIEN_W))),
    };
    // rows: busiest lowest; overflow shares the top line
    const decay = Math.exp(-dt / VOL_DECAY_S);
    const ranked = [...this.rows.values()].sort((a, b) => b.vol - a.vol || a.slot - b.slot);
    this.overflowRows = Math.max(0, ranked.length - (this.geom.maxRows - 1));
    if (this.overflowRows === 1) this.overflowRows = 0;
    const k = Math.min(1, dt / ROW_MOVE_S);
    ranked.forEach((r, i) => {
      r.vol *= decay;
      r.rank = i;
      const y = formBottom - ROW_H / 2 - Math.min(i, Math.max(0, this.geom.maxRows - 1)) * ROW_H;
      r.y = r.y === 0 ? y : r.y + (y - r.y) * k;
      // aliens: busiest first, centred on the marching formation
      const list = [...r.aliens.values()].sort((a, b) => b.vol - a.vol || a.ip.localeCompare(b.ip));
      const n = Math.min(list.length, this.geom.maxPerRow);
      list.forEach((a, j) => {
        a.vol *= decay;
        const jj = Math.min(j, n - 1);
        const x = this.W / 2 + this.march.x + (jj - (n - 1) / 2) * ALIEN_W;
        a.x = a.x === 0 ? x : a.x + (x - a.x) * Math.min(1, dt / 0.15);
        a.y = r.y;
      });
    });
    // cannons pack left → right in arrival order and glide when one leaves
    const live = [...this.cannons.values()].sort((a, b) => a.slot - b.slot);
    const usable = this.W - 40;
    const spacing = clamp(usable / Math.max(1, live.length), 34, 150);
    const x0 = 20 + (usable - spacing * live.length) / 2;
    live.forEach((c, i) => {
      const x = x0 + (i + 0.5) * spacing;
      c.x = c.x < 0 ? x : c.x + (x - c.x) * Math.min(1, dt / 0.3);
    });
  }

  private isOverflowRow(r: Row): boolean { return this.overflowRows > 0 && r.rank >= this.geom.maxRows - 1; }

  protected step(now: number, dt: number): void {
    // the formation marches in steps whose beat follows the packet rate
    const beat = clamp(1.1 - this.pps / 120, 0.12, 1.1);
    this.march.acc += dt;
    if (this.march.acc >= beat) {
      this.march.acc = 0;
      this.march.frame ^= 1;
      const widest = Math.max(1, ...[...this.rows.values()].map((r) => Math.min(r.aliens.size, this.geom.maxPerRow))) * ALIEN_W;
      const amp = Math.max(24, (this.W - widest) / 2 - LABEL_W - 20);
      this.march.x += this.march.dir * 10;
      if (Math.abs(this.march.x) > amp) { this.march.dir *= -1; this.march.x = Math.sign(this.march.x) * amp; }
    }
    this.layout(dt);

    for (const s of this.shots) {
      const p = (now - s.t0) / s.dur;
      if (p < 0) continue;
      const [x0, y0, x1, y1] = s.kind === "shot" ? [s.cannon.x, this.geom.cannonY - 14, s.alien.x, s.alien.y] : [s.alien.x, s.alien.y + 8, s.cannon.x, this.geom.cannonY - 10];
      const q = Math.min(1, p);
      s.x = x0 + (x1 - x0) * q; s.y = y0 + (y1 - y0) * q;
      if (p >= 1 && !s.done) {
        s.done = true;
        if (s.kind === "shot") { s.alien.flash = now; s.cannon.glow = 1; }
        else { s.cannon.hit = now; if (s.size > 6) this.bursts.push({ x: s.x, y: s.y, t0: now, color: s.row.color, r: s.size * 3 }); }
      }
    }
    this.shots = this.shots.filter((s) => !s.done);
    this.bursts = this.bursts.filter((b) => now - b.t0 < 0.45);
    this.ufos = this.ufos.filter((u) => now - u.t0 < UFO_S);
    for (const c of this.cannons.values()) c.glow = Math.max(0, c.glow - dt * 4);

    const inUse = (ip: string) => this.shots.some((s) => s.cannon.ip === ip || s.alien.ip === ip);
    for (const [k, c] of this.cannons) if (now - c.last > ROW_TTL_S && !inUse(k)) this.cannons.delete(k);
    for (const [k, r] of this.rows) {
      for (const [ip, a] of r.aliens) if (now - a.last > ROW_TTL_S && !inUse(ip)) r.aliens.delete(ip);
      if (!r.aliens.size && now - r.last > ROW_TTL_S) this.rows.delete(k);
    }

    // hover: an alien or a cannon
    this.hover = null;
    const { x: px, y: py } = this.pointer;
    if (px >= 0) {
      for (const r of this.rows.values()) {
        if (this.isOverflowRow(r) || Math.abs(py - r.y) > ROW_H / 2) continue;
        for (const a of r.aliens.values()) {
          if (Math.abs(px - a.x) < ALIEN_W / 2) { this.hover = { ip: a.ip, text: `${this.nameOf(a.ip)} · ↓ ${fmtBytes(a.down)} ↑ ${fmtBytes(a.up)}`, x: a.x, y: a.y - 22 }; break; }
        }
        if (this.hover) break;
      }
      if (!this.hover && Math.abs(py - this.geom.cannonY) < 30) {
        for (const c of this.cannons.values()) {
          if (Math.abs(px - c.x) < 18) { this.hover = { ip: c.ip, cannon: true, text: `${this.nameOf(c.ip)} · ↑ ${fmtBytes(c.up)} ↓ ${fmtBytes(c.down)}`, x: c.x, y: this.geom.cannonY - 30 }; break; }
        }
      }
    }
    this.canvas.style.cursor = this.hover?.cannon ? "pointer" : "";
  }

  // ------------------------------------------------------------------ draw

  protected draw(now: number): void {
    const g = this.g, u = this.theme.ui, { top, formTop, formBottom, cannonY } = this.geom;
    g.textBaseline = "middle";

    // HUD: arcade score line
    g.textAlign = "left"; g.font = `10px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("INVADERS", 16, top + 8);
    g.font = `600 14px ${this.font}`; g.fillStyle = u.fg;
    g.fillText(`↓ ${fmtBytes(this.stats.down)}`, 16, top + 30);
    const w1 = g.measureText(`↓ ${fmtBytes(this.stats.down)}`).width;
    g.fillStyle = u.muted; g.font = `11px ${this.font}`; g.fillText("landed", 16 + w1 + 6, top + 31);
    const x2 = 16 + w1 + 6 + g.measureText("landed").width + 18;
    g.font = `600 14px ${this.font}`; g.fillStyle = u.fg;
    g.fillText(`↑ ${fmtBytes(this.stats.up)}`, x2, top + 30);
    const w2 = g.measureText(`↑ ${fmtBytes(this.stats.up)}`).width;
    g.fillStyle = u.muted; g.font = `11px ${this.font}`; g.fillText("fired", x2 + w2 + 6, top + 31);
    let hosts = 0; for (const r of this.rows.values()) hosts += r.aliens.size;
    g.fillText(`${arcadeHudRate(this.pps, this.idleShowing)} · ${this.rows.size} organisation${this.rows.size === 1 ? "" : "s"} · ${hosts} host${hosts === 1 ? "" : "s"} · ${this.cannons.size} cannon${this.cannons.size === 1 ? "" : "s"}`, 16, top + 48);
    g.textAlign = "right";
    g.font = `600 14px ${this.font}`; g.fillStyle = this.picker.isGroup ? this.roleCss("lan") : this.cannonColor(this.picker.ip());
    g.fillText(this.picker.label((ip) => this.nameOf(ip)), this.W - 16, top + 30);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText(this.picker.isGroup ? `${this.picker.count()} devices · internet peers as the formation` : "one device · click a cannon with shift to pick another, without to go back to the LAN", this.W - 16, top + 48);

    // saucer lane
    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([2, 6]);
    g.beginPath(); g.moveTo(16, formTop - 4); g.lineTo(this.W - 16, formTop - 4); g.stroke();
    g.setLineDash([]);
    for (const uf of this.ufos) {
      const p = (now - uf.t0) / UFO_S;
      if (p < 0) continue;
      const x = this.W + 60 - p * (this.W + 120), y = formTop - 4 - 12;
      sprite(g, UFO, x, y, 2, uf.color);
      g.textAlign = "left"; g.font = `11px ${this.font}`; g.fillStyle = uf.color;
      g.fillText(rName(uf.label), x + 22, y);
    }

    // formation rows
    const bitmap = this.march.frame ? ALIEN_B : ALIEN_A;
    let overflowDrawn = false;
    for (const r of [...this.rows.values()].sort((a, b) => a.rank - b.rank)) {
      if (this.isOverflowRow(r)) {
        if (overflowDrawn) continue;
        overflowDrawn = true;
        g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = u.muted; g.globalAlpha = 0.8;
        g.fillText(`… ${this.overflowRows} more organisations`, this.W / 2 + this.march.x, r.y);
        g.globalAlpha = 1;
        continue;
      }
      const alpha = fade(now, r.last);
      const list = [...r.aliens.values()].sort((a, b) => b.vol - a.vol || a.ip.localeCompare(b.ip));
      const n = Math.min(list.length, this.geom.maxPerRow);
      list.slice(0, n).forEach((a, j) => {
        const flashing = now - a.flash < 0.25;
        g.globalAlpha = alpha * fade(now, a.last);
        if (j === n - 1 && list.length > n) {
          g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = r.color;
          g.fillText(`+${list.length - n + 1}`, a.x, a.y);
        } else {
          sprite(g, bitmap, a.x, a.y, 2, flashing ? u.fg : r.color);
        }
      });
      g.globalAlpha = alpha;
      // label left of the row: organisation, host count, current rates
      const left = this.W / 2 + this.march.x - (n / 2) * ALIEN_W - 12;
      g.textAlign = "right";
      g.font = `600 12px ${this.font}`; g.fillStyle = r.color;
      const name = fitText(g, rName(r.name), LABEL_W - 90);
      const rates = `↓${fmtBytes(r.inRate, true)} ↑${fmtBytes(r.outRate, true)}`;
      g.font = `10.5px ${this.font}`;
      const rw = g.measureText(rates).width;
      g.fillStyle = u.muted; g.fillText(rates, left, r.y + 1);
      g.font = `600 12px ${this.font}`; g.fillStyle = r.color;
      g.fillText(name, left - rw - 8, r.y + 1);
      g.globalAlpha = 1;
    }
    const seen = this.lastT || this.idleShowing;
    if (!this.rows.size && seen) this.drawIdle(now, `no internet traffic for ${this.picker.label((ip) => this.nameOf(ip))} in the last few seconds`, this.W / 2, (formTop + formBottom) / 2);
    else if (!seen) this.drawIdle(now, "waiting for packets…", this.W / 2, (formTop + formBottom) / 2);

    // shots and bombs
    for (const s of this.shots) {
      if (now < s.t0) continue;
      const len = 4 + s.size * 1.6;
      if (s.kind === "shot") {
        g.strokeStyle = s.cannon.color; g.lineWidth = Math.max(1.5, s.size * 0.5); g.lineCap = "round";
        const dx = s.alien.x - s.cannon.x, dy = s.alien.y - (cannonY - 14), l = Math.hypot(dx, dy) || 1;
        g.beginPath(); g.moveTo(s.x - (dx / l) * len, s.y - (dy / l) * len); g.lineTo(s.x, s.y); g.stroke();
      } else {
        // a bomb zigzags down
        g.strokeStyle = s.row.color; g.lineWidth = Math.max(1.5, s.size * 0.45); g.lineJoin = "round";
        const z = 3;
        g.beginPath();
        g.moveTo(s.x - z, s.y - len); g.lineTo(s.x + z, s.y - len * 0.66); g.lineTo(s.x - z, s.y - len * 0.33); g.lineTo(s.x + z, s.y);
        g.stroke();
      }
      if (s.count >= 3) {
        g.font = `10px ${this.font}`; g.fillStyle = u.fg; g.textAlign = "left";
        g.fillText(`×${s.count}`, s.x + 6, s.y - 6);
      }
    }
    g.lineCap = "butt";
    for (const b of this.bursts) {
      const p = (now - b.t0) / 0.45;
      g.globalAlpha = (1 - p) * 0.8; g.strokeStyle = b.color; g.lineWidth = 2;
      g.beginPath(); g.arc(b.x, b.y, 3 + p * b.r, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;

    // ground and cannons
    g.strokeStyle = u.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(16, cannonY + 12); g.lineTo(this.W - 16, cannonY + 12); g.stroke();
    const live = [...this.cannons.values()].sort((a, b) => a.x - b.x);
    live.forEach((c, i) => {
      const alpha = fade(now, c.last);
      g.globalAlpha = alpha;
      const hit = now - c.hit < 0.3;
      if (c.glow > 0) { g.save(); g.shadowColor = c.color; g.shadowBlur = 16 * c.glow; }
      sprite(g, CANNON, c.x, cannonY, 2, hit ? MISS_RED : c.color);
      if (c.glow > 0) g.restore();
      // label rows alternate so neighbours do not collide
      const spacing = live.length > 1 ? Math.abs(live[1].x - live[0].x) : 150;
      const maxW = live.length > 1 ? spacing * 2 - 8 : 200;
      g.textAlign = "center"; g.font = `11px ${this.font}`; g.fillStyle = this.hover?.ip === c.ip ? u.accent : u.fg;
      g.fillText(fitText(g, this.shortName(c.ip), maxW), c.x, cannonY + 24 + (i % 2) * 13);
    });
    g.globalAlpha = 1;

    if (this.hover) {
      g.font = `11px ${this.font}`;
      const tw = g.measureText(this.hover.text).width + 14;
      const x = clamp(this.hover.x - tw / 2, 8, this.W - tw - 8), y = this.hover.y;
      g.fillStyle = u.panel; g.strokeStyle = u.lineStrong;
      g.beginPath(); g.roundRect(x, y - 10, tw, 20, 5); g.fill(); g.stroke();
      g.fillStyle = u.fg; g.textAlign = "left"; g.fillText(this.hover.text, x + 7, y + 1);
    }
  }
}
