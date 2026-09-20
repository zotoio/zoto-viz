export const FLOAT_STORE = "zoto-viz.float.";

export interface FloatPos {
  x: number;
  y: number;
}

export interface FloatRect extends FloatPos {
  w?: number;
  h?: number;
}

export interface FloatMin {
  w: number;
  h: number;
}

export const DEFAULT_FLOAT_MIN: FloatMin = { w: 220, h: 140 };
/** Pixels of the panel that must stay on-screen so a hang-off can still be grabbed. */
export const FLOAT_KEEP = 48;

export function floatStoreKey(id: string): string {
  return `${FLOAT_STORE}${id}`;
}

export function readFloatRect(id: string): FloatRect | null {
  try {
    const raw = localStorage.getItem(floatStoreKey(id));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<FloatRect>;
    const x = Number(j.x);
    const y = Number(j.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const w = Number(j.w);
    const h = Number(j.h);
    return {
      x,
      y,
      ...(Number.isFinite(w) && w > 0 ? { w } : {}),
      ...(Number.isFinite(h) && h > 0 ? { h } : {}),
    };
  } catch {
    return null;
  }
}

export function readFloatPos(id: string): FloatPos | null {
  const box = readFloatRect(id);
  return box ? { x: box.x, y: box.y } : null;
}

export function writeFloatRect(id: string, box: FloatRect): void {
  const out: FloatRect = { x: box.x, y: box.y };
  if (box.w && box.w > 0) out.w = box.w;
  if (box.h && box.h > 0) out.h = box.h;
  localStorage.setItem(floatStoreKey(id), JSON.stringify(out));
}

export function writeFloatPos(id: string, pos: FloatPos): void {
  writeFloatRect(id, { ...readFloatRect(id), ...pos });
}

export function viewSize(): { w: number; h: number } {
  return {
    w: typeof innerWidth === "number" ? innerWidth : 800,
    h: typeof innerHeight === "number" ? innerHeight : 600,
  };
}

export function clampFloatPos(
  pos: FloatPos,
  size: { width: number; height: number },
  view = viewSize(),
): FloatPos {
  const keep = FLOAT_KEEP;
  const w = Math.max(keep, size.width || 0);
  const h = Math.max(32, size.height || 0);
  return {
    x: Math.max(keep - w, Math.min(pos.x, view.w - keep)),
    y: Math.max(keep - h, Math.min(pos.y, view.h - keep)),
  };
}

export function clampFloatRect(box: FloatRect, min: FloatMin = DEFAULT_FLOAT_MIN, view = viewSize()): FloatRect {
  const w = Math.max(min.w, Math.min(box.w || min.w, Math.max(min.w, view.w - 16)));
  const h = Math.max(min.h, Math.min(box.h || min.h, Math.max(min.h, view.h - 16)));
  const pos = clampFloatPos({ x: box.x, y: box.y }, { width: w, height: h }, view);
  return { ...pos, w, h };
}

export function applyFloatRect(el: HTMLElement, box: FloatRect, min: FloatMin = DEFAULT_FLOAT_MIN): FloatRect {
  const sized = (box.w ?? 0) > 0 && (box.h ?? 0) > 0;
  const rect = el.getBoundingClientRect();
  const next = clampFloatRect({
    x: box.x,
    y: box.y,
    w: sized ? box.w : (rect.width || min.w),
    h: sized ? box.h : (rect.height || min.h),
  }, min);
  el.style.setProperty("--float-x", `${Math.round(next.x)}px`);
  el.style.setProperty("--float-y", `${Math.round(next.y)}px`);
  el.classList.add("floated");
  if (sized) {
    el.style.setProperty("--float-w", `${Math.round(next.w!)}px`);
    el.style.setProperty("--float-h", `${Math.round(next.h!)}px`);
    el.classList.add("sized");
  }
  return next;
}

export function applyFloatPos(el: HTMLElement, pos: FloatPos, min: FloatMin = DEFAULT_FLOAT_MIN): FloatPos {
  const w = el.classList.contains("sized") ? Number.parseFloat(el.style.getPropertyValue("--float-w")) : NaN;
  const h = el.classList.contains("sized") ? Number.parseFloat(el.style.getPropertyValue("--float-h")) : NaN;
  return applyFloatRect(el, {
    ...pos,
    ...(Number.isFinite(w) ? { w } : {}),
    ...(Number.isFinite(h) ? { h } : {}),
  }, min);
}

function snapshot(el: HTMLElement, min: FloatMin): FloatRect {
  const r = el.getBoundingClientRect();
  const sized = el.classList.contains("sized");
  return clampFloatRect({
    x: r.left,
    y: r.top,
    w: sized || r.width > 0 ? r.width : undefined,
    h: sized || r.height > 0 ? r.height : undefined,
  }, min);
}

const SKIP_INTERACTIVE = "button, a, input, textarea, select, option, canvas, .close, .float-resize, .btn, [role='slider'], [role='option'], [role='listbox']";
const SKIP_TEXT = ".feed-ticker, .feed-ask, .debuglog-ticker, .debuglog-line, .sbody, .tx, pre, code, label";

export function canFloatDrag(target: EventTarget | null, root: HTMLElement): boolean {
  const node = target instanceof Node ? target : null;
  const t = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  if (!t || !root.contains(t)) return false;
  if (t.closest(SKIP_INTERACTIVE)) return false;
  if (t.closest(SKIP_TEXT)) return false;
  return true;
}

export function bindFloatPanel(el: HTMLElement, handle: HTMLElement, id: string, opts?: {
  pin?: () => void;
  min?: FloatMin;
}): void {
  const min = opts?.min ?? DEFAULT_FLOAT_MIN;
  handle.classList.add("float-handle");
  if (!handle.title) handle.title = "drag to move";
  el.classList.add("float-panel");
  let grip = el.querySelector<HTMLElement>(":scope > .float-resize");
  if (!grip) {
    grip = document.createElement("div");
    grip.className = "float-resize";
    grip.title = "drag to resize";
    el.append(grip);
  }
  const saved = readFloatRect(id);
  if (saved) applyFloatRect(el, saved, min);

  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (el.hidden || el.getBoundingClientRect().width < 8) return;
    if (!canFloatDrag(e.target, el)) return;
    e.preventDefault();
    opts?.pin?.();
    const rect = el.getBoundingClientRect();
    const origin = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    el.classList.add("dragging");
    try { el.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
    const onMove = (ev: PointerEvent) => {
      applyFloatRect(el, {
        x: origin.left + ev.clientX - origin.x,
        y: origin.top + ev.clientY - origin.y,
        w: el.classList.contains("sized") ? rect.width : undefined,
        h: el.classList.contains("sized") ? rect.height : undefined,
      }, min);
    };
    const onUp = () => {
      try { el.releasePointerCapture(e.pointerId); } catch { /* capture optional */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("dragging");
      writeFloatRect(id, snapshot(el, min));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (el.hidden || el.getBoundingClientRect().width < 8) return;
    e.preventDefault();
    e.stopPropagation();
    opts?.pin?.();
    const rect = el.getBoundingClientRect();
    const origin = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, left: rect.left, top: rect.top };
    el.classList.add("resizing");
    try { grip.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
    const onMove = (ev: PointerEvent) => {
      applyFloatRect(el, {
        x: origin.left,
        y: origin.top,
        w: origin.w + ev.clientX - origin.x,
        h: origin.h + ev.clientY - origin.y,
      }, min);
    };
    const onUp = () => {
      try { grip.releasePointerCapture(e.pointerId); } catch { /* capture optional */ }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("resizing");
      writeFloatRect(id, snapshot(el, min));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

/** @deprecated use bindFloatPanel */
export function bindFloatDrag(el: HTMLElement, handle: HTMLElement, id: string, opts?: { pin?: () => void; min?: FloatMin }): void {
  bindFloatPanel(el, handle, id, opts);
}
