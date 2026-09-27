import { beforeEach, describe, expect, it } from "vitest";
import {
  bindVizDriveElement,
  clearVizDrive,
  noteHostDirect,
} from "./viz-drive";

describe("viz-drive per tile", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("starts none until host-direct is noted", () => {
    const el = document.createElement("div");
    bindVizDriveElement("main", el);
    expect(el.dataset.vizDrive).toBe("none");
    noteHostDirect("main");
    expect(el.dataset.vizDrive).toBe("host-direct");
  });

  it("returns to none when the pack is cleared", () => {
    const el = document.createElement("div");
    bindVizDriveElement("plugin:wifi", el);
    noteHostDirect("plugin:wifi");
    clearVizDrive("plugin:wifi");
    expect(el.dataset.vizDrive).toBe("none");
  });
});
