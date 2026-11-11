import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it, vi } from "vitest";
import { disposeOrbitControls } from "./scene";

/** A pane is detached before its scene is disposed; the document key listeners must still go. */
describe("disposeOrbitControls", () => {
  it("removes OrbitControls' document key interceptors even when the element is already detached", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const add = vi.spyOn(document, "addEventListener");
    const rm = vi.spyOn(document, "removeEventListener");
    const c = new OrbitControls(new THREE.PerspectiveCamera(), el);
    const added = add.mock.calls.filter(([t]) => t === "keydown" || t === "keyup").map(([t, fn]) => [t, fn]);
    expect(added.length).toBeGreaterThan(0);
    el.remove();
    disposeOrbitControls(c);
    for (const [t, fn] of added) {
      expect(rm.mock.calls.some(([rt, rfn]) => rt === t && rfn === fn)).toBe(true);
    }
    add.mockRestore();
    rm.mockRestore();
  });
});
