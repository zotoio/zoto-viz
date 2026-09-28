/**
 * Canvas 2D projection of the live graph. Used when WebGL is missing (Cursor / Electron
 * Simple Browser disables the GPU). Layout, camera, and labels stay on the Three.js CPU path.
 */

import * as THREE from "three";

export interface SoftRect { x: number; y: number; w: number; h: number }

export interface SoftNode {
  x: number; y: number; z: number;
  scale: number;
  r: number; g: number; b: number; a: number;
  glow: number;
  /** 0–6 (sphere…drone); 2D draws a plus for drones */
  shape?: number;
  selected?: boolean;
  hovered?: boolean;
}

export interface SoftSeg {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  r: number; g: number; b: number; a?: number;
}

export interface SoftMark {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

export interface SoftMesh {
  /** World-space positions, 3 floats per vertex. */
  pos: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
  verts: number;
  indices: number;
}

export interface SoftGraph {
  clearHex: number;
  rimHex: number;
  dark: boolean;
  gridMajor?: number;
  gridMinor?: number;
  /** World-space floor under the cloud (same pose as the WebGL grid). */
  floor?: { x: number; y: number; z: number; span: number };
  nodes: SoftNode[];
  segs: SoftSeg[];
  particles: SoftMark[];
  /** Projected fabric mesh. When set, discs and straight segments are skipped. */
  mesh?: SoftMesh;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _ndc = { x: 0, y: 0, z: 0 };

export function cssHex(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

export function rgba(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${Math.max(0, Math.min(1, a))})`;
}

/** Project world → pane CSS pixels. false when the point is behind the camera or non-finite. */
export function projectPane(
  x: number, y: number, z: number,
  camera: THREE.Camera,
  rect: SoftRect,
  out: { x: number; y: number; z: number } = _ndc,
): boolean {
  _p.set(x, y, z).project(camera);
  if (!Number.isFinite(_p.x) || !Number.isFinite(_p.y) || _p.z < -1 || _p.z > 1) return false;
  out.x = rect.x + (_p.x * 0.5 + 0.5) * rect.w;
  out.y = rect.y + (-_p.y * 0.5 + 0.5) * rect.h;
  out.z = _p.z;
  return true;
}

export function worldPx(scale: number, wx: number, wy: number, wz: number, camera: THREE.Camera, rect: SoftRect): number {
  const persp = camera as THREE.PerspectiveCamera;
  const dist = Math.max(8, camera.position.distanceTo(_q.set(wx, wy, wz)));
  const fov = ((persp.fov || 55) * Math.PI) / 180;
  return Math.max(1.6, scale * (rect.h / (2 * Math.tan(fov / 2))) / dist);
}

export function paintSoftwareGraph(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  rect: SoftRect,
  graph: SoftGraph,
): void {
  if (rect.w < 2 || rect.h < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  const clear = cssHex(graph.clearHex);
  const rim = cssHex(graph.rimHex);
  const fill = ctx.createRadialGradient(
    rect.x + rect.w * 0.5, rect.y + rect.h * 0.38, rect.h * 0.08,
    rect.x + rect.w * 0.5, rect.y + rect.h * 0.55, rect.h * 0.95,
  );
  fill.addColorStop(0, rim);
  fill.addColorStop(0.45, clear);
  fill.addColorStop(1, clear);
  ctx.globalAlpha = graph.dark ? 0.22 : 0.14;
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = clear;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = "source-over";

  paintFloor(ctx, camera, rect, graph);
  if (graph.mesh && graph.mesh.indices >= 3) paintSoftwareMesh(ctx, camera, rect, graph.mesh);

  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const meshOn = !!graph.mesh && graph.mesh.indices >= 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (!meshOn) {
  for (const s of graph.segs) {
    const okA = projectPane(s.ax, s.ay, s.az, camera, rect, a);
    const okB = projectPane(s.bx, s.by, s.bz, camera, rect, b);
    if (!okA && !okB) continue;
    if (!okA || !okB) continue;
    ctx.strokeStyle = rgba(s.r, s.g, s.b, s.a ?? 0.85);
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  }

  for (const p of graph.particles) {
    if (!projectPane(p.x, p.y, p.z, camera, rect, a)) continue;
    ctx.fillStyle = rgba(p.r, p.g, p.b, 0.95);
    ctx.beginPath();
    ctx.arc(a.x, a.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const drawn: { n: SoftNode; x: number; y: number; z: number; rad: number }[] = [];
  if (!meshOn) {
  for (const n of graph.nodes) {
    if (!projectPane(n.x, n.y, n.z, camera, rect, a)) continue;
    drawn.push({ n, x: a.x, y: a.y, z: a.z, rad: worldPx(n.scale, n.x, n.y, n.z, camera, rect) });
  }
  }
  drawn.sort((p, q) => q.z - p.z);
  for (const d of drawn) {
    const { n, x, y, rad } = d;
    if (n.glow > 0.2 || n.selected || n.hovered) {
      ctx.fillStyle = rgba(n.r, n.g, n.b, 0.18 + 0.28 * n.glow);
      ctx.beginPath();
      ctx.arc(x, y, rad * (1.7 + n.glow), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = rgba(n.r, n.g, n.b, n.a);
    if ((n.shape ?? 0) >= 5.5) {
      paintSoftDrone(ctx, x, y, rad);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    if (n.selected || n.hovered) {
      ctx.strokeStyle = rgba(1, 1, 1, n.selected ? 0.85 : 0.45);
      ctx.lineWidth = n.selected ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(x, y, rad * ((n.shape ?? 0) >= 5.5 ? 1.15 : 1), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function paintSoftDrone(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number): void {
  const arm = rad * 1.35;
  const thick = Math.max(1.2, rad * 0.32);
  ctx.fillRect(x - arm, y - thick / 2, arm * 2, thick);
  ctx.fillRect(x - thick / 2, y - arm, thick, arm * 2);
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ctx.beginPath();
    ctx.arc(x + dx * arm * 0.78, y + dy * arm * 0.78, rad * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}

let rastW = 0;
let rastH = 0;
let rastColor = new Uint8ClampedArray(0);
let rastDepth = new Float32Array(0);
let rastProj = new Float32Array(0);
let rastCanvas: HTMLCanvasElement | null = null;

/** Perspective fill of a fabric mesh. Used when the embedded browser has no WebGL. */
export function paintSoftwareMesh(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  rect: SoftRect,
  mesh: SoftMesh,
): void {
  const bw = Math.max(2, Math.min(480, Math.floor(rect.w)));
  const bh = Math.max(2, Math.floor(rect.h * bw / Math.max(1, rect.w)));
  if (bw !== rastW || bh !== rastH) {
    rastW = bw;
    rastH = bh;
    rastColor = new Uint8ClampedArray(bw * bh * 4);
    rastDepth = new Float32Array(bw * bh);
    rastCanvas = null;
  }
  rastColor.fill(0);
  rastDepth.fill(2);
  const verts = mesh.verts;
  if (rastProj.length < verts * 3) rastProj = new Float32Array(verts * 3);
  const pos = mesh.pos;
  for (let i = 0; i < verts; i++) {
    _p.set(pos[i * 3] ?? 0, pos[i * 3 + 1] ?? 0, pos[i * 3 + 2] ?? 0).project(camera);
    rastProj[i * 3] = ( _p.x * 0.5 + 0.5) * bw;
    rastProj[i * 3 + 1] = (-_p.y * 0.5 + 0.5) * bh;
    rastProj[i * 3 + 2] = _p.z;
  }
  const idx = mesh.idx;
  const col = mesh.col;
  const tris = Math.floor(mesh.indices / 3);
  const stride = Math.max(1, Math.ceil(tris / 4500));
  const lx = 0.28, ly = 0.86, lz = 0.32;
  for (let t = 0; t < tris; t += stride) {
    const ia = idx[t * 3] ?? 0, ib = idx[t * 3 + 1] ?? 0, ic = idx[t * 3 + 2] ?? 0;
    if (ia >= verts || ib >= verts || ic >= verts) continue;
    const ax = rastProj[ia * 3] ?? 0, ay = rastProj[ia * 3 + 1] ?? 0, az = rastProj[ia * 3 + 2] ?? 0;
    const bx = rastProj[ib * 3] ?? 0, by = rastProj[ib * 3 + 1] ?? 0, bz = rastProj[ib * 3 + 2] ?? 0;
    const cx = rastProj[ic * 3] ?? 0, cy = rastProj[ic * 3 + 1] ?? 0, cz = rastProj[ic * 3 + 2] ?? 0;
    if (az < -1 || az > 1 || bz < -1 || bz > 1 || cz < -1 || cz > 1) continue;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 0.4) continue;
    const wx0 = pos[ia * 3] ?? 0, wy0 = pos[ia * 3 + 1] ?? 0, wz0 = pos[ia * 3 + 2] ?? 0;
    const wx1 = pos[ib * 3] ?? 0, wy1 = pos[ib * 3 + 1] ?? 0, wz1 = pos[ib * 3 + 2] ?? 0;
    const wx2 = pos[ic * 3] ?? 0, wy2 = pos[ic * 3 + 1] ?? 0, wz2 = pos[ic * 3 + 2] ?? 0;
    let nx = (wy1 - wy0) * (wz2 - wz0) - (wz1 - wz0) * (wy2 - wy0);
    let ny = (wz1 - wz0) * (wx2 - wx0) - (wx1 - wx0) * (wz2 - wz0);
    let nz = (wx1 - wx0) * (wy2 - wy0) - (wy1 - wy0) * (wx2 - wx0);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const shade = 0.32 + 0.68 * Math.abs(nx * lx + ny * ly + nz * lz);
    const r = Math.min(255, ((col[ia * 3] ?? 0) + (col[ib * 3] ?? 0) + (col[ic * 3] ?? 0)) / 3 * shade * 255);
    const g = Math.min(255, ((col[ia * 3 + 1] ?? 0) + (col[ib * 3 + 1] ?? 0) + (col[ic * 3 + 1] ?? 0)) / 3 * shade * 255);
    const bch = Math.min(255, ((col[ia * 3 + 2] ?? 0) + (col[ib * 3 + 2] ?? 0) + (col[ic * 3 + 2] ?? 0)) / 3 * shade * 255);
    let minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    let maxX = Math.min(bw - 1, Math.ceil(Math.max(ax, bx, cx)));
    let minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    let maxY = Math.min(bh - 1, Math.ceil(Math.max(ay, by, cy)));
    if (maxX < minX || maxY < minY) continue;
    const inv = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = az * w0 + bz * w1 + cz * w2;
        const pi = y * bw + x;
        if (z >= (rastDepth[pi] ?? 2)) continue;
        rastDepth[pi] = z;
        const o = pi * 4;
        rastColor[o] = r;
        rastColor[o + 1] = g;
        rastColor[o + 2] = bch;
        rastColor[o + 3] = 235;
      }
    }
  }
  if (!rastCanvas) rastCanvas = document.createElement("canvas");
  if (rastCanvas.width !== bw || rastCanvas.height !== bh) {
    rastCanvas.width = bw;
    rastCanvas.height = bh;
  }
  const ictx = rastCanvas.getContext("2d");
  if (!ictx) return;
  ictx.putImageData(new ImageData(rastColor, bw, bh), 0, 0);
  ctx.drawImage(rastCanvas, rect.x, rect.y, rect.w, rect.h);
}

function paintFloor(
  ctx: CanvasRenderingContext2D,
  camera: THREE.Camera,
  rect: SoftRect,
  graph: SoftGraph,
): void {
  const major = graph.gridMajor ?? graph.rimHex;
  const minor = graph.gridMinor ?? graph.clearHex;
  const ox = graph.floor?.x ?? 0;
  const oy = graph.floor?.y ?? 0;
  const oz = graph.floor?.z ?? 0;
  const span = graph.floor?.span ?? 720;
  const step = Math.max(40, span / 6);
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  ctx.lineWidth = 1;
  for (let t = -span; t <= span; t += step) {
    const hi = t === 0 || t % (step * 2) === 0;
    ctx.strokeStyle = cssHex(hi ? major : minor);
    ctx.globalAlpha = hi ? (graph.dark ? 0.28 : 0.22) : (graph.dark ? 0.12 : 0.1);
    if (projectPane(ox - span, oy, oz + t, camera, rect, a) && projectPane(ox + span, oy, oz + t, camera, rect, b)) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (projectPane(ox + t, oy, oz - span, camera, rect, a) && projectPane(ox + t, oy, oz + span, camera, rect, b)) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Phosphor rain when WebGL plugin skies cannot run (software path / blank-stage screenshots). */
export function paintSoftwarePluginRain(
  ctx: CanvasRenderingContext2D,
  rect: SoftRect,
  t: number,
  audio = 0,
  text = "HN RAIN",
): void {
  if (rect.w < 2 || rect.h < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = "rgb(0, 4, 2)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const glyphs = (text || "HN RAIN").toUpperCase();
  const cols = Math.max(12, Math.floor(rect.w / 16));
  const cw = rect.w / cols;
  const rows = Math.max(10, Math.floor(rect.h / 18));
  const ch = rect.h / rows;
  ctx.font = `${Math.max(10, Math.floor(ch * 0.8))}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < cols; c++) {
    const speed = 0.09 + ((c * 17) % 10) / 70 + audio * 0.1;
    const shift = ((t * speed * rows) + c * 3) % rows;
    for (let r = 0; r < rows; r++) {
      const fall = ((r + shift) % rows) / rows;
      const head = fall < 0.12 ? 1 - fall / 0.12 : 0;
      const trail = 1 - fall;
      const gi = (c * 5 + r + Math.floor(t * 2) + glyphs.length) % glyphs.length;
      const g = 40 + trail * 70 + head * 50;
      ctx.fillStyle = `rgba(${12 + head * 28}, ${g}, ${16 + head * 18}, ${0.22 + trail * 0.35 + head * 0.28})`;
      ctx.fillText(glyphs[gi] ?? " ", rect.x + c * cw + cw * 0.5, rect.y + r * ch + ch * 0.5);
    }
  }
  ctx.restore();
}
