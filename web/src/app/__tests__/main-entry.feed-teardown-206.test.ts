/** @vitest-environment happy-dom */
/**
 * #206, through the production entry (main.ts): the live feed polls /api/traffic on a window interval
 * (feed.ts POLL_MS). Nothing cleared it when the page went away, so under load a poll fired after the
 * test environment was gone: `ReferenceError: document is not defined at LiveFeed.query`. main.ts's
 * page teardown (pagehide) now disposes the feed. Intervals are faked from before the boot, so the
 * feed's timer is one this row can advance; timeouts stay real so the boot runs as usual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry, setHarnessFetchOverride } from "./main-entry-harness";

/** feed.ts POLL_MS: one traffic poll per interval tick while the feed runs. */
const FEED_POLL_MS = 800;

describe("#206: the live feed's poll stops when the page tears down (main.ts pagehide)", () => {
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

  it("boot, pagehide, then past the poll interval: LiveFeed.query does not run, no traffic poll, nothing throws (#206)", { timeout: 40_000 }, async () => {
    await bootMainEntry();
    // LiveFeed.query's first read is document.body's arcade class; nothing else polls that on a timer.
    const bodyClassReads = vi.spyOn(document.body.classList, "contains");
    const queries = () => bodyClassReads.mock.calls.filter(([c]) => c === "arcade").length;

    // Running: each interval tick queries and polls.
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * 2);
    expect(queries(), "the running feed queries on its interval").toBeGreaterThan(0);
    expect(trafficPolls, "the running feed polls /api/traffic").toBeGreaterThan(0);

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    const queriesAtTeardown = queries();
    const pollsAtTeardown = trafficPolls;
    await expect(vi.advanceTimersByTimeAsync(FEED_POLL_MS * 5), "advancing past the poll interval after teardown").resolves.not.toThrow();
    expect(queries() - queriesAtTeardown, "LiveFeed.query runs after the page tore down").toBe(0);
    expect(trafficPolls - pollsAtTeardown, "traffic polls after the page tore down").toBe(0);
  });
});
