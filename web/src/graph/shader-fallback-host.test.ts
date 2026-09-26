import { beforeEach, describe, expect, it, vi } from "vitest";
import { genericShaderFallbackMessage } from "./shader-fallback-copy";
import { sanitizePackDisplayName } from "./sanitize-pack-name";
import { SHADER_FALLBACK_CHIP_CLASS, SHADER_FALLBACK_CLASS, TileShaderFallback } from "./tile-shader-fallback";
import { resetWallNotices, wallNoticeTotal } from "./wall-notice";
import type { VizDataFrame } from "../plugins/viz-host";

const EMPTY_FRAME: VizDataFrame = {
  t: 0, dt: 0, audio: 0, packets: [], rf: [], talkers: [], headlines: [],
};

describe("tile shader fallback host", () => {
  beforeEach(() => {
    expect.hasAssertions();
    resetWallNotices();
  });

  it("host-generic-copy", () => {
    const mount = document.createElement("div");
    Object.defineProperty(mount, "clientWidth", { value: 400 });
    Object.defineProperty(mount, "clientHeight", { value: 300 });
    document.body.appendChild(mount);
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    const pack = "Packet Tunnel";
    const fb = new TileShaderFallback(mount, { packName: pack, genericOnly: true });
    const nodes = mount.querySelectorAll(`.${SHADER_FALLBACK_CLASS}`);
    expect(nodes).toHaveLength(1);
    const el = nodes[0] as HTMLElement;
    expect(el.isConnected).toBe(true);
    expect(el.style.display).not.toBe("none");
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe(genericShaderFallbackMessage(pack));
    const box = { width: 200, height: 80, top: 0, left: 0, right: 200, bottom: 80, x: 0, y: 0, toJSON() { return this; } };
    el.getBoundingClientRect = () => box as DOMRect;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(el.style.backgroundColor).not.toBe("");
    expect(el.style.backgroundColor).not.toBe("rgb(0, 0, 0)");
    fb.frame(EMPTY_FRAME);
    expect(focus).not.toHaveBeenCalled();
    expect(wallNoticeTotal()).toBe(0);
    focus.mockRestore();
    mount.remove();
  });

  it("simple-view-chip", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    new TileShaderFallback(mount, {
      packName: "Nixie",
      fallbackText: () => "01 05 00",
      showChip: true,
    });
    const chips = mount.querySelectorAll(`.${SHADER_FALLBACK_CHIP_CLASS}`);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("Simple view");
    mount.remove();
  });

  it("pack-name-sanitise", () => {
    const raw = `../evil/${"x".repeat(120)}<script>alert(1)</script>`;
    const clean = sanitizePackDisplayName(raw);
    expect(clean.length).toBe(80);
    expect(clean).not.toMatch(/[<>]/);
    expect(genericShaderFallbackMessage(raw)).toBe(
      `‹${clean}› can't run its graphics on this device. Other tiles aren't affected.`,
    );
  });
});
