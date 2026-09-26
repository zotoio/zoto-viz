import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearWallNoticeRegion,
  ensureWallNoticeRegion,
  postWallNotice,
  wallNoticeRegionChildren,
  wallNoticeRegionElement,
} from "./wall-notice-region";
import { showWallStatusNotice } from "./wall-notice";
import { bindServerRestartWallNotice } from "./http-notice";
import { SERVER_RESTART_NOTICE } from "./http-copy";

describe("wall notice region", () => {
  beforeEach(() => {
    expect.hasAssertions();
    document.body.innerHTML = "<div id=\"wall\"></div><div id=\"foot\"><div id=\"hint\"></div></div>";
    clearWallNoticeRegion();
    document.getElementById("wall-notice-region")?.remove();
  });

  afterEach(() => {
    clearWallNoticeRegion();
    document.body.innerHTML = "";
  });

  it("exposes a single region container with role status", () => {
    const region = ensureWallNoticeRegion();
    expect(region.getAttribute("role")).toBe("status");
    expect(region.id).toBe("wall-notice-region");
  });

  it("mounts restart copy inside the region, not with its own fixed position", () => {
    const off = bindServerRestartWallNotice();
    window.dispatchEvent(
      new CustomEvent("zoto-viz-server-restart", { detail: SERVER_RESTART_NOTICE }),
    );
    const region = wallNoticeRegionElement();
    const notice = document.querySelector("#wall-notice-region .mosaic-wall-notice") as HTMLElement;
    expect(notice.parentElement).toBe(region);
    expect(getComputedStyle(notice).position).not.toBe("fixed");
    off();
  });

  it("stacks two notices with the newest last in the region", () => {
    postWallNotice({ kind: "info", text: "first" });
    postWallNotice({ kind: "info", text: "second" });
    const kids = wallNoticeRegionChildren();
    expect(kids).toHaveLength(2);
    expect(kids[0]!.textContent).toContain("first");
    expect(kids[1]!.textContent).toContain("second");
  });

  it("evicts the oldest non-error notice when a fourth arrives", () => {
    postWallNotice({ kind: "info", text: "a" });
    postWallNotice({ kind: "error", text: "b" });
    postWallNotice({ kind: "error", text: "c" });
    postWallNotice({ kind: "info", text: "d" });
    const kids = wallNoticeRegionChildren();
    expect(kids).toHaveLength(3);
    expect(kids.map((k) => k.textContent)).not.toContain("a");
    expect(kids[2]!.textContent).toContain("d");
  });

  it("queues a fourth error while three errors are visible until one is dismissed", () => {
    const d1 = postWallNotice({ kind: "error", text: "e1" });
    postWallNotice({ kind: "error", text: "e2" });
    postWallNotice({ kind: "error", text: "e3" });
    const queued = postWallNotice({ kind: "error", text: "e4" });
    expect(wallNoticeRegionChildren()).toHaveLength(3);
    expect(wallNoticeRegionChildren().some((k) => k.textContent?.includes("e4"))).toBe(false);
    d1.dismiss();
    expect(wallNoticeRegionChildren()).toHaveLength(3);
    expect(wallNoticeRegionChildren()[2]!.textContent).toContain("e4");
    queued.dismiss();
  });
});
