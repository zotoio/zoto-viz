import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LabelItem, LabelLayer, boxesOverlap, declutterLabels, labelActivity } from "./labels";

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

describe("declutterLabels", () => {
  it("keeps the more active of two overlapping names", () => {
    const a = { x: 100, y: 100, w: 80, h: 24, rank: 10, pinned: false, shown: false };
    const b = { x: 110, y: 104, w: 80, h: 24, rank: 40, pinned: false, shown: false };
    expect(boxesOverlap(a, b)).toBe(true);
    expect(declutterLabels([a, b])).toEqual([false, true]);
  });

  it("keeps non-overlapping labels even when one is quiet", () => {
    const a = { x: 40, y: 40, w: 60, h: 20, rank: 1, pinned: false, shown: false };
    const b = { x: 400, y: 300, w: 60, h: 20, rank: 90, pinned: false, shown: false };
    expect(declutterLabels([a, b])).toEqual([true, true]);
  });

  it("pins a selection over a hotter neighbour and still hides a third pile-up", () => {
    const pin = { x: 100, y: 100, w: 80, h: 24, rank: 1, pinned: true, shown: true };
    const hot = { x: 108, y: 100, w: 80, h: 24, rank: 900, pinned: false, shown: false };
    const far = { x: 500, y: 80, w: 50, h: 18, rank: 2, pinned: false, shown: false };
    expect(declutterLabels([pin, hot, far])).toEqual([true, false, true]);
  });

  it("prefers the already-shown label when ranks tie", () => {
    const a = { x: 50, y: 50, w: 70, h: 20, rank: 5, pinned: false, shown: false };
    const b = { x: 55, y: 50, w: 70, h: 20, rank: 5, pinned: false, shown: true };
    expect(declutterLabels([a, b])).toEqual([false, true]);
  });

  it("ranks talkers above idle volume", () => {
    expect(labelActivity(12, 100)).toBeGreaterThan(labelActivity(0, 1e9));
  });
});

describe("LabelLayer overlap", () => {
  it("hides a quiet label that shares the screen with a busier one", () => {
    const { layer: l, cam } = layer();
    const quiet = new LabelItem(document.createElement("div"));
    const busy = new LabelItem(document.createElement("div"));
    quiet.element.textContent = "idle-host";
    busy.element.textContent = "talker";
    quiet.visible = busy.visible = true;
    quiet.rank = 1;
    busy.rank = 80;
    quiet.position.set(0, 0, 0);
    busy.position.set(2, 0, 0);
    l.add(quiet); l.add(busy);
    l.render(cam);
    expect(busy.shown).toBe(true);
    expect(quiet.shown).toBe(false);
  });
});

