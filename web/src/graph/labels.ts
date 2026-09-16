import * as THREE from "three";

/**
 * DOM labels anchored to world positions — a lean replacement for three's CSS2DRenderer.
 *
 * CSS2DRenderer walks the whole scene graph every frame, updates every object's world matrix, and
 * sorts all labels by depth, whether or not they are visible. With thousands of nodes and a few
 * dozen visible labels that is most of a frame of DOM work for nothing. This layer keeps a flat set
 * of items, projects only the visible ones with one matrix multiply each, and touches an element's
 * style only when its state changes.
 */
export class LabelItem {
  readonly position = new THREE.Vector3();
  /** owner-driven: the layer only draws items with this set */
  visible = false;
  /** last state written to the DOM */
  shown = false;
  attached = false;

  constructor(readonly element: HTMLElement) {
    element.style.position = "absolute";
    element.style.userSelect = "none";
    element.setAttribute("draggable", "false");
  }
}

const _v = new THREE.Vector3();
const _viewProj = new THREE.Matrix4();

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
      el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      // closer labels stack on top; the NDC depth is monotonic in view distance
      el.style.zIndex = String(Math.round((1 - _v.z) * 50000));
      if (!it.attached) { this.domElement.appendChild(el); it.attached = true; }
      if (!it.shown) { el.style.display = ""; it.shown = true; }
    }
  }
}
