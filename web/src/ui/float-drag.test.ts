import { afterEach, describe, expect, it } from "vitest";
import { applyFloatRect, bindFloatPanel, canFloatDrag, clampFloatPos, clampFloatRect, FLOAT_KEEP, FLOAT_STORE, readFloatRect, writeFloatRect } from "./float-drag";

afterEach(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(FLOAT_STORE)) localStorage.removeItem(key);
  }
  document.body.replaceChildren();
});

function stubRect(el: HTMLElement, box: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: box.left, top: box.top, width: box.width, height: box.height,
      right: box.left + box.width, bottom: box.top + box.height,
      x: box.left, y: box.top, toJSON() {},
    }),
  });
}

describe("float positions", () => {
  it("round-trips and keeps a sliver on-screen", () => {
    expect(readFloatRect("feed")).toBeNull();
    writeFloatRect("feed", { x: 40, y: 80, w: 320, h: 240 });
    expect(readFloatRect("feed")).toEqual({ x: 40, y: 80, w: 320, h: 240 });
    expect(clampFloatPos({ x: -20, y: 900 }, { width: 200, height: 100 }, { w: 400, h: 300 })).toEqual({
      x: -20, y: 300 - FLOAT_KEEP,
    });
    expect(clampFloatRect({ x: 12, y: 16, w: 40, h: 20 }, { w: 180, h: 120 }, { w: 400, h: 300 })).toEqual({
      x: 12, y: 16, w: 180, h: 120,
    });
  });

  it("allows a partial hang-off and still clamps a fully off-screen box", () => {
    expect(clampFloatPos({ x: -120, y: -10 }, { width: 200, height: 80 }, { w: 400, h: 300 })).toEqual({
      x: -120, y: -10,
    });
    expect(clampFloatPos({ x: -400, y: 800 }, { width: 200, height: 80 }, { w: 400, h: 300 })).toEqual({
      x: FLOAT_KEEP - 200, y: 300 - FLOAT_KEEP,
    });
    expect(clampFloatPos({ x: 380, y: 280 }, { width: 200, height: 80 }, { w: 400, h: 300 })).toEqual({
      x: 400 - FLOAT_KEEP, y: 300 - FLOAT_KEEP,
    });
    expect(clampFloatRect({ x: -80, y: 24, w: 300, h: 200 }, { w: 220, h: 140 }, { w: 1280, h: 800 })).toEqual({
      x: -80, y: 24, w: 300, h: 200,
    });
  });

  it("drags from the handle and remembers the spot", () => {
    const el = document.createElement("div");
    const handle = document.createElement("div");
    handle.textContent = "feed";
    el.append(handle);
    document.body.append(el);
    stubRect(el, { left: 20, top: 30, width: 200, height: 80 });
    bindFloatPanel(el, handle, "feed");
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 30, clientY: 40, bubbles: true }));
    stubRect(el, { left: 70, top: 60, width: 200, height: 80 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 80, clientY: 70, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 80, clientY: 70, bubbles: true }));
    expect(el.classList.contains("floated")).toBe(true);
    expect(el.style.getPropertyValue("--float-x")).toBe("70px");
    expect(el.style.getPropertyValue("--float-y")).toBe("60px");
    expect(readFloatRect("feed")).toMatchObject({ x: 70, y: 60 });
  });

  it("resizes from the corner grip and keeps the size", () => {
    const el = document.createElement("div");
    const handle = document.createElement("div");
    el.append(handle);
    document.body.append(el);
    stubRect(el, { left: 10, top: 10, width: 200, height: 160 });
    bindFloatPanel(el, handle, "debug", { min: { w: 180, h: 120 } });
    const grip = el.querySelector<HTMLElement>(".float-resize");
    expect(grip).toBeTruthy();
    grip!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 210, clientY: 170, bubbles: true }));
    stubRect(el, { left: 10, top: 10, width: 280, height: 220 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 290, clientY: 230, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 290, clientY: 230, bubbles: true }));
    expect(el.classList.contains("sized")).toBe(true);
    expect(el.style.getPropertyValue("--float-w")).toBe("280px");
    expect(el.style.getPropertyValue("--float-h")).toBe("220px");
    expect(readFloatRect("debug")).toMatchObject({ w: 280, h: 220 });
  });

  it("drags from empty chrome and skips text or controls", () => {
    const el = document.createElement("div");
    const handle = document.createElement("div");
    handle.className = "float-handle";
    const ticker = document.createElement("div");
    ticker.className = "feed-ticker";
    const line = document.createElement("span");
    line.className = "tx";
    line.textContent = "dns 1.1.1.1";
    ticker.append(line);
    const btn = document.createElement("button");
    el.append(handle, ticker, btn);
    document.body.append(el);
    stubRect(el, { left: 20, top: 30, width: 200, height: 80 });
    bindFloatPanel(el, handle, "feed");
    expect(canFloatDrag(el, el)).toBe(true);
    expect(canFloatDrag(handle, el)).toBe(true);
    expect(canFloatDrag(line, el)).toBe(false);
    expect(canFloatDrag(btn, el)).toBe(false);
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 24, clientY: 34, bubbles: true }));
    stubRect(el, { left: 50, top: 70, width: 200, height: 80 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 54, clientY: 74, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 54, clientY: 74, bubbles: true }));
    expect(readFloatRect("feed")).toMatchObject({ x: 50, y: 70 });
  });

  it("applies a saved box and skips interactive children", () => {
    writeFloatRect("debug", { x: 24, y: 36, w: 300, h: 200 });
    const el = document.createElement("div");
    const handle = document.createElement("h2");
    const close = document.createElement("span");
    close.className = "close";
    handle.append(close);
    el.append(handle);
    document.body.append(el);
    stubRect(el, { left: 24, top: 36, width: 300, height: 200 });
    bindFloatPanel(el, handle, "debug");
    expect(el.classList.contains("floated")).toBe(true);
    expect(el.classList.contains("sized")).toBe(true);
    expect(applyFloatRect(el, { x: 24, y: 36, w: 300, h: 200 }).w).toBe(300);
    close.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 30, clientY: 40, bubbles: true }));
    expect(el.classList.contains("dragging")).toBe(false);
  });
});
