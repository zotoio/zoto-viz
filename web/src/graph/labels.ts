import * as THREE from "three";

/**
 * DOM labels anchored to world positions — a lean replacement for three's CSS2DRenderer.
 *
 * CSS2DRenderer walks the whole scene graph every frame, updates every object's world matrix, and
 * sorts all labels by depth, whether or not they are visible. With thousands of nodes and a few
 * dozen visible labels that is most of a frame of DOM work for nothing. This layer keeps a flat set
 * of items, projects only the visible ones with one matrix multiply each, and touches an element's
 * style only when its state changes.
 *
 * When several names land on the same screen pixels, only the most active stay. Selection / hover
 * and overlay chrome are pinned so they never lose that fight.
 */
export class LabelItem {
  readonly position = new THREE.Vector3();
  /** owner-driven: the layer only draws items with this set */
  visible = false;
  /** last state written to the DOM */
  shown = false;
  attached = false;
  /** Higher wins when two labels cover the same pixels. */
  rank = 0;
  /** Always drawn; still occupies space so quieter names hide under it. */
  pinned = false;
  /** Cached layout box; 0 means estimate until the element is attached. */
  boxW = 0;
  boxH = 0;

  constructor(readonly element: HTMLElement) {
    element.style.position = "absolute";
    element.style.userSelect = "none";
    element.setAttribute("draggable", "false");
  }

  invalidateBox(): void {
    this.boxW = 0;
    this.boxH = 0;
  }
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  pinned: boolean;
  shown: boolean;
}

const OVERLAP_PAD = 4;

export function boxesOverlap(a: LabelBox, b: LabelBox, pad = OVERLAP_PAD): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2
    && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;
}

/**
 * Greedy declutter: pinned first, then rank, then already-shown (so a pair does not flicker),
 * then keep a box only when it does not cover a higher-priority keeper.
 */
export function declutterLabels(boxes: LabelBox[]): boolean[] {
  const order = boxes.map((_, i) => i);
  order.sort((ia, ib) => {
    const a = boxes[ia]!, b = boxes[ib]!;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (a.shown !== b.shown) return a.shown ? -1 : 1;
    return ia - ib;
  });
  const keep = boxes.map((b) => b.pinned);
  const kept: LabelBox[] = [];
  for (const i of order) {
    const box = boxes[i]!;
    if (box.pinned || !kept.some((k) => boxesOverlap(box, k))) {
      keep[i] = true;
      kept.push(box);
    }
  }
  return keep;
}

/** Rate + lifetime bytes → a stable-ish rank so talkers beat idle neighbours. */
export function labelActivity(rate: number, bytes: number): number {
  return Math.max(0, rate) * 100 + Math.log10(1 + Math.max(0, bytes)) * 10;
}

function estimateBox(el: HTMLElement): { w: number; h: number } {
  const text = el.textContent ?? "";
  const lines = 1 + (el.getElementsByTagName("small").length);
  const fs = 11;
  return { w: Math.max(48, text.length * fs * 0.42), h: lines * fs * 1.35 + 6 };
}

const _v = new THREE.Vector3();
const _viewProj = new THREE.Matrix4();
const _proj: { it: LabelItem; x: number; y: number; z: number }[] = [];

export class LabelLayer {
  readonly domElement: HTMLDivElement;
  private readonly items = new Set<LabelItem>();
  private w = 0;
  private h = 0;

  constructor() {
    this.domElement = document.createElement("div");
    this.domElement.style.overflow = "hidden";
  }

  get size(): number { return this.items.size; }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.domElement.style.width = `${w}px`;
    this.domElement.style.height = `${h}px`;
  }

  add(item: LabelItem): void {
    this.items.add(item);
  }

  /** Forget the item and drop its element from the DOM. */
  remove(item: LabelItem): void {
    this.items.delete(item);
    item.element.remove();
    item.attached = false;
    item.shown = false;
  }

  /** Place every visible item for `camera`. Call after the 3D render so the camera matrices are current. */
  render(camera: THREE.Camera): void {
    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const w = this.w, h = this.h;
    _proj.length = 0;
    for (const it of this.items) {
      const el = it.element;
      if (!it.visible) {
        if (it.shown) { el.style.display = "none"; it.shown = false; }
        continue;
      }
      _v.copy(it.position).applyMatrix4(_viewProj);
      // behind the camera or outside the depth range: hidden, like CSS2DRenderer
      if (_v.z < -1 || _v.z > 1 || Number.isNaN(_v.x)) {
        if (it.shown) { el.style.display = "none"; it.shown = false; }
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      _proj.push({ it, x, y, z: _v.z });
    }
    const boxes: LabelBox[] = _proj.map(({ it, x, y }) => {
      if (it.attached && (it.boxW < 2 || it.boxH < 2)) {
        const bw = it.element.offsetWidth;
        const bh = it.element.offsetHeight;
        if (bw > 0 && bh > 0) { it.boxW = bw; it.boxH = bh; }
      }
      const est = (it.boxW < 2 || it.boxH < 2) ? estimateBox(it.element) : null;
      return {
        x, y,
        w: est ? est.w : it.boxW,
        h: est ? est.h : it.boxH,
        rank: it.rank,
        pinned: it.pinned,
        shown: it.shown,
      };
    });
    const keep = declutterLabels(boxes);
    for (let i = 0; i < _proj.length; i++) {
      const { it, x, y, z } = _proj[i]!;
      const el = it.element;
      if (!keep[i]) {
        if (it.shown) { el.style.display = "none"; it.shown = false; }
        continue;
      }
      el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      // closer labels stack on top; the NDC depth is monotonic in view distance
      el.style.zIndex = String(Math.round((1 - z) * 50000));
      if (!it.attached) { this.domElement.appendChild(el); it.attached = true; }
      if (!it.shown) { el.style.display = ""; it.shown = true; }
    }
  }
}
