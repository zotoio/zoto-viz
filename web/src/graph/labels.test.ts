import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LabelItem, LabelLayer } from "./labels";

function layer(): { layer: LabelLayer; cam: THREE.PerspectiveCamera } {
  const l = new LabelLayer();
  l.setSize(800, 600);
  const cam = new THREE.PerspectiveCamera(50, 800 / 600, 1, 5000);
  cam.position.set(0, 0, 100);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return { layer: l, cam };
}

describe("LabelLayer", () => {
  it("attaches a label only once it is visible and centres a world-origin label on screen", () => {
    const { layer: l, cam } = layer();
    const it = new LabelItem(document.createElement("div"));
    l.add(it);
    l.render(cam);
    expect(it.element.parentNode).toBeNull();
    it.visible = true;
    l.render(cam);
    expect(it.element.parentNode).toBe(l.domElement);
    expect(it.element.style.display).toBe("");
    expect(it.element.style.transform).toContain("translate(400.0px,300.0px)");
  });

  it("hides labels behind the camera and when the owner turns them off, and detaches on remove", () => {
    const { layer: l, cam } = layer();
    const it = new LabelItem(document.createElement("div"));
    it.visible = true;
    l.add(it);
    l.render(cam);
    expect(it.shown).toBe(true);
    it.position.set(0, 0, 500); // behind a camera at z=100 looking toward -z
    l.render(cam);
    expect(it.element.style.display).toBe("none");
    it.position.set(0, 0, 0);
    it.visible = false;
    l.render(cam);
    expect(it.element.style.display).toBe("none");
    l.remove(it);
    expect(it.element.parentNode).toBeNull();
    expect(l.size).toBe(0);
  });

  it("stacks nearer labels above farther ones", () => {
    const { layer: l, cam } = layer();
    const near = new LabelItem(document.createElement("div"));
    const far = new LabelItem(document.createElement("div"));
    near.visible = far.visible = true;
    near.position.set(0, 0, 50);
    far.position.set(0, 0, -50);
    l.add(near); l.add(far);
    l.render(cam);
    expect(Number(near.element.style.zIndex)).toBeGreaterThan(Number(far.element.style.zIndex));
  });
});
