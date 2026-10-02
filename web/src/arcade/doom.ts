import type { NetScene } from "../graph/scene";
import { readArcadeKnob } from "../core/arcade-knob";
import { Select } from "../ui/ui";
import { CPU_RED, hashColor } from "../core/modes";
import { displayName, type Device, type Packet, type Role } from "../core/types";
import { ArcadeView, FadeLog, clamp, css, fitText } from "./arcade";
import { doomArt, drawSpriteClipped, drawTexColumn, paintFlats, TEX } from "./doom-tex";
import { DoomSfx } from "./doom-sfx";

/**
 * CPU Doom: this host's scheduler as a first-person corridor.
 *
 * Logical CPUs are rooms in a grid. Busy processes stand in the room of the core they last ran on.
 * Shots are visual rockets — they never signal or kill a PID. A process leaves when its CPU share drops.
 */

const KEY_WHO = "zoto-viz.doom.who";
const KEY_MIN = "zoto-viz.doom.min";
const KEY_GROUP = "zoto-viz.doom.group";
const FOV = 0.66;
const MOVE = 3.4;
const CHASE = 2.6;
const TURN = 2.2;
const LOOK = 0.004;
const AUTO_TURN = 2.6;
const FIRE_CD = 0.62;
const AUTO_FIRE_S = 1.35;
const ROCKET_SPEED = 10.5;
const ROCKET_LIFE = 1.6;
const SPLASH = 1.28;
const GIB_LIFE = 20;
const SPLAT_LIFE = 20;
const MAX_GIBS = 256;
const MAX_SPLATS = 160;
const MAX_SPRITES = 40;
const SPRITE_MAX = 140;
const STEP_R = 0.24;

export interface Maze {
  w: number;
  h: number;
  wall: boolean[][];
  rooms: { x: number; y: number }[];
}

export interface RayHit {
  dist: number;
  side: 0 | 1;
  mx: number;
  my: number;
  wallX: number;
}

export function cpuNameId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `proc:name:${slug || "proc"}`;
}

/** One-tile rectangular corridor around a solid core. Cores sit on the loop. */
export function buildMaze(nCores: number): Maze {
  const n = Math.max(1, Math.min(64, Math.floor(nCores) || 1));
  const inner = Math.max(3, Math.ceil(n / 4) + 1);
  const w = inner + 4;
  const wall = Array.from({ length: w }, () => Array<boolean>(w).fill(true));
  for (let x = 1; x < w - 1; x++) {
    wall[1]![x] = false;
    wall[w - 2]![x] = false;
  }
  for (let y = 1; y < w - 1; y++) {
    wall[y]![1] = false;
    wall[y]![w - 2] = false;
  }
  const spots: { x: number; y: number }[] = [];
  for (let x = 1; x < w - 1; x++) spots.push({ x: x + 0.5, y: 1.5 });
  for (let y = 2; y < w - 2; y++) spots.push({ x: w - 1.5, y: y + 0.5 });
  for (let x = w - 2; x >= 1; x--) spots.push({ x: x + 0.5, y: w - 1.5 });
  for (let y = w - 3; y > 1; y--) spots.push({ x: 1.5, y: y + 0.5 });
  const rooms = spots.length
    ? Array.from({ length: n }, (_, i) => spots[Math.floor(i * spots.length / n) % spots.length]!)
    : [{ x: 1.5, y: 1.5 }];
  return { w, h: w, wall, rooms };
}

export function isWall(maze: Maze, x: number, y: number): boolean {
  const mx = Math.floor(x), my = Math.floor(y);
  if (mx < 0 || my < 0 || mx >= maze.w || my >= maze.h) return true;
  return maze.wall[my]![mx]!;
}

/** Keep the camera off the brick faces so a wall cannot fill the whole FOV. */
export function blocked(maze: Maze, x: number, y: number, r = STEP_R): boolean {
  return isWall(maze, x - r, y - r) || isWall(maze, x + r, y - r)
    || isWall(maze, x - r, y + r) || isWall(maze, x + r, y + r);
}

/** North hall, looking east down the corridor. */
export function spawnPose(maze: Maze): { x: number; y: number; dirX: number; dirY: number } {
  return { x: 1.5, y: 1.5, dirX: 1, dirY: 0 };
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** First floor cell on a shortest path from (fx,fy) toward (tx,ty). */
export function chaseStep(maze: Maze, fx: number, fy: number, tx: number, ty: number): { x: number; y: number } | null {
  const sx = Math.floor(fx), sy = Math.floor(fy);
  const gx = Math.floor(tx), gy = Math.floor(ty);
  if (sx === gx && sy === gy) return null;
  const key = (x: number, y: number) => `${x},${y}`;
  const prev = new Map<string, [number, number] | null>();
  prev.set(key(sx, sy), null);
  const q: [number, number][] = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i]!;
    if (x === gx && y === gy) break;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (isWall(maze, nx + 0.5, ny + 0.5)) continue;
      const k = key(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  if (!prev.has(key(gx, gy))) return null;
  let cx = gx, cy = gy;
  for (let i = 0; i < 256; i++) {
    const p = prev.get(key(cx, cy));
    if (!p) return null;
    if (p[0] === sx && p[1] === sy) return { x: cx + 0.5, y: cy + 0.5 };
    cx = p[0]; cy = p[1];
  }
  return null;
}

/** DDA until a wall. `dist` is perpendicular (fisheye-corrected) when dir is unit length. */
export function castRay(maze: Maze, px: number, py: number, dx: number, dy: number, max = 24): RayHit {
  let mx = Math.floor(px), my = Math.floor(py);
  if (mx < 0 || my < 0 || mx >= maze.w || my >= maze.h || maze.wall[my]![mx]) {
    return { dist: 0.05, side: 0, mx, my, wallX: px - Math.floor(px) };
  }
  const deltaX = Math.abs(1 / (dx || 1e-12));
  const deltaY = Math.abs(1 / (dy || 1e-12));
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  let sideX = dx < 0 ? (px - mx) * deltaX : (mx + 1 - px) * deltaX;
  let sideY = dy < 0 ? (py - my) * deltaY : (my + 1 - py) * deltaY;
  let side: 0 | 1 = 0;
  for (let i = 0; i < 48; i++) {
    if (sideX < sideY) { sideX += deltaX; mx += stepX; side = 0; }
    else { sideY += deltaY; my += stepY; side = 1; }
    if (mx < 0 || my < 0 || mx >= maze.w || my >= maze.h || maze.wall[my]![mx]) break;
    const d = side === 0 ? (mx - px + (1 - stepX) / 2) / (dx || 1e-12) : (my - py + (1 - stepY) / 2) / (dy || 1e-12);
    if (d > max) return { dist: max, side, mx, my, wallX: 0 };
  }
  const dist = Math.max(0.05, Math.abs(side === 0
    ? (mx - px + (1 - stepX) / 2) / (dx || 1e-12)
    : (my - py + (1 - stepY) / 2) / (dy || 1e-12)));
  let wallX = side === 0 ? py + dist * dy : px + dist * dx;
  wallX -= Math.floor(wallX);
  if ((side === 0 && dx > 0) || (side === 1 && dy < 0)) wallX = 1 - wallX;
  return { dist, side, mx, my, wallX };
}

/** Advance a rocket; `wall` is true if the step would enter brick. */
export function rocketStop(
  maze: Maze, x: number, y: number, dx: number, dy: number, step: number,
): { x: number; y: number; wall: boolean; dist: number } {
  const hit = castRay(maze, x, y, dx, dy);
  if (hit.dist <= step + 0.04) {
    const d = Math.max(0.02, hit.dist - 0.02);
    return { x: x + dx * d, y: y + dy * d, wall: true, dist: hit.dist };
  }
  return { x: x + dx * step, y: y + dy * step, wall: false, dist: step };
}

export function spriteHit(
  px: number, py: number, dx: number, dy: number,
  sprites: { x: number; y: number; id: string }[],
  wallDist: number, radius = 0.38,
): { id: string; t: number } | null {
  let best: { id: string; t: number } | null = null;
  for (const s of sprites) {
    const t = (s.x - px) * dx + (s.y - py) * dy;
    if (t < 0.2 || t > wallDist) continue;
    const perp = Math.abs((s.x - px) * dy - (s.y - py) * dx);
    if (perp > radius) continue;
    if (!best || t < best.t) best = { id: s.id, t };
  }
  return best;
}

/** Closest sprite the rocket segment would strike. */
export function rocketHit(
  x0: number, y0: number, x1: number, y1: number,
  sprites: { x: number; y: number; id: string }[],
  radius = 0.45,
): { id: string; x: number; y: number } | null {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-12;
  let best: { id: string; t: number; x: number; y: number } | null = null;
  for (const s of sprites) {
    const t = clamp(((s.x - x0) * dx + (s.y - y0) * dy) / len2, 0, 1);
    const hx = x0 + dx * t, hy = y0 + dy * t;
    if (Math.hypot(s.x - hx, s.y - hy) > radius) continue;
    if (!best || t < best.t) best = { id: s.id, t, x: hx, y: hy };
  }
  return best;
}

/** Process ids inside a blast radius (visual splash). */
export function splashIds(
  x: number, y: number,
  sprites: { x: number; y: number; id: string }[],
  radius = SPLASH,
): string[] {
  return sprites.filter((s) => Math.hypot(s.x - x, s.y - y) <= radius).map((s) => s.id);
}

export interface Giblet {
  x: number; y: number; z: number;
  dx: number; dy: number; vz: number;
  t0: number; kind: number;
}
export interface Splat { x: number; y: number; t0: number }

export function sprayGibs(x: number, y: number, now: number, n = 11): Giblet[] {
  const count = Math.max(4, Math.min(16, Math.floor(n)));
  const out: Giblet[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + i * 0.31;
    const sp = 1.55 + (i % 4) * 0.42;
    out.push({
      x: x + Math.cos(a) * 0.05,
      y: y + Math.sin(a) * 0.05,
      z: 0.32 + (i % 3) * 0.1,
      dx: Math.cos(a) * sp,
      dy: Math.sin(a) * sp,
      vz: 2.6 + (i % 5) * 0.45,
      t0: now,
      kind: i % 3,
    });
  }
  return out;
}

/** Bounce chunks off brick, then rest on the floor. Returns true if this tick planted a floor splat. */
export function stepGib(maze: Maze, g: Giblet, dt: number): boolean {
  if (g.z <= 0 && Math.abs(g.vz) < 0.2 && Math.hypot(g.dx, g.dy) < 0.12) {
    g.z = 0; g.vz = 0; g.dx = 0; g.dy = 0;
    return false;
  }
  const nx = g.x + g.dx * dt;
  const ny = g.y + g.dy * dt;
  if (isWall(maze, nx, g.y)) g.dx *= -0.55;
  else g.x = nx;
  if (isWall(maze, g.x, ny)) g.dy *= -0.55;
  else g.y = ny;
  const falling = g.vz < 0 && g.z > 0;
  g.vz -= 9.8 * dt;
  g.z += g.vz * dt;
  let splat = false;
  if (g.z < 0) {
    splat = falling;
    g.z = 0;
    g.vz *= -0.28;
    g.dx *= 0.42;
    g.dy *= 0.42;
    if (Math.abs(g.vz) < 0.55) g.vz = 0;
    if (Math.hypot(g.dx, g.dy) < 0.18) { g.dx = 0; g.dy = 0; }
  }
  g.dx *= 0.96;
  g.dy *= 0.96;
  return splat;
}

export function remainFade(age: number, life: number, fade = 2): number {
  return clamp((life - age) / fade, 0, 1);
}

interface Proc { id: string; name: string; cpu: number; core: string; role: Role; n: number }
interface Imp {
  id: string; name: string; cpu: number; core: string; color: string;
  x: number; y: number; last: number; flash: number; gib: number; n: number;
}
interface Rocket { x: number; y: number; dx: number; dy: number; t0: number; fromPlayer: boolean }
interface Boom { x: number; y: number; t0: number }

export class DoomView extends ArcadeView {
  readonly controls: HTMLElement[];
  private readonly whoSel: Select;
  private readonly minSel: Select;
  private readonly groupSel: Select;
  private maze = buildMaze(4);
  private px = 1.5;
  private py = 1.5;
  private dirX = 1;
  private dirY = 0;
  private planeX = 0;
  private planeY = FOV;
  private keys = new Set<string>();
  private locked = false;
  private fireCd = 0;
  private kick = 0;
  private dragging = false;
  private dragMoved = 0;
  private imps = new Map<string, Imp>();
  private cores: string[] = [];
  private rockets: Rocket[] = [];
  private booms: Boom[] = [];
  private gibs: Giblet[] = [];
  private splats: Splat[] = [];
  private log = new FadeLog(5, "ROCKETS (visual)", "click or space · processes are not killed");
  private stats = { shots: 0, hits: 0 };
  private hostPct = 0;
  private hostName = "host";
  private snapTs = -1;
  private hover = "";
  private chaseId = "";
  private chaseUntil = 0;
  private readonly sfx = new DoomSfx();
  private flats: HTMLCanvasElement | null = null;
  private flatsImg: ImageData | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private offKey = (e: KeyboardEvent) => this.key(e, false);
  private onLock = () => { this.locked = document.pointerLockElement === this.canvas; };
  private onMouse = (e: MouseEvent) => {
    if (!this.running) return;
    if (this.locked || this.dragging) {
      this.turn(e.movementX * LOOK);
      this.dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
    }
  };
  private onDown = (e: PointerEvent) => {
    if (!this.running || e.button !== 0) return;
    this.sfx.resume();
    this.dragging = true;
    this.dragMoved = 0;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
  };
  private onUp = (e: PointerEvent) => {
    if (!this.running || e.button !== 0) return;
    this.dragging = false;
    if (this.dragMoved < 6) this.fire(true);
  };

  private attachInput(): void {
    this.detachInput();
    this.canvas.addEventListener("mousemove", this.onMouse);
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointerup", this.onUp);
    document.addEventListener("pointerlockchange", this.onLock);
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.offKey, true);
  }

  private detachInput(): void {
    if (this.locked) document.exitPointerLock();
    this.dragging = false;
    this.canvas.removeEventListener("mousemove", this.onMouse);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointerup", this.onUp);
    document.removeEventListener("pointerlockchange", this.onLock);
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.offKey, true);
    this.keys.clear();
  }

  constructor(container: HTMLElement, scene: NetScene) {
    super(container, scene);
    this.canvas.tabIndex = 0;
    this.canvas.style.cursor = "crosshair";
    const pose = spawnPose(this.maze);
    this.px = pose.x; this.py = pose.y;
    this.dirX = pose.dirX; this.dirY = pose.dirY;
    this.planeX = -this.dirY * FOV;
    this.planeY = this.dirX * FOV;
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
      caption: "group", title: "one sprite per PID, or fold threads that share a name",
      options: [{ value: "each", label: "each process" }, { value: "name", label: "by name" }],
      value: readArcadeKnob(KEY_GROUP, "name"),
      onChange: (v) => { localStorage.setItem(KEY_GROUP, v); this.resync(); },
    });
    this.controls = [this.whoSel.el, this.minSel.el, this.groupSel.el];
  }

  protected override useTraffic(): boolean { return false; }
  protected query(): { ip: string } | null { return { ip: "cpu" }; }
  protected ingest(_fresh: Packet[], _first: number, _newest: number): void { /* snapshot-fed */ }
  protected override variant(): string {
    return `${this.whoSel.value}\u0001${this.minSel.value}\u0001${this.groupSel.value}`;
  }

  protected override onStart(): void {
    this.attachInput();
    this.sfx.resume();
  }

  override stop(): void {
    this.detachInput();
    this.sfx.stop();
    super.stop();
  }

  protected override reset(): void {
    super.reset();
    this.imps.clear();
    this.rockets = [];
    this.booms = [];
    this.gibs = [];
    this.splats = [];
    this.log.clear();
    this.stats = { shots: 0, hits: 0 };
    this.snapTs = -1;
    this.hover = "";
    this.chaseId = "";
    this.chaseUntil = 0;
  }

  protected override onClick(): void {
    /* pointerup fires; a click here would double-shot */
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (!this.running) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (down && k === " ") this.fire(true);
    if (down) { this.sfx.resume(); this.keys.add(k); }
    else this.keys.delete(k);
  }

  private turn(a: number): void {
    const c = Math.cos(a), s = Math.sin(a);
    const dx = this.dirX * c - this.dirY * s;
    const dy = this.dirX * s + this.dirY * c;
    this.dirX = dx; this.dirY = dy;
    this.planeX = -this.dirY * FOV;
    this.planeY = this.dirX * FOV;
  }

  private tryMove(nx: number, ny: number): void {
    if (!blocked(this.maze, nx, this.py)) this.px = nx;
    if (!blocked(this.maze, this.px, ny)) this.py = ny;
  }

  private fire(fromPlayer: boolean): void {
    if (this.fireCd > 0) return;
    this.fireCd = fromPlayer ? FIRE_CD : AUTO_FIRE_S;
    this.kick = 1.25;
    this.stats.shots++;
    this.sfx.fire();
    const sx = this.px + this.dirX * 0.28;
    const sy = this.py + this.dirY * 0.28;
    if (isWall(this.maze, sx, sy)) {
      const wall = castRay(this.maze, this.px, this.py, this.dirX, this.dirY);
      this.boom(this.px + this.dirX * wall.dist, this.py + this.dirY * wall.dist, performance.now() / 1000, fromPlayer);
      return;
    }
    this.rockets.push({
      x: sx, y: sy, dx: this.dirX, dy: this.dirY,
      t0: performance.now() / 1000,
      fromPlayer,
    });
  }

  private boom(x: number, y: number, now: number, fromPlayer: boolean): void {
    this.booms.push({ x, y, t0: now });
    this.kick = Math.min(1.6, this.kick + 0.28);
    this.sfx.boom(Math.hypot(x - this.px, y - this.py));
    const ids = splashIds(x, y, [...this.imps.values()]);
    let primary: Imp | undefined;
    for (const id of ids) {
      const imp = this.imps.get(id);
      if (!imp) continue;
      imp.flash = 1;
      imp.gib = 0.55;
      if (!primary || imp.cpu > primary.cpu) primary = imp;
    }
    if (primary) {
      this.sfx.gib(Math.hypot(x - this.px, y - this.py));
      const n = 8 + Math.min(6, Math.floor(primary.cpu / 28));
      this.gibs.push(...sprayGibs(x, y, now, n * Math.max(1, ids.length)));
      if (this.gibs.length > MAX_GIBS) this.gibs.splice(0, this.gibs.length - MAX_GIBS);
      this.splats.push({ x, y, t0: now });
      this.stats.hits++;
      this.log.push({
        key: primary.id, t: now, wall: this.msg?.ts ?? 0,
        mark: "❋", markColor: "#c62828", color: primary.color,
        head: primary.name,
        tail: `${primary.cpu.toFixed(1)}% on ${primary.core.replace("cpu:", "cpu")} · giblets${ids.length > 1 ? ` ×${ids.length}` : ""} · visual`,
      });
      return;
    }
    if (fromPlayer) {
      this.log.push({
        key: "miss", t: now, wall: this.msg?.ts ?? 0,
        mark: "·", markColor: this.theme.ui.muted, color: this.theme.ui.muted,
        head: "whiff", tail: "rocket into brick",
      });
    }
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
    const ids = coreDevs.map((d) => d.ip);
    if (ids.join(",") !== this.cores.join(",") || this.maze.rooms.length < ids.length) {
      this.cores = ids;
      const next = buildMaze(Math.max(4, ids.length));
      const keep = next.w === this.maze.w && !blocked(next, this.px, this.py);
      this.maze = next;
      if (!keep) {
        const pose = spawnPose(this.maze);
        this.px = pose.x; this.py = pose.y;
        this.dirX = pose.dirX; this.dirY = pose.dirY;
        this.planeX = -this.dirY * FOV;
        this.planeY = this.dirX * FOV;
      }
    }
    const seen = new Set<string>();
    for (const p of this.takeProcs(view.devices).slice(0, MAX_SPRITES)) {
      seen.add(p.id);
      const room = this.roomOf(p.core);
      let imp = this.imps.get(p.id);
      if (!imp) {
        imp = { id: p.id, name: p.name, cpu: p.cpu, core: p.core, color: css(hashColor(p.name)), x: room.x, y: room.y, last: now, flash: 0, gib: 0, n: p.n };
        this.imps.set(p.id, imp);
      }
      imp.cpu = p.cpu; imp.core = p.core; imp.name = p.name; imp.n = p.n; imp.last = now;
      const ang = (hashColor(p.id) % 628) / 100;
      const rad = 0.12;
      const tx = room.x + Math.cos(ang) * rad;
      const ty = room.y + Math.sin(ang) * rad;
      const hop = chaseStep(this.maze, imp.x, imp.y, tx, ty);
      const gx = hop ? hop.x : tx, gy = hop ? hop.y : ty;
      imp.x += (gx - imp.x) * 0.45;
      imp.y += (gy - imp.y) * 0.45;
      if (blocked(this.maze, imp.x, imp.y, 0.16)) {
        imp.x = gx; imp.y = gy;
        if (blocked(this.maze, imp.x, imp.y, 0.16)) { imp.x = room.x; imp.y = room.y; }
      }
    }
    for (const [id, imp] of this.imps) {
      if (!seen.has(id) && now - imp.last > 2.5) this.imps.delete(id);
    }
    this.pps = this.pps * 0.5 + this.imps.size * 0.5;
  }

  private roomOf(core: string): { x: number; y: number } {
    const i = Math.max(0, this.cores.indexOf(core));
    return this.maze.rooms[i % this.maze.rooms.length] ?? { x: 1.5, y: 1.5 };
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
        }
      }
      list = [...buckets.values()];
    }
    return list.filter((p) => p.cpu >= floor).sort((a, b) => b.cpu - a.cpu);
  }

  protected step(now: number, dt: number): void {
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.kick *= Math.max(0, 1 - dt * 8);
    this.log.expire(now);
    for (const imp of this.imps.values()) {
      imp.flash = Math.max(0, imp.flash - dt * 3);
      imp.gib = Math.max(0, imp.gib - dt);
    }
    const live: Rocket[] = [];
    for (const r of this.rockets) {
      if (now - r.t0 > ROCKET_LIFE) { this.boom(r.x, r.y, now, r.fromPlayer); continue; }
      const step = ROCKET_SPEED * dt;
      const stop = rocketStop(this.maze, r.x, r.y, r.dx, r.dy, step);
      if (stop.wall) { this.boom(stop.x, stop.y, now, r.fromPlayer); continue; }
      const hit = rocketHit(r.x, r.y, stop.x, stop.y, [...this.imps.values()]);
      if (hit) { this.boom(hit.x, hit.y, now, r.fromPlayer); continue; }
      r.x = stop.x; r.y = stop.y;
      live.push(r);
    }
    this.rockets = live;
    this.booms = this.booms.filter((b) => now - b.t0 < 0.45);
    const stillGibs: Giblet[] = [];
    for (const g of this.gibs) {
      if (now - g.t0 > GIB_LIFE) continue;
      if (stepGib(this.maze, g, dt)) this.splats.push({ x: g.x, y: g.y, t0: now });
      stillGibs.push(g);
    }
    this.gibs = stillGibs;
    if (this.splats.length > MAX_SPLATS) this.splats.splice(0, this.splats.length - MAX_SPLATS);
    this.splats = this.splats.filter((s) => now - s.t0 < SPLAT_LIFE);
    const playing = this.locked || this.dragging || this.keys.size > 0;
    const still = this.imps.get(this.chaseId);
    if (!still || now > this.chaseUntil) {
      const ranked = [...this.imps.values()].sort((a, b) => b.cpu - a.cpu)[0];
      this.chaseId = ranked?.id ?? "";
      this.chaseUntil = now + 3.2;
    }
    const hot = this.imps.get(this.chaseId) ?? [...this.imps.values()].sort((a, b) => b.cpu - a.cpu)[0];
    let mx = 0, my = 0;
    if (!playing && hot) {
      const next = chaseStep(this.maze, this.px, this.py, hot.x, hot.y);
      const ax = (next?.x ?? hot.x) - this.px;
      const ay = (next?.y ?? hot.y) - this.py;
      const dist = Math.hypot(hot.x - this.px, hot.y - this.py);
      if (ax || ay) {
        const want = Math.atan2(ay, ax);
        const have = Math.atan2(this.dirY, this.dirX);
        let delta = want - have;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        this.turn(clamp(delta, -AUTO_TURN * dt, AUTO_TURN * dt));
      }
      if (dist > 1.15 && (ax || ay)) {
        mx += ax; my += ay;
      }
    }
    if (this.keys.has("w") || this.keys.has("arrowup")) { mx += this.dirX; my += this.dirY; }
    if (this.keys.has("s") || this.keys.has("arrowdown")) { mx -= this.dirX; my -= this.dirY; }
    if (this.keys.has("a")) { mx += this.dirY; my -= this.dirX; }
    if (this.keys.has("d")) { mx -= this.dirY; my += this.dirX; }
    if (this.keys.has("arrowleft")) this.turn(-TURN * dt);
    if (this.keys.has("arrowright")) this.turn(TURN * dt);
    const len = Math.hypot(mx, my);
    const speed = playing ? MOVE : CHASE;
    if (len > 0) this.tryMove(this.px + (mx / len) * speed * dt, this.py + (my / len) * speed * dt);
    this.sfx.step(now, len > 0);
    if (!playing && this.fireCd <= 0 && hot) {
      const wall = castRay(this.maze, this.px, this.py, this.dirX, this.dirY);
      if (spriteHit(this.px, this.py, this.dirX, this.dirY, [hot], wall.dist)) this.fire(false);
    }
  }

  private camX(x: number, y: number, W: number): { sx: number; ty: number } | null {
    const rx = x - this.px, ry = y - this.py;
    const inv = 1 / (this.planeX * this.dirY - this.dirX * this.planeY);
    const tx = inv * (this.dirY * rx - this.dirX * ry);
    const ty = inv * (-this.planeY * rx + this.planeX * ry);
    if (ty < 0.1) return null;
    return { sx: (W / 2) * (1 + tx / ty), ty };
  }

  protected draw(now: number): void {
    const g = this.g, W = this.W;
    const top = this.barTop(), bot = this.footTop();
    const y0 = top, y1 = Math.max(top + 80, bot);
    const mid = (y0 + y1) / 2;
    const u = this.theme.ui;
    const art = doomArt();
    g.imageSmoothingEnabled = false;

    const fW = Math.min(160, Math.max(64, W >> 3));
    const fH = Math.min(80, Math.max(40, (y1 - y0) >> 3));
    if (!this.flats || this.flats.width !== fW || this.flats.height !== fH) {
      this.flats = document.createElement("canvas");
      this.flats.width = fW; this.flats.height = fH;
      this.flatsImg = null;
    }
    const fg = this.flats.getContext("2d")!;
    if (!this.flatsImg || this.flatsImg.width !== fW || this.flatsImg.height !== fH) {
      this.flatsImg = fg.createImageData(fW, fH);
    }
    paintFlats(this.flatsImg, this.px, this.py, this.dirX, this.dirY, this.planeX, this.planeY, art.floorPix, art.ceilPix);
    fg.putImageData(this.flatsImg, 0, 0);
    g.drawImage(this.flats, 0, y0, W, y1 - y0);

    const zbuf = new Float64Array(W);
    const cols = Math.max(80, Math.floor(W / 2));
    const colW = W / cols;
    for (let col = 0; col < cols; col++) {
      const cam = 2 * col / cols - 1;
      const rdx = this.dirX + this.planeX * cam;
      const rdy = this.dirY + this.planeY * cam;
      const hit = castRay(this.maze, this.px, this.py, rdx, rdy);
      const line = clamp((y1 - y0) / hit.dist, 8, y1 - y0);
      const x = Math.floor(col * colW);
      const w = Math.ceil(colW) + 1;
      const inner = hit.mx > 1 && hit.my > 1 && hit.mx < this.maze.w - 2 && hit.my < this.maze.h - 2;
      const tex = inner ? art.stone : art.startan;
      const texX = Math.floor(hit.wallX * TEX);
      const shade = hit.side ? 0.62 : 1;
      const fog = clamp(hit.dist / 12, 0, 0.72);
      drawTexColumn(g, tex, texX, x, mid - line / 2, w, line, shade, fog);
      for (let i = 0; i < w && x + i < W; i++) zbuf[x + i] = hit.dist;
    }

    const imps = [...this.imps.values()].map((s) => {
      const rx = s.x - this.px, ry = s.y - this.py;
      const inv = 1 / (this.planeX * this.dirY - this.dirX * this.planeY);
      const tx = inv * (this.dirY * rx - this.dirX * ry);
      const ty = inv * (-this.planeY * rx + this.planeX * ry);
      return { s, tx, ty };
    }).filter((x) => x.ty > 0.12).sort((a, b) => b.ty - a.ty);

    this.hover = "";
    for (const { s, tx, ty } of imps) {
      const sx = (W / 2) * (1 + tx / ty);
      const size = clamp((y1 - y0) / ty * (0.42 + 0.22 * Math.min(1, s.cpu / CPU_RED)), 22, SPRITE_MAX);
      const left = Math.floor(sx - size / 2);
      const right = Math.floor(sx + size / 2);
      if (right < 0 || left >= W) continue;
      let vis = false;
      for (let x = Math.max(0, left); x < Math.min(W, right); x++) {
        if (ty < (zbuf[x] || 99)) { vis = true; break; }
      }
      if (!vis) continue;
      if (s.gib > 0.08) continue;
      const body = s.cpu >= 40 ? art.baron : art.imp;
      g.save();
      if (s.flash > 0.05) g.filter = "brightness(2.2)";
      drawSpriteClipped(g, body, sx, mid, size, zbuf, ty);
      g.restore();
      g.filter = "none";
      g.globalAlpha = 0.9;
      g.font = `11px ${this.font}`; g.textAlign = "center"; g.textBaseline = "top";
      g.fillStyle = s.color;
      const label = fitText(g, `${s.name} ${s.cpu.toFixed(0)}%`, size + 48);
      g.fillText(label, sx, mid + size / 2 + 2);
      g.globalAlpha = 1;
      if (Math.abs(sx - W / 2) < size * 0.45) this.hover = `${s.name} · ${s.cpu.toFixed(1)}% · ${s.core}`;
    }

    for (const r of this.rockets) {
      for (let i = 4; i >= 1; i--) {
        const trail = this.camX(r.x - r.dx * i * 0.14, r.y - r.dy * i * 0.14, W);
        if (!trail) continue;
        g.fillStyle = "#ffab40";
        g.globalAlpha = 0.18 * i;
        g.beginPath(); g.arc(trail.sx, mid, Math.max(2, 5 / trail.ty), 0, Math.PI * 2); g.fill();
      }
      const p = this.camX(r.x, r.y, W);
      if (p) {
        const size = clamp((y1 - y0) / p.ty * 0.2, 12, 48);
        drawSpriteClipped(g, art.rocket, p.sx, mid, size, zbuf, p.ty);
      }
      g.globalAlpha = 1;
    }

    for (const s of this.splats) {
      const p = this.camX(s.x, s.y, W);
      if (!p) continue;
      const k = remainFade(now - s.t0, SPLAT_LIFE);
      const line = (y1 - y0) / p.ty;
      const size = clamp(line * 0.18, 10, 64);
      g.globalAlpha = 0.7 * k;
      drawSpriteClipped(g, art.blood, p.sx, mid + line / 2 - size * 0.28, size, zbuf, p.ty);
      g.globalAlpha = 1;
    }

    for (const b of this.booms) {
      const p = this.camX(b.x, b.y, W);
      if (!p) continue;
      const age = now - b.t0;
      const k = clamp(1 - age / 0.45, 0, 1);
      const size = clamp((y1 - y0) / p.ty * (0.7 + (1 - k) * 1.1), 28, 180);
      g.globalAlpha = 0.4 * k;
      g.fillStyle = "#ff6d00";
      g.beginPath(); g.arc(p.sx, mid, size * 0.5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = k;
      drawSpriteClipped(g, art.boom, p.sx, mid, size, zbuf, p.ty);
      g.globalAlpha = 1;
    }

    for (const chunk of this.gibs) {
      const p = this.camX(chunk.x, chunk.y, W);
      if (!p) continue;
      const grounded = chunk.z < 0.06;
      const line = (y1 - y0) / p.ty;
      const size = clamp(line * (grounded ? 0.16 : 0.18 + chunk.z * 0.2), 12, 58);
      const cy = grounded
        ? mid + line / 2 - size * 0.35
        : mid - chunk.z * ((y1 - y0) * 0.32) / Math.max(0.2, p.ty);
      const spr = art.gibs[chunk.kind] ?? art.gibs[0]!;
      g.globalAlpha = remainFade(now - chunk.t0, GIB_LIFE);
      drawSpriteClipped(g, spr, p.sx, cy, size, zbuf, p.ty);
      g.globalAlpha = 1;
    }

    const gunX = W / 2 + 128;
    const gunY = y1 - 36 + this.kick * 22;
    const gw = 220, gh = 86;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.4;
    g.drawImage(art.launcher, gunX - gw / 2 + 5, gunY - gh / 2 + 4, gw, gh);
    g.globalAlpha = 1;
    g.drawImage(art.launcher, gunX - gw / 2, gunY - gh / 2, gw, gh);
    if (this.kick > 0.2) {
      g.fillStyle = "#ffe082";
      g.globalAlpha = this.kick * 0.95;
      g.beginPath();
      g.arc(gunX - 92, gunY - 6, 10 + this.kick * 14, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    g.strokeStyle = u.fg; g.globalAlpha = 0.8; g.lineWidth = 1;
    g.beginPath(); g.moveTo(W / 2 - 8, mid); g.lineTo(W / 2 + 8, mid); g.moveTo(W / 2, mid - 8); g.lineTo(W / 2, mid + 8); g.stroke();
    g.globalAlpha = 1;

    g.font = `12px ${this.font}`; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillStyle = u.fg;
    g.fillText(`${this.hostName}  ${this.hostPct.toFixed(0)}%  ·  ${this.imps.size} processes  ·  ${this.stats.hits}/${this.stats.shots} rockets`, 16, y0 + 16);
    g.fillStyle = u.muted; g.font = `11px ${this.font}`;
    g.fillText(this.locked || this.dragging ? "rocket launcher · WASD walk · drag to look · click/space fire" : "chasing the busiest process · rocket launcher · WASD to take over · rockets do not kill", 16, y0 + 34);
    if (this.hover) {
      g.fillStyle = u.fg; g.textAlign = "center";
      g.fillText(this.hover, W / 2, y0 + 16);
    }
    this.log.draw(g, u, this.font, 16, y1 - this.log.height - 8, Math.min(420, W * 0.42), now);
    if (!this.imps.size) this.drawIdle(now, "waiting for busy processes…", W / 2, mid);
  }
}
