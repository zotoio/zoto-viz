/** @vitest-environment happy-dom */
/**
 * #211, through the production entry (main.ts): the other branch of the #206 pagehide teardown. A hide
 * into the back/forward cache (`persisted: true`) is not the page going away, so main.ts leaves the live
 * feed alone: a restored page gets no setConfig to restart it, so disposing it there would leave the
 * feed dead. Intervals are faked from before the boot, so the feed's timer is one this row can
 * advance; timeouts stay real so the boot runs as usual. The #208 harness still tears this boot down
 * (non-persisted pagehide) at the end of the file.
 * happy-dom's PageTransitionEvent is a plain Event (it drops the `persisted` init), so the row puts
 * `persisted` on the event itself; in a browser the init alone carries it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, setHarnessFetchOverride } from "./main-entry-harness";

/** feed.ts POLL_MS: one traffic poll per interval tick while the feed runs. */
const FEED_POLL_MS = 800;
const TICKS = 5;

/** A pagehide into the back/forward cache: `persisted` is true on the event main.ts's handler reads. */
function bfcachePagehide(): PageTransitionEvent {
  const ev = new PageTransitionEvent("pagehide", { persisted: true });
  if (!ev.persisted) Object.defineProperty(ev, "persisted", { value: true });
  return ev;
}

describe("#211: a bfcache pagehide (persisted) keeps the live feed polling (main.ts pagehide)", () => {
  let trafficPolls = 0;

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
    trafficPolls = 0;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setHarnessFetchOverride((p) => {
      if (p !== "/api/traffic") return null;
      trafficPolls++;
      return Promise.resolve(new Response(JSON.stringify({ packets: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
  });

  afterEach(() => {
    setHarnessFetchOverride(null);
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("boot, pagehide with persisted: true, then more ticks: LiveFeed.query runs on every tick and the feed is not disposed (#211)", { timeout: 40_000 }, async () => {
    await bootMainEntry();
    // Imported after the boot: bootMainEntry resets modules, so only now is this the LiveFeed main.ts built.
    const { LiveFeed } = await import("../../ui/feed");
    const dispose = vi.spyOn(LiveFeed.prototype, "dispose");
    // LiveFeed.query's first read is document.body's arcade class; nothing else polls that on a timer.
    const bodyClassReads = vi.spyOn(document.body.classList, "contains");
    const queries = () => bodyClassReads.mock.calls.filter(([c]) => c === "arcade").length;

    // Running: each interval tick queries and polls.
    const beforeHide = queries();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 2);
    expect(queries() - beforeHide, "the running feed queries once per tick").toBe(2);
    expect(trafficPolls, "the running feed polls /api/traffic").toBeGreaterThan(0);

    const hide = bfcachePagehide();
    expect(hide.persisted, "the hide is a bfcache one").toBe(true);
    window.dispatchEvent(hide);
    const queriesAtHide = queries();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * TICKS);
    expect(queries() - queriesAtHide, "LiveFeed.query keeps running on each tick after a bfcache hide").toBe(TICKS);
    expect(dispose, "a bfcache hide does not dispose the feed").not.toHaveBeenCalled();
  });
});
