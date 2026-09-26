import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWallNoticeRegion, postWallNotice, type NoticeKey } from "./wall-notice-region";

const ALERT: NoticeKey[] = ["install-failed", "context-not-restored", "retry-failed"];
const STATUS: NoticeKey[] = ["server-restarted", "context-lost", "layout-refused-boot", "layout-refused-profile"];

function boot() {
  document.body.innerHTML = "<div id=\"wall\"></div><div id=\"foot\"></div>";
  const wall = document.getElementById("wall")!;
  mountWallNoticeRegion(wall);
  const region = wall.querySelector(".wall-notice-region");
  const status = region?.querySelector(".wall-notice-status") ?? null;
  const alert = region?.querySelector(".wall-notice-alert") ?? null;
  return { wall, region, status, alert };
}

function wallCss() {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../style.css");
  const full = fs.readFileSync(cssPath, "utf8");
  const s = full.indexOf("/* Shared wall notice stack");
  const e = full.indexOf(".wall-notice-action", s);
  return full.slice(s, e + 40).split("\n").filter((l) => !l.includes("anchor(")).join("\n");
}

describe("wall notice region", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  describe("boot containers", () => {
    beforeEach(() => expect.hasAssertions());
    it("keeps empty status and alert containers before the first post", () => {
      const { status, alert } = boot();
      expect(status?.isConnected).toBe(true);
      expect(alert?.isConnected).toBe(true);
      expect((status?.childElementCount ?? 0) + (alert?.childElementCount ?? 0)).toBe(0);
      let inserts = 0;
      const orig = status!.appendChild.bind(status!);
      status!.appendChild = ((n: Node) => { inserts += 1; return orig(n); }) as typeof status.appendChild;
      postWallNotice({ key: "server-restarted", text: "Server restarted." });
      status!.appendChild = orig;
      expect(status!.childElementCount).toBe(1);
      expect(inserts).toBe(1);
    });
  });

  describe("region layout styles", () => {
    beforeEach(() => expect.hasAssertions());
    it("uses fixed bottom-centre placement with a 480px max width", () => {
      document.head.append(Object.assign(document.createElement("style"), { textContent: wallCss() }));
      boot();
      const cs = getComputedStyle(document.querySelector(".wall-notice-region")!);
      expect(cs.position).toBe("fixed");
      expect(cs.left).toBe("50%");
      expect(cs.maxWidth).toBe("480px");
    });
  });

  describe("key routing", () => {
    beforeEach(() => expect.hasAssertions());
    it("routes alert keys to alert and status keys to status", () => {
      for (const key of ALERT) {
        const { status, alert } = boot();
        postWallNotice({ key, text: key });
        expect(alert.querySelector(`[data-notice-key="${key}"]`)).not.toBeNull();
        expect(status.querySelector(`[data-notice-key="${key}"]`)).toBeNull();
      }
      for (const key of STATUS) {
        const { status, alert } = boot();
        postWallNotice({ key, text: key });
        expect(status.querySelector(`[data-notice-key="${key}"]`)).not.toBeNull();
        expect(alert.querySelector(`[data-notice-key="${key}"]`)).toBeNull();
      }
    });
  });

  describe("same key coalescing", () => {
    beforeEach(() => expect.hasAssertions());
    it("re-posting the same key avoids duplicate nodes after the first post", () => {
      const { status } = boot();
      let evictions = 0, textWrites = 0, insertions = 0;
      const oRem = status.removeChild.bind(status);
      const oApp = status.appendChild.bind(status);
      const oSet = Element.prototype.setAttribute;
      status.removeChild = ((n) => { evictions += 1; return oRem(n); }) as typeof status.removeChild;
      status.appendChild = ((n) => { insertions += 1; return oApp(n); }) as typeof status.appendChild;
      Element.prototype.setAttribute = function (n, v) {
        if (n === "data-notice-text") textWrites += 1;
        return oSet.call(this, n, v);
      };
      try {
        for (let i = 0; i < 600; i++) postWallNotice({ key: "server-restarted", text: "Server restarted." });
      } finally {
        Element.prototype.setAttribute = oSet;
        status.appendChild = oApp;
        status.removeChild = oRem;
      }
      expect(status.childElementCount).toBe(1);
      expect(textWrites).toBe(1);
      expect(insertions).toBe(1);
      expect(evictions).toBe(0);
    });
  });

  describe("same key text refresh", () => {
    beforeEach(() => expect.hasAssertions());
    it("updates text on the same node without inserting", () => {
      const { status } = boot();
      postWallNotice({ key: "server-restarted", text: "First copy." });
      const node = status.firstElementChild;
      let writes = 0, inserts = 0;
      const oSet = Element.prototype.setAttribute;
      const oApp = status.appendChild.bind(status);
      Element.prototype.setAttribute = function (n, v) {
        if (n === "data-notice-text") writes += 1;
        return oSet.call(this, n, v);
      };
      status.appendChild = ((n) => { inserts += 1; return oApp(n); }) as typeof status.appendChild;
      postWallNotice({ key: "server-restarted", text: "Second copy." });
      Element.prototype.setAttribute = oSet;
      status.appendChild = oApp;
      expect(writes).toBe(1);
      expect(status.firstElementChild).toBe(node);
      expect(inserts).toBe(0);
    });
  });

  describe("ordering", () => {
    beforeEach(() => expect.hasAssertions());
    it("keeps the newest notice last in its container", () => {
      const { status } = boot();
      postWallNotice({ key: "server-restarted", text: "One" });
      postWallNotice({ key: "context-lost", text: "Two" });
      expect(status.childElementCount).toBe(2);
      expect(status.lastElementChild?.getAttribute("data-notice-key")).toBe("context-lost");
    });
  });

  describe("capacity eviction", () => {
    beforeEach(() => expect.hasAssertions());
    it("evicts the oldest non-error when a fourth notice arrives", () => {
      const { status, alert } = boot();
      postWallNotice({ key: "server-restarted", text: "a" });
      postWallNotice({ key: "context-lost", text: "b" });
      postWallNotice({ key: "retry-failed", text: "c" });
      postWallNotice({ key: "layout-refused-boot", text: "d" });
      expect(status.childElementCount).toBe(2);
      expect(alert.childElementCount).toBe(1);
      expect(status.querySelector('[data-notice-key="server-restarted"]')).toBeNull();
    });
  });

  describe("error queue", () => {
    beforeEach(() => expect.hasAssertions());
    it("queues held error notices and promotes one on dismiss", () => {
      const { region } = boot();
      postWallNotice({ key: "context-not-restored", text: "e1" });
      postWallNotice({ key: "retry-failed", text: "e2" });
      postWallNotice({ key: "install-failed", text: "e3" });
      for (let i = 0; i < 600; i++) postWallNotice({ key: "install-failed", text: "held" });
      expect(region.dataset.queueCount).toBe("1");
      const held = boot();
      postWallNotice({ key: "context-not-restored", text: "e1" });
      postWallNotice({ key: "retry-failed", text: "e2" });
      postWallNotice({ key: "install-failed", text: "e3" });
      postWallNotice({ key: "context-lost", text: "q1" });
      postWallNotice({ key: "layout-refused-boot", text: "q2" });
      postWallNotice({ key: "layout-refused-profile", text: "q3" });
      expect(held.region.dataset.queueCount).toBe("3");
      const promote = boot();
      postWallNotice({ key: "context-not-restored", text: "e1" });
      postWallNotice({ key: "retry-failed", text: "e2" });
      postWallNotice({ key: "install-failed", text: "e3" });
      postWallNotice({ key: "context-lost", text: "q1" });
      postWallNotice({ key: "layout-refused-boot", text: "q2" });
      postWallNotice({ key: "layout-refused-profile", text: "q3" });
      const first = promote.alert.firstElementChild as HTMLElement;
      postWallNotice({ key: first.dataset.noticeKey as NoticeKey, text: "x" }).dismiss();
      expect(promote.status.querySelector('[data-notice-key="context-lost"]')).not.toBeNull();
      expect(promote.region.dataset.queueCount).toBe("2");
    });
  });

  describe("auto-clear timers", () => {
    beforeEach(() => { expect.hasAssertions(); vi.useFakeTimers(); });
    it("re-arms a single auto-clear timer for repeated posts on one key", () => {
      boot();
      for (let i = 0; i < 3; i++) postWallNotice({ key: "server-restarted", text: "t", autoClearMs: 5000 });
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe("region lifetime", () => {
    beforeEach(() => { expect.hasAssertions(); vi.useFakeTimers(); });
    it("clears timers and children without rebuilding the region node", () => {
      const { region, status } = boot();
      const ref = region;
      for (let i = 0; i < 10; i++) postWallNotice({ key: "server-restarted", text: `c${i}`, autoClearMs: 1000 }).dismiss();
      expect(vi.getTimerCount()).toBe(0);
      expect(status.childElementCount).toBe(0);
      expect(document.querySelector(".wall-notice-region")).toBe(ref);
    });
  });

  describe("notice parents", () => {
    beforeEach(() => expect.hasAssertions());
    it("parents each notice under one of the two region containers", () => {
      const { status, alert } = boot();
      postWallNotice({ key: "server-restarted", text: "s" });
      postWallNotice({ key: "install-failed", text: "a" });
      expect(status.querySelector('[data-notice-key="server-restarted"]')?.parentElement).toBe(status);
      expect(alert.querySelector('[data-notice-key="install-failed"]')?.parentElement).toBe(alert);
    });
  });
});
