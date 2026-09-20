/** Coalesce ResizeObserver work onto the next frame so layout cannot loop. */
export function observeResize(el: Element, onResize: () => void): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  let pending = false;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      onResize();
    });
  });
  ro.observe(el);
  return ro;
}

function resizeLoopMessage(msg: string): boolean {
  return msg.includes("ResizeObserver loop");
}

/** Chrome reports a benign ResizeObserver loop as an uncaught error; Vite then logs it. */
export function ignoreResizeLoopError(): void {
  if (typeof window === "undefined") return;
  window.addEventListener(
    "error",
    (e) => {
      if (!resizeLoopMessage(e.message || "")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
    if (resizeLoopMessage(msg)) e.preventDefault();
  });
}
