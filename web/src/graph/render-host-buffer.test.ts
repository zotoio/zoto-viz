import { describe, expect, it } from "vitest";
import { RenderHost } from "./render-host";

describe("RenderHost.bufferPixelSize", () => {
  it("RH1: returns the same backing-store object across calls", () => {
    const parent = document.createElement("div");
    parent.style.width = "800px";
    parent.style.height = "600px";
    document.body.append(parent);
    const host = new RenderHost(parent);
    const a = host.bufferPixelSize();
    const b = host.bufferPixelSize();
    expect(a).toBe(b);
    host.dispose();
    parent.remove();
  });
});
