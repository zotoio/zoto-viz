import { afterEach, describe, expect, it } from "vitest";
import {
  bindVizDriveElement,
  clearVizDrive,
  noteHostDirect,
  noteSandboxWrite,
  resetVizDriveState,
  setSandboxReady,
  vizDriveFor,
} from "./viz-drive";

describe("viz-drive per tile", () => {
  afterEach(() => resetVizDriveState());

  it("stays none until sandbox is ready and a write lands", () => {
    const el = document.createElement("div");
    bindVizDriveElement("plugin:backrooms", el);
    expect(el.dataset.vizDrive).toBe("none");
    noteSandboxWrite("plugin:backrooms");
    expect(vizDriveFor("plugin:backrooms")).toBe("none");
    setSandboxReady(true);
    expect(vizDriveFor("plugin:backrooms")).toBe("sandbox");
    expect(el.dataset.vizDrive).toBe("sandbox");
    noteSandboxWrite("plugin:backrooms");
    expect(vizDriveFor("plugin:backrooms")).toBe("sandbox");
    expect((window as unknown as { __vizDebug?: { tiles: Record<string, { vizDrive: string }> } }).__vizDebug?.tiles["plugin:backrooms"]?.vizDrive).toBe("sandbox");
  });

  it("marks host-direct when viz-pack-host runs on the tile", () => {
    const el = document.createElement("div");
    bindVizDriveElement("main", el);
    noteHostDirect("main");
    expect(el.dataset.vizDrive).toBe("host-direct");
    setSandboxReady(true);
    noteSandboxWrite("main");
    expect(el.dataset.vizDrive).toBe("host-direct");
  });

  it("returns to none when the pack is cleared", () => {
    const el = document.createElement("div");
    bindVizDriveElement("plugin:wifi", el);
    noteHostDirect("plugin:wifi");
    clearVizDrive("plugin:wifi");
    expect(el.dataset.vizDrive).toBe("none");
    expect(vizDriveFor("plugin:wifi")).toBe("none");
  });
});
