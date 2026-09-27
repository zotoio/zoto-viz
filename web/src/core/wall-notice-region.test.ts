import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWallNoticeRegion, postWallNotice, type NoticeKey } from "./wall-notice-region";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANES: Record<NoticeKey, "status" | "alert"> = {
  "install-failed": "alert", "context-not-restored": "alert", "retry-failed": "alert", "update-rolled-back": "alert",
  "server-restarted": "status", "context-lost": "status", "layout-refused-boot": "status",
  "layout-refused-profile": "status", "pack-navigation-stopped": "status", "drawer-edit-discarded": "status",
};

function boot() {
  document.body.innerHTML = "<div id=\"wall\"></div><div id=\"foot\"></div>";
  const wall = document.getElementById("wall")!;
  mountWallNoticeRegion(wall);
  const region = wall.querySelector<HTMLElement>(".wall-notice-region")!;
  const status = region.querySelector<HTMLElement>('[role="status"]')!;
  const alert = region.querySelector<HTMLElement>('[role="alert"]')!;
  return { wall, region, status, alert };
}
const rows = (key: NoticeKey) => document.querySelectorAll(`[data-notice-key="${key}"]`).length;

describe("wall notice region", () => {
  beforeEach(() => expect.hasAssertions());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ""; document.head.innerHTML = ""; });

  it("keeps empty status and alert containers before the first post", () => {
    document.body.innerHTML = "<div id=\"wall\"></div><div id=\"foot\"></div>";
    const wall = document.getElementById("wall")!;
    mountWallNoticeRegion(wall);
    const region = wall.querySelector(".wall-notice-region");
    const status = region?.querySelector(".wall-notice-status") ?? null;
    const alert = region?.querySelector(".wall-notice-alert") ?? null;
    expect(status?.isConnected).toBe(true);
    expect(alert?.isConnected).toBe(true);
    expect((status?.childElementCount ?? 0) + (alert?.childElementCount ?? 0)).toBe(0);
    if (!status) throw new Error("missing status container");
    let inserts = 0;
    const orig = status.appendChild.bind(status);
    status.appendChild = ((n: Node) => { inserts += 1; return orig(n); }) as typeof status.appendChild;
    postWallNotice({ key: "server-restarted", text: "Server restarted." });
    status.appendChild = orig;
    expect(status.childElementCount).toBe(1);
    expect(inserts).toBe(1);
  });

  it("uses fixed bottom-centre placement with a 480px max width", () => {
    document.head.append(Object.assign(document.createElement("style"), {
      textContent: fs.readFileSync(path.join(webRoot, "src/style.css"), "utf8"),
    }));
    boot();
    const cs = getComputedStyle(document.querySelector(".wall-notice-region")!);
    expect(cs.position).toBe("fixed");
    expect(cs.left).toBe("50%");
    expect(cs.transform).toBe("translateX(-50%)");
    expect(cs.bottom).toBe("calc(76px + 16px)");
    expect(cs.maxWidth).toBe("480px");
    expect(cs.textTransform).toBe("none");
    expect(cs.zIndex).toBe("7");
    expect(cs.pointerEvents).toBe("none");
    expect(cs.display).toBe("flex");
    expect(cs.flexDirection).toBe("column");
    expect(cs.gap).toBe("6px");
    expect(cs.marginBottom).toBe("10px");
    postWallNotice({ key: "install-failed", text: "x", action: { label: "Retry", onClick: () => {} } });
    expect(getComputedStyle(document.querySelector(".wall-notice-row")!).pointerEvents).toBe("auto");
  });

  it("routes all ten NoticeKey values via NOTICE_ROUTE", () => {
    for (const key of Object.keys(LANES) as NoticeKey[]) {
      boot();
      postWallNotice({ key, text: key });
      expect(document.querySelector(`[data-notice-key="${key}"]`)!.parentElement!.getAttribute("role")).toBe(LANES[key]);
    }
  });

  it("re-posting the same key avoids duplicate nodes after the first post", () => {
    const { status } = boot();
    let evictions = 0, insertions = 0;
    const oRem = status.removeChild.bind(status), oApp = status.appendChild.bind(status);
    status.removeChild = ((n) => { evictions += 1; return oRem(n); }) as typeof status.removeChild;
    status.appendChild = ((n) => { insertions += 1; return oApp(n); }) as typeof status.appendChild;
    for (let i = 0; i < 600; i++) postWallNotice({ key: "server-restarted", text: "Server restarted." });
    status.appendChild = oApp; status.removeChild = oRem;
    expect(status.childElementCount).toBe(1);
    expect(insertions).toBe(1);
    expect(evictions).toBe(0);
  });

  it("updates visible text once on the same node when the copy changes", () => {
    boot();
    postWallNotice({ key: "server-restarted", text: "First copy." });
    const row = document.querySelector<HTMLElement>('[data-notice-key="server-restarted"]')!;
    const mo = new MutationObserver(() => {});
    mo.observe(row, { childList: true, subtree: true, characterData: true });
    postWallNotice({ key: "server-restarted", text: "Second copy." });
    postWallNotice({ key: "server-restarted", text: "Second copy." });
    const writes = mo.takeRecords().filter((r) => r.target === row.querySelector(".wall-notice-text") && r.addedNodes.length === 1).length;
    mo.disconnect();
    expect(row.querySelector(".wall-notice-text")!.textContent).toBe("Second copy.");
    expect(writes).toBe(1);
    expect(document.querySelector('[data-notice-key="server-restarted"]')).toBe(row);
  });

  it("keeps the newest notice last in its container", () => {
    const { status } = boot();
    postWallNotice({ key: "server-restarted", text: "One" });
    postWallNotice({ key: "context-lost", text: "Two" });
    expect(status.lastElementChild?.getAttribute("data-notice-key")).toBe("context-lost");
  });

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

  it("queues held error notices and promotes one on dismiss", () => {
    const { status, alert, region } = boot();
    const first = postWallNotice({ key: "context-not-restored", text: "e1" });
    postWallNotice({ key: "retry-failed", text: "e2" });
    postWallNotice({ key: "install-failed", text: "e3" });
    postWallNotice({ key: "context-lost", text: "q1" });
    postWallNotice({ key: "layout-refused-boot", text: "q2" });
    postWallNotice({ key: "layout-refused-profile", text: "q3" });
    expect(region.dataset.queueCount).toBe("3");
    first.dismiss();
    expect(status.lastElementChild?.getAttribute("data-notice-key")).toBe("context-lost");
    expect(status.childElementCount + alert.childElementCount).toBe(3);
    expect(region.dataset.queueCount).toBe("2");
  });

  it("re-arms a single auto-clear timer only when the text changes", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setTimeout");
    boot();
    for (let i = 0; i < 3; i++) {
      postWallNotice({ key: "server-restarted", text: "Server restarted.", autoClearMs: 5000 });
      if (i < 2) vi.advanceTimersByTime(100);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4799);
    expect(rows("server-restarted")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(rows("server-restarted")).toBe(0);
  });

  it("clears timers and children without rebuilding the region node", () => {
    vi.useFakeTimers();
    const { region, status } = boot();
    const ref = region;
    for (let i = 0; i < 10; i++) postWallNotice({ key: "server-restarted", text: `c${i}`, autoClearMs: 1000 }).dismiss();
    expect(vi.getTimerCount()).toBe(0);
    expect(status.childElementCount).toBe(0);
    expect(document.querySelector(".wall-notice-region")).toBe(ref);
  });

  it("parents each notice under its lane container", () => {
    const { status, alert } = boot();
    postWallNotice({ key: "server-restarted", text: "s" });
    postWallNotice({ key: "install-failed", text: "a" });
    expect(document.querySelector('[data-notice-key="server-restarted"]')!.parentElement).toBe(status);
    expect(document.querySelector('[data-notice-key="install-failed"]')!.parentElement).toBe(alert);
  });

  it("puts action buttons in the tab order", () => {
    boot();
    postWallNotice({ key: "install-failed", text: "Install failed.", action: { label: "Retry", onClick: () => {} } });
    expect(document.querySelector<HTMLButtonElement>(".wall-notice-action")!.tabIndex).toBe(0);
    expect(document.querySelector<HTMLButtonElement>(".wall-notice-action")!.type).toBe("button");
    expect(document.querySelector('[data-notice-key="install-failed"]')!.className).toBe("wall-notice-row");
  });

  it("returns focus to the mount root when dismissing a focused notice", () => {
    const { wall } = boot();
    const h = postWallNotice({ key: "context-not-restored", text: "Reload.", action: { label: "Reload", onClick: () => {} } });
    document.querySelector<HTMLButtonElement>(".wall-notice-action")!.focus();
    h.dismiss();
    expect(document.activeElement).toBe(wall);
  });

  it("never queues a key that is already visible among three alerts", () => {
    const { region } = boot();
    const first = postWallNotice({ key: "context-not-restored", text: "e1" });
    postWallNotice({ key: "retry-failed", text: "e2" });
    postWallNotice({ key: "install-failed", text: "e3" });
    postWallNotice({ key: "retry-failed", text: "e2 again" });
    first.dismiss();
    expect(rows("retry-failed")).toBe(1);
    expect(rows("install-failed")).toBe(1);
    expect(region.dataset.queueCount).toBe("0");
  });

  it("calls the latest action handler after a re-post", () => {
    boot();
    const a = vi.fn(), b = vi.fn();
    postWallNotice({ key: "install-failed", text: "x", action: { label: "Retry", onClick: a } });
    postWallNotice({ key: "install-failed", text: "x", action: { label: "Retry", onClick: b } });
    document.querySelector<HTMLButtonElement>(".wall-notice-action")!.click();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(0);
  });

  it("does not auto-clear alerts that carry an action even when autoClearMs is forced", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setTimeout");
    const { alert } = boot();
    postWallNotice({ key: "retry-failed", text: "Retry failed.", action: { label: "Retry", onClick: () => {} }, autoClearMs: 5000 } as never);
    vi.advanceTimersByTime(10_000);
    expect(alert.childElementCount).toBe(1);
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("ignores a stale dismiss handle after the same key is posted again", () => {
    vi.useFakeTimers();
    boot();
    const stale = postWallNotice({ key: "server-restarted", text: "one", autoClearMs: 1000 });
    vi.advanceTimersByTime(1000);
    postWallNotice({ key: "server-restarted", text: "two" });
    stale.dismiss();
    expect(rows("server-restarted")).toBe(1);
  });

  it("stacks status notices above error notices", () => {
    boot();
    postWallNotice({ key: "install-failed", text: "a" });
    postWallNotice({ key: "server-restarted", text: "s" });
    const s = document.querySelector('[data-notice-key="server-restarted"]')!;
    const a = document.querySelector('[data-notice-key="install-failed"]')!;
    expect(s.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("drops exactly one queued entry when its handle is dismissed", () => {
    const { region } = boot();
    postWallNotice({ key: "context-not-restored", text: "e1" });
    postWallNotice({ key: "retry-failed", text: "e2" });
    postWallNotice({ key: "install-failed", text: "e3" });
    const q = postWallNotice({ key: "context-lost", text: "q1" });
    postWallNotice({ key: "layout-refused-boot", text: "q2" });
    q.dismiss();
    expect(region.dataset.queueCount).toBe("1");
    expect(q.live).toBe(false);
  });

  it("posting before mount throws wall notice region not mounted", async () => {
    vi.resetModules();
    const fresh = await import("./wall-notice-region");
    document.body.innerHTML = "<div id=\"wall\"></div>";
    expect(() => fresh.postWallNotice({ key: "server-restarted", text: "x" })).toThrowError(/^wall notice region not mounted$/);
  });
  it("dropping a focused action on re-post moves focus to the mount root", () => {
    const { wall } = boot();
    postWallNotice({ key: "install-failed", text: "Install failed.", action: { label: "Retry", onClick: () => {} } });
    document.querySelector<HTMLButtonElement>(".wall-notice-action")!.focus();
    postWallNotice({ key: "install-failed", text: "Install failed." });
    expect(document.activeElement).toBe(wall);
  });

  it("adding an action on a same-text re-post cancels auto-clear", () => {
    vi.useFakeTimers();
    boot();
    postWallNotice({ key: "server-restarted", text: "Server restarted.", autoClearMs: 5000 });
    vi.advanceTimersByTime(3000);
    postWallNotice({ key: "server-restarted", text: "Server restarted.", action: { label: "Retry", onClick: () => {} } });
    vi.advanceTimersByTime(10_000);
    expect(rows("server-restarted")).toBe(1);
    expect(document.querySelector(".wall-notice-action")!.textContent).toBe("Retry");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a same-text re-post that adds an action cancels auto-clear even with autoClearMs forced", () => {
    vi.useFakeTimers();
    boot();
    postWallNotice({ key: "server-restarted", text: "Server restarted.", autoClearMs: 5000 });
    vi.advanceTimersByTime(3000);
    postWallNotice({ key: "server-restarted", text: "Server restarted.", action: { label: "Retry", onClick: () => {} }, autoClearMs: 5000 } as never);
    vi.advanceTimersByTime(10_000);
    expect(rows("server-restarted")).toBe(1);
    expect(document.querySelector(".wall-notice-action")!.textContent).toBe("Retry");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dropping autoClearMs on a same-text re-post cancels auto-clear", () => {
    vi.useFakeTimers();
    boot();
    postWallNotice({ key: "server-restarted", text: "Server restarted.", autoClearMs: 5000 });
    postWallNotice({ key: "server-restarted", text: "Server restarted." });
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(rows("server-restarted")).toBe(1);
    postWallNotice({ key: "server-restarted", text: "Server restarted.", autoClearMs: 5000 });
    vi.advanceTimersByTime(5000);
    expect(rows("server-restarted")).toBe(0);
  });

  it("live turns false when the timer clears the notice", () => {
    vi.useFakeTimers();
    boot();
    const h = postWallNotice({ key: "server-restarted", text: "s", autoClearMs: 5000 });
    vi.advanceTimersByTime(5000);
    expect(h.live).toBe(false);
  });

  it("live turns false immediately on dismiss", () => {
    vi.useFakeTimers();
    boot();
    const h = postWallNotice({ key: "server-restarted", text: "s", autoClearMs: 5000 });
    vi.advanceTimersByTime(1000);
    h.dismiss();
    expect(h.live).toBe(false);
  });

  it("a re-post during a showing returns the identical handle and dismiss clears it", () => {
    boot();
    const h1 = postWallNotice({ key: "server-restarted", text: "one" });
    let same = 0;
    for (let i = 0; i < 600; i++) if (postWallNotice({ key: "server-restarted", text: "s" }) === h1) same += 1;
    expect(same).toBe(600);
    expect(h1.live).toBe(true);
    h1.dismiss();
    expect(rows("server-restarted")).toBe(0);
  });

  it("an old handle stays dead after a clear and a new post", () => {
    vi.useFakeTimers();
    boot();
    const h1 = postWallNotice({ key: "server-restarted", text: "one", autoClearMs: 1000 });
    vi.advanceTimersByTime(1000);
    const h2 = postWallNotice({ key: "server-restarted", text: "two" });
    expect(h2 === h1).toBe(false);
    expect(h1.live).toBe(false);
    h1.dismiss();
    expect(rows("server-restarted")).toBe(1);
  });

  it("reading live never touches the DOM", () => {
    boot();
    const h = postWallNotice({ key: "server-restarted", text: "s" });
    const spies = [...document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]')].flatMap((el) =>
      (["querySelector", "querySelectorAll", "contains"] as const).map((m) => vi.spyOn(el, m)));
    let reads = 0;
    for (let i = 0; i < 600; i++) if (h.live) reads += 1;
    expect(reads).toBe(600);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(0);
  });

  it("a text change restarts the full auto-clear duration", () => {
    vi.useFakeTimers();
    boot();
    postWallNotice({ key: "server-restarted", text: "one", autoClearMs: 5000 });
    vi.advanceTimersByTime(3000);
    postWallNotice({ key: "server-restarted", text: "two", autoClearMs: 5000 });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4999);
    expect(rows("server-restarted")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(rows("server-restarted")).toBe(0);
  });

  it("an alert without an action never auto-clears even when autoClearMs is forced", () => {
    vi.useFakeTimers();
    boot();
    postWallNotice({ key: "retry-failed", text: "Retry failed.", autoClearMs: 5000 } as never);
    vi.advanceTimersByTime(10_000);
    expect(rows("retry-failed")).toBe(1);
  });

  it("a re-post with a new action label relabels the button", () => {
    boot();
    postWallNotice({ key: "install-failed", text: "x", action: { label: "Retry", onClick: () => {} } });
    postWallNotice({ key: "install-failed", text: "x", action: { label: "Reload", onClick: () => {} } });
    expect(document.querySelector(".wall-notice-action")!.textContent).toBe("Reload");
  });

  it("mounting twice keeps the one region node", () => {
    const { wall } = boot();
    const region = wall.querySelector(".wall-notice-region");
    mountWallNoticeRegion(wall);
    expect(wall.querySelectorAll(".wall-notice-region").length).toBe(1);
    expect(wall.querySelector(".wall-notice-region")).toBe(region);
  });

  it("tsconfig include lists the typecheck proofs", () => {
    expect(JSON.parse(fs.readFileSync(path.join(webRoot, "tsconfig.json"), "utf8")).include[1]).toBe("typecheck/**/*.ts");
  });
  it("the mount root is made programmatically focusable", () => {
    const { wall } = boot();
    expect(wall.getAttribute("tabindex")).toBe("-1");
  });

  it("a re-post to a queued key updates the queued copy", () => {
    boot();
    const first = postWallNotice({ key: "context-not-restored", text: "e1" });
    postWallNotice({ key: "retry-failed", text: "e2" });
    postWallNotice({ key: "install-failed", text: "e3" });
    const q1 = postWallNotice({ key: "context-lost", text: "q1" });
    expect(postWallNotice({ key: "context-lost", text: "q2" })).toBe(q1);
    first.dismiss();
    expect(document.querySelector('[data-notice-key="context-lost"]')!.textContent).toBe("q2");
  });
});

describe("wall notice queue", () => {
  beforeEach(() => expect.hasAssertions());
  afterEach(() => { document.body.innerHTML = ""; });
  it("R7 a held install-failed posted 600 times is queued once", () => {
    const { region } = boot();
    postWallNotice({ key: "context-not-restored", text: "e1" });
    postWallNotice({ key: "retry-failed", text: "e2" });
    postWallNotice({ key: "update-rolled-back", text: "e3" });
    for (let i = 0; i < 600; i++) postWallNotice({ key: "install-failed", text: "held" });
    expect(region.dataset.queueCount).toBe("1");
  });
});
