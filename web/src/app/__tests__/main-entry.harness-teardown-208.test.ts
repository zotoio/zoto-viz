/** @vitest-environment happy-dom */
/**
 * #208: the main-entry harness tears the previous boot down (a non-persisted pagehide, which disposes
 * its LiveFeed poll since #206) before it imports main.ts again. Before that, every boot in a file
 * left its feed polling on Node's interval, which happy-dom's teardown never clears, and under load
 * one fired after the DOM was gone (feed.ts `document is not defined`, via perf-pin's three boots).
 * Intervals are faked from before the first boot so both feeds' timers are ones this row advances.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootMainEntry } from "./main-entry-harness";

/** feed.ts POLL_MS: one traffic poll per interval tick while the feed runs. */
const FEED_POLL_MS = 800;
const TICKS = 4;

describe("#208: a second harness boot leaves no poll from the first boot's feed", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("boot, boot again: only the second boot's feed queries on each tick, the first boot's makes no more query() calls (#208)", { timeout: 40_000 }, async () => {
    await bootMainEntry();
    // LiveFeed.query's first read is document.body's arcade class; nothing else polls that on a timer.
    // Both boots share this body (the harness remounts its children), so the spy sees every feed.
    const bodyClassReads = vi.spyOn(document.body.classList, "contains");
    const queries = () => bodyClassReads.mock.calls.filter(([c]) => c === "arcade").length;

    const beforeFirst = queries();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * TICKS);
    expect(queries() - beforeFirst, "the first boot's feed queries once per tick").toBe(TICKS);

    await bootMainEntry();
    const beforeSecond = queries();
    await vi.advanceTimersByTimeAsync(FEED_POLL_MS * TICKS);
    expect(queries() - beforeSecond, "query() calls per tick after the second import (the first boot's feed would double them)").toBe(TICKS);
  });
});
