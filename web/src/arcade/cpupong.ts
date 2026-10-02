import type { NetScene } from "../graph/scene";
import { readArcadeKnob } from "../core/arcade-knob";
import { Select } from "../ui/ui";
import { CPU_RED, cpuHeat, hashColor } from "../core/modes";
import { displayName, type Device, type Packet, type Role } from "../core/types";
import {
  ArcadeView, FadeLog, MISS_RED, ROW_TTL_S, clamp, css, drawRings, fade, fitText, roundRect, type Ring,
} from "./arcade";

/**
 * CPU Pong: Logstalgia for this host's scheduler.
 *
 * Processes on the left, logical CPUs on the right. Each sample (~1 Hz) of a process that still has CPU
 * is a ball from that process to the core it last ran on. The paddle (the kernel) returns it unless that
 * core is over 80%; then the ball passes through in red.
 *
 * Under load the paddle splits: one half covers the upper cores, the other the lower cores.
 * Under high load each half fires lasers at busy balls in its own cores that it cannot cover
 * in time — balls aimed at cores over 80% still pass through.
 */

const FLIGHT_S = 2.2;
const ROW_H = 20;
const LEFT_W = 240;
const RIGHT_W = 220;
const CAPTION_H = 26;
const HUD_H = 72;
const PADDLE_W = 8, PADDLE_H = 48;
const PADDLE_MARGIN = 0.7;
const PADDLE_SPEED = 1700;
const SPLIT_LOAD = 40;
const LASER_LOAD = 64;
const LASER_CD = 0.11;
const LASER_DUR = 0.055;
const MAX_BALLS = 36;
const KEY_WHO = "zoto-viz.cpupong.who";
const KEY_MIN = "zoto-viz.cpupong.min";
const KEY_GROUP = "zoto-viz.cpupong.group";
const KEY_SPEED = "zoto-viz.cpupong.speed";

interface Rec { answered: boolean }
interface Row { id: string; label: string; sub: string; last: number; y: number; color: string; cpu: number; vol: number; rank: number }
interface Lane extends Row { hits: number; misses: number; flash: number }
interface Ball {
  rec: Rec; src: Row; lane: Lane; t0: number; dur: number; r: number; color: string;
  wall: number; info: string; phase: "fly" | "bounce" | "miss";
  x: number; y: number; vx: number; vy: number; age: number; locked: boolean;
}
interface Bat { y: number; vy: number; glow: number }
interface Beam { bat: Bat; ball: Ball; t0: number; dur: number }
interface Proc {
  id: string; name: string; cpu: number; core: string; role: Role; n: number;
}

function cpuNameId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `proc:name:${slug || "proc"}`;
}

export class CpuPongView extends ArcadeView {
  readonly controls: HTMLElement[];
  private readonly whoSel: Select;
  private readonly minSel: Select;
  private readonly groupSel: Select;
  private readonly speedSel: Select;
  private procs = new Map<string, Row>();
  private cores = new Map<string, Lane>();
  private balls: Ball[] = [];
  private rings: Ring[] = [];
  private log = new FadeLog(5, "OVER 80%", "none in the last few seconds");
  private bats: [Bat, Bat] = [{ y: -1, vy: 0, glow: 0 }, { y: -1, vy: 0, glow: 0 }];
  private splitT = 0;
  private beams: Beam[] = [];
  private laserCd = 0;
  private stats = { hits: 0, misses: 0, slices: 0, zaps: 0 };
  private hostPct = 0;
  private hostName = "host";
  private snapTs = -1;
  private geom = { top: 0, bottom: 0, xL: 0, xP: 0, maxLeft: 1, maxRight: 1 };

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.whoSel = new Select({
      caption: "who", title: "which processes to show",
      options: [{ value: "all", label: "everyone" }, { value: "mine", label: "this user" }, { value: "kernel", label: "kernel" }],
      value: readArcadeKnob(KEY_WHO, "all"),
      onChange: (v) => { localStorage.setItem(KEY_WHO, v); this.resync(); },
    });
    this.minSel = new Select({
      caption: "at least", title: "drop processes below this CPU share (percent of one core)",
      options: [{ value: "0.5", label: "0.5%" }, { value: "1", label: "1%" }, { value: "5", label: "5%" }, { value: "10", label: "10%" }],
      value: readArcadeKnob(KEY_MIN, "0.5"),
      onChange: (v) => { localStorage.setItem(KEY_MIN, v); this.resync(); },
    });
    this.groupSel = new Select({
      caption: "group", title: "one row per PID, or fold threads that share a name",
      options: [{ value: "each", label: "each process" }, { value: "name", label: "by name" }],
      value: readArcadeKnob(KEY_GROUP, "name"),
      onChange: (v) => { localStorage.setItem(KEY_GROUP, v); this.resync(); },
    });
    this.speedSel = new Select({
      caption: "speed", title: "how fast the balls cross the screen",
      options: [{ value: "0.5", label: "slow" }, { value: "1", label: "normal" }, { value: "2", label: "fast" }],
      value: readArcadeKnob(KEY_SPEED, "1"),
      onChange: (v) => localStorage.setItem(KEY_SPEED, v),
    });
    this.controls = [this.whoSel.el, this.minSel.el, this.groupSel.el, this.speedSel.el];
  }

  protected override useTraffic(): boolean { return false; }
  protected query(): { ip: string } | null { return { ip: "cpu" }; }
  protected ingest(_fresh: Packet[], _first: number, _newest: number): void { /* snapshot-fed */ }
  protected override variant(): string {
    return `${this.whoSel.value}\u0001${this.minSel.value}\u0001${this.groupSel.value}`;
  }

  private get speed(): number { return Number(this.speedSel.value) || 1; }

  protected override reset(): void {
    super.reset();
    this.procs.clear(); this.cores.clear();
    this.balls = []; this.rings = [];
    this.log.clear();
    this.stats = { hits: 0, misses: 0, slices: 0, zaps: 0 };
    this.bats = [{ y: -1, vy: 0, glow: 0 }, { y: -1, vy: 0, glow: 0 }];
    this.splitT = 0; this.beams = []; this.laserCd = 0;
    this.snapTs = -1;
  }

  protected override onSnapshot(): void {
    const view = this.msg?.views?.cpu;
    if (!view || !this.running) return;
    const wall = this.msg?.ts ?? 0;
    if (wall === this.snapTs) return;
    this.snapTs = wall;
    const now = performance.now() / 1000;
    const host = view.devices.find((d) => d.ip === "cpu:host");
    this.hostPct = host?.cpu ?? 0;
    this.hostName = host ? displayName(host) : "host";
    const coreDevs = view.devices.filter((d) => /^cpu:\d+$/.test(d.ip)).sort((a, b) => Number(a.ip.slice(4)) - Number(b.ip.slice(4)));
    for (const d of coreDevs) this.touchCore(d, now);
    const procs = this.takeProcs(view.devices);
    for (const b of this.balls) {
      if (b.phase === "fly") b.rec.answered = !this.coreHot(b.lane);
    }
    const dur = FLIGHT_S / this.speed;
    let n = 0;
    for (const p of procs) {
      if (n >= MAX_BALLS) break;
      const src = this.touchProc(p, now);
      const lane = this.cores.get(p.core);
      if (!lane) continue;
      const rec: Rec = { answered: !this.coreHot(lane) };
      this.balls.push({
        rec, src, lane, t0: now + n * 0.03, dur, r: 2.6 + 6 * Math.min(1, p.cpu / CPU_RED),
        color: src.color, wall, info: `${p.cpu.toFixed(1)}%`,
        phase: "fly", x: 0, y: 0, vx: 0, vy: 0, age: 0, locked: false,
      });
      this.stats.slices += p.n;
      n++;
    }
    this.pps = this.pps * 0.5 + n * 0.5;
  }

  private takeProcs(devices: Device[]): Proc[] {
    const who = this.whoSel.value;
    const min = Number(this.minSel.value);
    const floor = Number.isFinite(min) ? min : 0.5;
    const raw: Proc[] = [];
    for (const d of devices) {
      if (!d.ip.startsWith("proc:")) continue;
      if (who === "mine" && d.role !== "local") continue;
      if (who === "kernel" && d.role !== "multicast") continue;
      const name = (d.names?.[0] || d.hostnames?.[0] || "proc").trim() || "proc";
      raw.push({ id: d.ip, name, cpu: d.cpu ?? 0, core: d.ports?.[0] || "cpu:0", role: d.role, n: 1 });
    }
    let list = raw;
    if (this.groupSel.value === "name") {
      const buckets = new Map<string, Proc>();
      for (const p of raw) {
        const id = cpuNameId(p.name);
        const g = buckets.get(id);
        if (!g) buckets.set(id, { ...p, id, n: 1 });
        else {
          g.cpu += p.cpu; g.n++;
          if (p.cpu >= g.cpu - p.cpu) g.core = p.core;
          if (p.role === "internet") g.role = "internet";
        }
      }
      list = [...buckets.values()];
    }
    return list.filter((p) => p.cpu >= floor).sort((a, b) => b.cpu - a.cpu);
  }

  private touchProc(p: Proc, now: number): Row {
    let r = this.procs.get(p.id);
    if (!r) {
      r = { id: p.id, label: p.name, sub: "", last: now, y: 0, color: css(hashColor(p.name)), cpu: 0, vol: 0, rank: -1 };
      this.procs.set(p.id, r);
    }
    r.last = now; r.cpu = p.cpu; r.vol += p.cpu; r.label = p.name;
    r.sub = p.n > 1 ? `×${p.n}` : "";
    r.color = p.role === "local" || p.role === "multicast" ? this.roleCss(p.role) : css(hashColor(p.name));
    return r;
  }

  private touchCore(d: Device, now: number): Lane {
    let l = this.cores.get(d.ip);
    if (!l) {
      l = {
        id: d.ip, label: d.names?.[0] || d.ip, sub: "", last: now, y: 0,
        color: css(cpuHeat(12)), cpu: 0, vol: 0, rank: Number(d.ip.slice(4)) || 0,
        hits: 0, misses: 0, flash: -1,
      };
      this.cores.set(d.ip, l);
    }
    l.last = now; l.cpu = d.cpu ?? 0; l.color = css(cpuHeat(l.cpu));
    l.sub = `${l.cpu >= 9.5 ? Math.round(l.cpu) : l.cpu.toFixed(1)}%`;
    return l;
  }

  protected step(now: number, dt: number): void {
    this.layout(dt);
    const { xL, xP, top, bottom } = this.geom;
    const mid = (top + bottom) / 2;
    if (this.bats[0].y < 0) { this.bats[0].y = mid; this.bats[1].y = mid; }

    const incoming = this.incoming(now);
    this.driveSplit(incoming, dt);
    const claimed = this.steerBats(incoming, dt);
    this.fireLasers(incoming, claimed, now);
    this.stepBeams(now);

    for (const b of this.balls) {
      if (b.phase === "fly") {
        const p = (now - b.t0) / b.dur;
        if (p < 0) continue;
        b.vx = (xP - xL) / b.dur; b.vy = (b.lane.y - b.src.y) / b.dur;
        b.x = xL + (xP - xL) * Math.min(1, p);
        b.y = b.src.y + (b.lane.y - b.src.y) * Math.min(1, p);
        if (p < 1) continue;
        b.age = 0;
        if (b.rec.answered) this.returnBall(b, now, false);
        else this.missBall(b, now);
      } else {
        b.age += dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.phase === "bounce") b.vy += 320 * dt;
      }
    }
    this.balls = this.balls.filter((b) =>
      b.phase === "fly" || (b.phase === "bounce" && b.age < 0.8)
      || (b.phase === "miss" && b.age < 4 && b.x < this.W + 30));
    this.rings = this.rings.filter((r) => now - r.t0 < 0.5);
    this.beams = this.beams.filter((z) => now - z.t0 < z.dur + 0.05);
    this.log.expire(now);
    const inUse = (r: Row) => this.balls.some((b) => b.src === r || b.lane === r);
    for (const [id, r] of this.procs) if (now - r.last > ROW_TTL_S && !inUse(r)) this.procs.delete(id);
    this.laserCd = Math.max(0, this.laserCd - dt);
    for (const bat of this.bats) bat.glow = Math.max(0, bat.glow - dt * 3);
  }

  private paddleH(): number { return PADDLE_H - 10 * this.splitT; }
  private splitOn(): boolean { return this.splitT > 0.35; }
  private coreHot(lane: Lane): boolean { return lane.cpu >= CPU_RED; }
  private laserHot(n = this.incomingCount): boolean { return this.hostPct >= LASER_LOAD || n >= 4; }
  private get incomingCount(): number {
    return this.balls.reduce((n, b) => n + (b.phase === "fly" && b.rec.answered ? 1 : 0), 0);
  }
  private activeBats(): Bat[] { return this.splitOn() ? [...this.bats] : [this.bats[0]]; }

  /** Cores in numeric order (cpu0 at the top of the column). */
  private coreList(): Lane[] {
    return [...this.cores.values()].sort((a, b) => a.rank - b.rank);
  }
  /** First rank of the lower half. cpu0..cut-1 is upper; cut..end is lower. */
  private coreCut(): number {
    const n = this.cores.size;
    return n <= 1 ? n : Math.floor(n / 2);
  }
  private inLower(lane: Lane): boolean { return lane.rank >= this.coreCut(); }
  /** bat[0] = upper cores (top of the column); bat[1] = lower cores (bottom). */
  private batForLane(lane: Lane): Bat {
    return this.splitOn() && this.inLower(lane) ? this.bats[1] : this.bats[0];
  }

  private incoming(now: number): { b: Ball; rem: number }[] {
    const out: { b: Ball; rem: number }[] = [];
    for (const b of this.balls) {
      if (b.phase !== "fly" || !b.rec.answered) continue;
      const rem = b.t0 + b.dur - now;
      if (rem >= 0) out.push({ b, rem });
    }
    out.sort((a, c) => a.rem - c.rem);
    return out;
  }

  private driveSplit(incoming: { b: Ball; rem: number }[], dt: number): void {
    let spread = 0;
    if (incoming.length >= 2) {
      let lo = Infinity, hi = -Infinity;
      for (const { b } of incoming) { lo = Math.min(lo, b.lane.y); hi = Math.max(hi, b.lane.y); }
      spread = hi - lo;
    }
    const want = this.hostPct >= SPLIT_LOAD || (incoming.length >= 2 && spread > this.paddleH() * 1.15) ? 1 : 0;
    this.splitT += (want - this.splitT) * Math.min(1, dt * 5.5);
    if (this.splitT < 0.02 && want === 0) this.splitT = 0;
    if (this.splitT > 0.98 && want === 1) this.splitT = 1;
    if (this.splitT > 0.2 && this.cores.size >= 2 && Math.abs(this.bats[1].y - this.bats[0].y) < 8) {
      this.bats[0].y = this.halfRest(0);
      this.bats[1].y = this.halfRest(1);
    }
  }

  private halfRest(lower: 0 | 1): number {
    const cores = this.coreList();
    const h = this.paddleH();
    const { top, bottom } = this.geom;
    if (cores.length < 2) return (top + bottom) / 2;
    const cut = this.coreCut();
    const slice = lower ? cores.slice(cut) : cores.slice(0, Math.max(1, cut));
    if (!slice.length) return lower ? bottom - h / 2 : top + h / 2;
    return (slice[0]!.y + slice[slice.length - 1]!.y) / 2;
  }

  private halfClamp(lower: 0 | 1, y: number): number {
    const cores = this.coreList();
    const h = this.paddleH();
    const { top, bottom } = this.geom;
    if (!this.splitOn() || cores.length < 2) return clamp(y, top + h / 2, bottom - h / 2);
    const cut = Math.max(1, this.coreCut());
    const mid = (cores[cut - 1]!.y + cores[Math.min(cores.length - 1, cut)]!.y) / 2;
    return lower
      ? clamp(y, mid + 4, bottom - h / 2)
      : clamp(y, top + h / 2, mid - 4);
  }

  private steerBats(incoming: { b: Ball; rem: number }[], dt: number): Set<Ball> {
    const h = this.paddleH();
    const claimed = new Set<Ball>();
    const split = this.splitOn() && this.cores.size >= 2;
    const bats = split ? this.bats : [this.bats[0]];
    for (let i = 0; i < bats.length; i++) {
      const bat = bats[i]!;
      const lower: 0 | 1 = i === 1 ? 1 : 0;
      let pick: { b: Ball; rem: number } | null = null, best = Infinity;
      for (const row of incoming) {
        if (claimed.has(row.b) || row.b.locked) continue;
        if (split && this.inLower(row.b.lane) !== !!lower) continue;
        const dist = Math.abs(row.b.lane.y - bat.y);
        const late = dist > h / 2 + row.rem * PADDLE_SPEED ? 8000 : 0;
        const score = late + row.rem * 40 + dist;
        if (score < best) { best = score; pick = row; }
      }
      const before = bat.y;
      const target = pick ? pick.b.lane.y : (split ? this.halfRest(lower) : bat.y);
      if (pick) claimed.add(pick.b);
      const gap = target - bat.y;
      const budget = pick ? Math.max(dt, pick.rem * PADDLE_MARGIN) : Math.max(dt, 0.25);
      const step = Math.abs(gap) <= 0.5 ? gap : gap * Math.min(1, dt / budget);
      bat.y += clamp(step, -PADDLE_SPEED * dt, PADDLE_SPEED * dt);
      bat.y = this.halfClamp(lower, bat.y);
      bat.vy = dt > 0 ? (bat.y - before) / dt : 0;
    }
    if (!split) {
      this.bats[1].y += (this.bats[0].y - this.bats[1].y) * Math.min(1, dt * 8);
      this.bats[1].vy = this.bats[0].vy;
    }
    return claimed;
  }

  private fireLasers(incoming: { b: Ball; rem: number }[], claimed: Set<Ball>, now: number): void {
    if (!this.laserHot(incoming.length) || this.laserCd > 0) return;
    const burst = this.hostPct >= 85 || incoming.length >= 8 ? 2 : 1;
    let n = 0;
    for (const { b } of incoming) {
      if (n >= burst) break;
      if (b.locked || b.phase !== "fly" || claimed.has(b)) continue;
      const p = (now - b.t0) / b.dur;
      if (p < 0.22 || p > 0.9) continue;
      const bat = this.batForLane(b.lane);
      b.locked = true;
      bat.glow = 1;
      this.beams.push({ bat, ball: b, t0: now, dur: LASER_DUR });
      this.laserCd = LASER_CD / (this.hostPct >= CPU_RED ? 1.6 : 1);
      n++;
    }
  }

  private stepBeams(now: number): void {
    for (const z of this.beams) {
      if (now < z.t0 + z.dur) continue;
      if (z.ball.phase === "fly" && z.ball.rec.answered) this.returnBall(z.ball, now, true);
    }
  }

  private nearestBat(y: number): Bat {
    const bats = this.activeBats();
    return bats.reduce((a, c) => Math.abs(c.y - y) < Math.abs(a.y - y) ? c : a);
  }

  private coverBat(y: number, lane?: Lane): Bat | undefined {
    const h = this.paddleH();
    const bats = lane && this.splitOn() ? [this.batForLane(lane)] : this.activeBats();
    return bats.find((bat) => Math.abs(y - bat.y) <= h / 2 + 6);
  }

  private returnBall(b: Ball, now: number, zap: boolean): void {
    if (b.phase !== "fly") return;
    const home = this.batForLane(b.lane);
    const bat = this.coverBat(b.y, b.lane) ?? (this.splitOn() ? home : this.nearestBat(b.y));
    if (!zap && !this.coverBat(b.y, b.lane) && !this.splitOn()) bat.y = b.y;
    b.phase = "bounce"; b.age = 0; b.locked = true;
    const off = clamp((b.y - bat.y) / (this.paddleH() / 2), -1, 1);
    b.vx = -Math.abs(b.vx) * (zap ? 1.08 : 0.9); b.vy = off * (zap ? 300 : 260);
    bat.glow = 1;
    this.rings.push({
      x: zap ? b.x : this.geom.xP, y: b.y, t0: now, color: zap ? css(this.theme.roles.self) : b.color,
      r0: zap ? 2 : 4, r1: zap ? 26 : 30, dur: zap ? 0.28 : 0.5,
    });
    b.lane.hits++; this.stats.hits++;
    if (zap) this.stats.zaps++;
  }

  private missBall(b: Ball, now: number): void {
    b.phase = "miss";
    b.lane.misses++; this.stats.misses++;
    b.lane.flash = now;
    this.log.push({
      key: `${b.src.id}|${b.lane.id}`, t: now, wall: b.wall, mark: "✕", markColor: MISS_RED,
      color: b.src.color, head: `${b.src.label} → ${b.lane.label}`, tail: `${b.lane.sub} · over 80%`,
    });
  }

  private layout(dt: number): void {
    const top = this.barTop(), bottom = this.footTop() - this.log.height;
    const avail = Math.max(ROW_H * 2, bottom - top);
    this.geom = {
      top, bottom, xL: LEFT_W, xP: this.W - RIGHT_W - 28,
      maxLeft: Math.max(1, Math.floor((avail - CAPTION_H) / ROW_H)),
      maxRight: Math.max(1, Math.floor((avail - CAPTION_H - HUD_H) / ROW_H)),
    };
    const k = dt > 0 ? Math.min(1, dt / 0.35) : 1;
    const decay = dt > 0 ? Math.exp(-dt / 30) : 1;
    const ranked = [...this.procs.values()].sort((a, b) => b.vol - a.vol || a.label.localeCompare(b.label));
    ranked.forEach((r, i) => {
      r.vol *= decay;
      r.rank = i;
      const y = top + CAPTION_H + Math.min(i, Math.max(0, this.geom.maxLeft - 1)) * ROW_H + ROW_H / 2;
      r.y = r.y === 0 ? y : r.y + (y - r.y) * k;
    });
    const cores = [...this.cores.values()].sort((a, b) => a.rank - b.rank);
    cores.forEach((l, i) => {
      const y = top + CAPTION_H + HUD_H + Math.min(i, Math.max(0, this.geom.maxRight - 1)) * ROW_H + ROW_H / 2;
      l.y = l.y === 0 ? y : l.y + (y - l.y) * k;
    });
  }

  protected draw(now: number): void {
    const g = this.g, u = this.theme.ui, { xL, xP, top, bottom } = this.geom;
    if (!this.msg?.views?.cpu) {
      this.drawIdle(now, "waiting for CPU samples…", this.W / 2, (top + bottom) / 2);
      return;
    }
    g.textBaseline = "middle";
    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([2, 5]);
    g.beginPath(); g.moveTo(xL - 8, top); g.lineTo(xL - 8, bottom); g.stroke();
    g.setLineDash([]);

    g.font = `10px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "left";
    g.fillText("PROCESSES", 16, top + 8);
    const maxLeft = this.geom.maxLeft;
    let leftOverflow = false;
    for (const r of [...this.procs.values()].sort((a, b) => a.rank - b.rank)) {
      if (r.rank >= maxLeft - 1 && this.procs.size > maxLeft) {
        if (leftOverflow) continue;
        leftOverflow = true;
        g.font = `12px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(`… ${this.procs.size - (maxLeft - 1)} more`, 16, r.y);
        continue;
      }
      g.globalAlpha = fade(now, r.last);
      g.fillStyle = r.color; g.beginPath(); g.arc(20, r.y, 3.5, 0, Math.PI * 2); g.fill();
      g.font = `12px ${this.font}`; g.fillStyle = u.fg;
      const pct = `${r.cpu >= 9.5 ? Math.round(r.cpu) : r.cpu.toFixed(1)}%`;
      const name = fitText(g, r.label, LEFT_W - 88);
      g.fillText(name, 30, r.y);
      g.font = `10.5px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "right";
      g.fillText(`${r.sub ? `${r.sub} · ` : ""}${pct}`, xL - 16, r.y);
      g.textAlign = "left";
      g.globalAlpha = 1;
    }

    g.font = `10px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("CORES", xP + 18, top + HUD_H + 8);
    const maxRight = this.geom.maxRight;
    let rightOverflow = false;
    const cores = [...this.cores.values()].sort((a, b) => a.rank - b.rank);
    for (const l of cores) {
      if (l.rank >= maxRight - 1 && cores.length > maxRight) {
        if (rightOverflow) continue;
        rightOverflow = true;
        g.font = `12px ${this.font}`; g.fillStyle = u.muted;
        g.fillText(`… ${cores.length - (maxRight - 1)} more`, xP + 30, l.y);
        continue;
      }
      g.globalAlpha = fade(now, l.last, ROW_TTL_S * 4, 8);
      const flashing = this.coreHot(l) || now - l.flash < 0.6;
      g.fillStyle = l.color; g.beginPath(); g.arc(xP + 20, l.y, 3.5, 0, Math.PI * 2); g.fill();
      g.font = `12px ${this.font}`; g.fillStyle = flashing ? MISS_RED : u.fg;
      g.fillText(fitText(g, `${l.label}  ${l.sub}`, RIGHT_W - 92), xP + 30, l.y);
      g.font = `10.5px ${this.font}`; g.fillStyle = u.muted; g.textAlign = "right";
      g.fillText(`${l.hits}↩ ${l.misses}✕`, this.W - 14, l.y);
      g.textAlign = "left";
      g.globalAlpha = 1;
    }

    this.drawPaddle();
    this.drawBeams(now);
    this.drawBalls(now);
    this.rings = drawRings(g, this.rings, now);
    this.drawHud();
    this.log.draw(g, u, this.font, 16, bottom, this.W - 30, now);
  }

  private drawPaddle(): void {
    const g = this.g, u = this.theme.ui, { xP, top, bottom } = this.geom;
    g.strokeStyle = u.line; g.lineWidth = 1; g.setLineDash([3, 6]);
    g.beginPath(); g.moveTo(xP, top); g.lineTo(xP, bottom); g.stroke();
    g.setLineDash([]);
    const color = css(this.theme.roles.self);
    const h = this.paddleH();
    if (this.splitT > 0.2) {
      g.strokeStyle = color; g.globalAlpha = 0.22 * this.splitT; g.lineWidth = 1.2; g.setLineDash([3, 5]);
      g.beginPath(); g.moveTo(xP, this.bats[0].y); g.lineTo(xP, this.bats[1].y); g.stroke();
      g.setLineDash([]);
      const cores = this.coreList();
      const cut = this.coreCut();
      if (cores.length >= 2 && cut > 0 && cut < cores.length) {
        const mid = (cores[cut - 1]!.y + cores[cut]!.y) / 2;
        g.globalAlpha = 0.45 * this.splitT; g.lineWidth = 1;
        g.beginPath(); g.moveTo(xP - 14, mid); g.lineTo(xP + 14, mid); g.stroke();
      }
      g.globalAlpha = 1;
    }
    const bats: { bat: Bat; alpha: number }[] = [{ bat: this.bats[0], alpha: 1 }];
    if (this.splitT > 0.08) bats.push({ bat: this.bats[1], alpha: this.splitT });
    for (const { bat, alpha } of bats) this.strokeBat(bat, color, h, alpha);
  }

  private strokeBat(bat: Bat, color: string, h: number, alpha: number): void {
    const g = this.g, { xP } = this.geom;
    const { y, vy } = bat;
    g.globalAlpha = alpha;
    const trail = Math.min(h * 2.5, Math.abs(vy) * 0.08);
    if (trail > 4) {
      const back = y - Math.sign(vy) * trail;
      const grad = g.createLinearGradient(0, y, 0, back);
      grad.addColorStop(0, color); grad.addColorStop(1, "transparent");
      g.globalAlpha = 0.45 * alpha; g.fillStyle = grad;
      roundRect(g, xP - PADDLE_W / 2 + 1, Math.min(y, back) - h / 2, PADDLE_W - 2, h + trail, 3); g.fill();
      g.globalAlpha = alpha;
    }
    g.save();
    g.shadowColor = color; g.shadowBlur = 6 + 18 * bat.glow + (this.laserHot() ? 8 : 0);
    g.fillStyle = color;
    roundRect(g, xP - PADDLE_W / 2, y - h / 2, PADDLE_W, h, 3); g.fill();
    if (this.laserHot()) {
      g.fillStyle = "#fff"; g.globalAlpha = 0.55 * alpha;
      roundRect(g, xP - 1.5, y - 5, 3, 10, 1); g.fill();
    }
    g.restore();
    g.globalAlpha = 1;
  }

  private drawBeams(now: number): void {
    const g = this.g, { xP } = this.geom;
    const color = css(this.theme.roles.self);
    for (const z of this.beams) {
      const p = clamp((now - z.t0) / z.dur, 0, 1);
      const x0 = xP, y0 = z.bat.y, x1 = z.ball.x, y1 = z.ball.y;
      const x = x0 + (x1 - x0) * p, y = y0 + (y1 - y0) * p;
      g.save();
      g.strokeStyle = color; g.shadowColor = color; g.shadowBlur = 16;
      g.lineWidth = 2.6; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
      g.shadowBlur = 0; g.strokeStyle = "#fff"; g.lineWidth = 1.1; g.globalAlpha = 0.95;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
      g.fillStyle = "#fff"; g.shadowColor = color; g.shadowBlur = 12;
      g.beginPath(); g.arc(x, y, 2.4, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  private drawBalls(now: number): void {
    const g = this.g;
    for (const b of this.balls) {
      if (b.phase === "fly" && now < b.t0) continue;
      let alpha = 1, r = b.r, color = b.color;
      if (b.phase === "bounce") alpha = 1 - b.age / 0.8;
      else if (b.phase === "miss") { color = MISS_RED; alpha = 0.9; }
      g.globalAlpha = alpha;
      g.fillStyle = color;
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fill();
      if (b.phase === "fly") {
        g.strokeStyle = color; g.lineWidth = 1.2; g.globalAlpha = 0.25;
        g.beginPath(); g.moveTo(this.geom.xL, b.src.y); g.lineTo(b.x, b.y); g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  private drawHud(): void {
    const g = this.g, u = this.theme.ui, { xP, top } = this.geom;
    const x = xP + 18, y = top + 8;
    g.textAlign = "left"; g.textBaseline = "middle";
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText("THIS HOST", x, y);
    g.font = `18px ${this.font}`; g.fillStyle = css(this.theme.roles.self);
    g.fillText(fitText(g, this.hostName, RIGHT_W - 24), x, y + 18);
    g.font = `12px ${this.font}`; g.fillStyle = u.fg;
    const mode = this.laserHot() ? "intercept" : this.splitOn() ? "dual" : "kernel";
    const load = `${this.hostPct >= 9.5 ? Math.round(this.hostPct) : this.hostPct.toFixed(1)}% · ${this.cores.size} cores · ${mode}`;
    g.fillText(load, x, y + 38);
    g.font = `11px ${this.font}`; g.fillStyle = u.muted;
    g.fillText(`${this.stats.hits}↩ covered  ${this.stats.zaps}⚡ intercept  ${this.stats.misses}✕ over 80%`, x, y + 56);
  }
}
