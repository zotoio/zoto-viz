/**
 * Body-drag swap cancels the pane canvas's pointer before lifting. OrbitControls tracks pointers by
 * id, so a pointercancel with the default id 0 made its onPointerUp read `.x` of undefined (pulse-ts,
 * mouse release while dragging a pane). The cancel now carries the real pointer's id.
 */
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mosaicPointerCancelInit } from "./mosaic";

function rig() {
  const el = document.createElement("div");
  Object.assign(el, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  document.body.appendChild(el);
  const controls = new OrbitControls(new PerspectiveCamera(), el);
  const down = { bubbles: true, pointerId: 7, pointerType: "mouse", isPrimary: true, clientX: 10, clientY: 10, button: 0 };
  el.dispatchEvent(new PointerEvent("pointerdown", down));
  const errors: unknown[] = [];
  const onErr = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };
  window.addEventListener("error", onErr);
  return { el, controls, errors, done: () => { window.removeEventListener("error", onErr); controls.dispose(); el.remove(); } };
}

describe("mosaic body-drag pointercancel", () => {
  it("carries the live pointer's id, so OrbitControls releases it cleanly", () => {
    const init = mosaicPointerCancelInit({ pointerId: 7, pointerType: "mouse", isPrimary: true, clientX: 40, clientY: 12 });
    expect(init).toMatchObject({ bubbles: true, pointerId: 7, pointerType: "mouse" });
    const r = rig();
    expect(() => r.el.dispatchEvent(new PointerEvent("pointercancel", init))).not.toThrow();
    r.done();
    expect(r.errors).toEqual([]);
  });

  it("revert proof: a default-id cancel is what threw inside OrbitControls", () => {
    const r = rig();
    let thrown: unknown = null;
    try { r.el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true })); } catch (e) { thrown = e; }
    r.done();
    const all = [thrown, ...r.errors].filter(Boolean).map(String).join(" ");
    expect(all).toMatch(/reading 'x'/);
  });
});
