import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { sanitizePackDisplayName } from "./sanitize-pack-name";
import { TileShaderFallback } from "./tile-shader-fallback";
import { RenderHost } from "./render-host";

function injectStyles(): void {
  const css = readFileSync(resolve(import.meta.dirname, "../style.css"), "utf8");
  const style = document.createElement("style");
  style.dataset.shaderFallbackTest = "";
  style.textContent = css;
  document.head.appendChild(style);
}

describe("tile shader fallback host", () => {
  beforeEach(() => {
    expect.hasAssertions();
    document.querySelectorAll("style[data-shader-fallback-test]").forEach((n) => n.remove());
    injectStyles();
  });

  it("host-generic-copy", () => {
    const mount = document.createElement("div");
    mount.style.position = "relative";
    Object.defineProperty(mount, "clientWidth", { value: 400 });
    Object.defineProperty(mount, "clientHeight", { value: 300 });
    document.body.appendChild(mount);
    const beforeNodes = document.body.querySelectorAll("*").length;
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    const pack = "Packet Tunnel";
    const fb = new TileShaderFallback(mount, {
      packName: pack,
      showChip: false,
      initialText: genericShaderFallbackMessage(pack),
    });
    const nodes = mount.querySelectorAll(".tile-shader-fallback");
    expect(nodes).toHaveLength(1);
    const el = nodes[0] as HTMLElement;
    expect(el.isConnected).toBe(true);
    expect(el.textContent).toBe(genericShaderFallbackMessage(pack));
    const box = { width: 400, height: 300, top: 0, left: 0, right: 400, bottom: 300, x: 0, y: 0, toJSON() { return this; } };
    mount.getBoundingClientRect = () => box as DOMRect;
    const cs = getComputedStyle(el);
    expect(cs.display).toBe("flex");
    expect(cs.position).toBe("absolute");
    expect(focus).toHaveBeenCalledTimes(0);
    expect(document.body.querySelectorAll("*").length - beforeNodes).toBe(2);
    focus.mockRestore();
    fb.dispose();
    mount.remove();
  });

  it("simple-view-chip", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, { packName: "Nixie", showChip: true, initialText: "01 05 00" });
    const chips = mount.querySelectorAll(".tile-shader-fallback-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("Simple view");
    fb.dispose();
    mount.remove();
  });

  it("pack-name-sanitise", () => {
    const raw = `../evil/${"x".repeat(120)}<script>alert(1)</script>`;
    const clean = sanitizePackDisplayName(raw);
    expect(clean.length).toBe(80);
    expect(genericShaderFallbackMessage(raw)).toBe(
      `‹${clean}› can't run its graphics on this device. Other tiles aren't affected.`,
    );
  });

  it("sanitize-segments", () => {
    expect(sanitizePackDisplayName("../evil/Nixie Clock")).toBe("Nixie Clock");
  });

  it("notice-css", () => {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const notice = wall.querySelector(".gfx-wall-notice") as HTMLElement;
    expect(getComputedStyle(notice).position).toBe("absolute");
    host.dispose();
    wall.remove();
  });

  it("fallback-text-css", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const fb = new TileShaderFallback(mount, {
      packName: "P",
      showChip: false,
      initialText: genericShaderFallbackMessage("P"),
    });
    const text = mount.querySelector(".tile-shader-fallback__text") as HTMLElement;
    expect(getComputedStyle(text).maxWidth).toBe("364px");
    fb.dispose();
    mount.remove();
  });
});
