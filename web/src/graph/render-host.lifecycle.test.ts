import { describe, expect, it } from "vitest";
import { RenderHost, type HostedView } from "./render-host";

describe("RenderHost view lifecycle", () => {
  it("releases hosted views when callers remove them", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640, configurable: true });
    Object.defineProperty(wall, "clientHeight", { value: 480, configurable: true });
    document.body.appendChild(wall);
    const host = new RenderHost(wall, { software: true });
    const views: HostedView[] = [];
    for (let i = 0; i < 20; i++) {
      const el = document.createElement("div");
      el.style.width = "100px";
      el.style.height = "100px";
      wall.appendChild(el);
      const view: HostedView = {
        viewEl: el,
        hostFrame: () => {},
        hostContextLost: () => {},
        hostContextRestored: () => {},
        paintSoftware: () => {},
      };
      host.add(view);
      views.push(view);
    }
    expect(host.viewCount).toBe(20);
    for (const v of views) host.remove(v);
    expect(host.viewCount).toBe(0);
    host.dispose();
    wall.remove();
  });
});
