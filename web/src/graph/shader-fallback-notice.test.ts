import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderHost } from "./render-host";

describe("shader fallback gfx wall notice", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function wallHost(): { host: RenderHost; wall: HTMLElement } {
    const wall = document.createElement("div");
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    return { host, wall };
  }

  it("notice-role", () => {
    const { host, wall } = wallHost();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const notice = wall.querySelector(".gfx-wall-notice")!;
    expect(notice.getAttribute("role")).toBe("alert"); // #236
    host.dispose();
    wall.remove();
  });

  it("reload-label", () => {
    const { host, wall } = wallHost();
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    expect(wall.querySelector(".gfx-wall-reload")!.textContent).toBe("Reload");
    host.dispose();
    wall.remove();
  });

  it("reload-click", () => {
    const { host, wall } = wallHost();
    const reload = vi.spyOn(location, "reload").mockImplementation(() => {});
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    (wall.querySelector(".gfx-wall-reload") as HTMLButtonElement).click();
    expect(reload).toHaveBeenCalledTimes(1);
    reload.mockRestore();
    host.dispose();
    wall.remove();
  });

  it("restore-refocuses-wall", () => {
    const wall = document.createElement("div");
    wall.tabIndex = -1;
    document.body.appendChild(wall);
    const host = new RenderHost(wall);
    host.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    vi.advanceTimersByTime(10_000);
    const btn = wall.querySelector(".gfx-wall-reload") as HTMLButtonElement;
    btn.focus();
    host.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(document.activeElement).toBe(wall);
    host.dispose();
    wall.remove();
  });
});
