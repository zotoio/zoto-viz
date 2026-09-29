import { describe, expect, it, vi, afterEach } from "vitest";
import { IDLE_VIZ_DEMO_HOSTS } from "../plugins/fixtures/idle-viz-frame";
import { ARCADE_IDLE_MAX_ROWS_PER_STEP, ARCADE_IDLE_RESUME_EMPTY_POLLS, ArcadeIdleFeed, type ArcadeIdleShaper } from "./arcade-idle-feed";
import { shapeFroggerIdle, shapeInvadersIdle, shapePongIdle } from "./arcade-idle-shapers";

/** #181 shared arcade idle feed: the takeover rule, pace, dispose, seed and host list, per shaper. Counts only. */

type Row = readonly [number, ...unknown[]];
const SHAPERS = { frogger: shapeFroggerIdle, invaders: shapeInvadersIdle, netpong: shapePongIdle } as unknown as Record<string, ArcadeIdleShaper<Row>>;
/** the picks each engine can be in: its group, or one device (an address off the demo list, as on a real LAN) */
const PICKS: Record<string, { me: string; scope: string }[]> = {
  frogger: [{ me: "", scope: "lan" }, { me: "192.168.1.50", scope: "" }],
  invaders: [{ me: "", scope: "lan" }, { me: "192.168.1.50", scope: "" }],
  netpong: [{ me: "", scope: "any" }, { me: "", scope: "lan" }, { me: "", scope: "internet" }, { me: "192.168.1.1", scope: "" }],
};

function feedOf(shaper: ArcadeIdleShaper<Row>, seed = 7) {
  const got: Row[][] = [];
  let t = 1_000;
  const feed = new ArcadeIdleFeed<Row>({ shaper, seed, clock: () => t, deliver: (rows) => got.push(rows) });
  feed.start();
  return { feed, got, tick: () => { t += 1; } };
}

afterEach(() => { vi.useRealTimers(); });

describe("#181 shared arcade idle feed", () => {
  it("takeover rule: off on the first live poll; back only on the 3rd empty poll in a row, never after time alone", () => {
    vi.useFakeTimers();
    const { feed, got } = feedOf(SHAPERS.frogger);
    feed.pollEmpty(); feed.pollEmpty(); feed.pollEmpty();
    expect(got.length, "deliveries while on (3 empty polls)").toBe(3);
    expect(feed.pollLive(), "live poll reports demo rows on screen").toBe(true);
    expect(feed.showing).toBe(false);
    feed.pollEmpty(); feed.pollEmpty();
    expect(got.length, "after live + 2 empty polls").toBe(3);
    feed.pollLive(); // a live poll in between starts the count again
    feed.pollEmpty(); feed.pollEmpty();
    vi.advanceTimersByTime(60_000); // time alone does nothing
    expect(got.length, "after live, 2 empty, 60 s").toBe(3);
    feed.pollEmpty();
    expect(ARCADE_IDLE_RESUME_EMPTY_POLLS).toBe(3);
    expect(got.length, "after the 3rd empty poll in a row").toBe(4);
    expect(feed.showing).toBe(true);
  });

  for (const [name, shaper] of Object.entries(SHAPERS)) {
    it(`${name}: pace — one delivery per empty poll, at most ${ARCADE_IDLE_MAX_ROWS_PER_STEP} rows each, none without a poll`, () => {
      vi.useFakeTimers();
      const { feed, got, tick } = feedOf(shaper);
      vi.advanceTimersByTime(10_000);
      expect(got.length, "deliveries with no poll").toBe(0);
      for (let i = 0; i < 20; i++) { feed.pollEmpty(PICKS[name][0].me, PICKS[name][0].scope); tick(); }
      expect(got.length, "deliveries for 20 empty polls").toBe(20);
      expect(Math.max(...got.map((r) => r.length)), "rows in the biggest batch").toBeLessThanOrEqual(ARCADE_IDLE_MAX_ROWS_PER_STEP);
    });

    it(`${name}: dispose — a stopped feed delivers 0 rows on later empty polls`, () => {
      const { feed, got } = feedOf(shaper);
      feed.pollEmpty();
      const n = got.length;
      feed.stop();
      for (let i = 0; i < 5; i++) feed.pollEmpty();
      expect(n, "delivered before stop").toBe(1);
      expect(got.length - n, "deliveries after stop").toBe(0);
    });

    it(`${name}: seed — two runs with the same seed shape identical rows; another seed differs`, () => {
      for (const pick of PICKS[name]) {
        const run = (seed: number) => { const f = feedOf(shaper, seed); for (let i = 0; i < 12; i++) { f.feed.pollEmpty(pick.me, pick.scope); f.tick(); } return f.got; };
        const a = run(42), b = run(42), c = run(43);
        expect(a.length, `${JSON.stringify(pick)} batches`).toBe(12);
        expect(b, `${JSON.stringify(pick)} same seed`).toEqual(a);
        expect(JSON.stringify(c) === JSON.stringify(a), `${JSON.stringify(pick)} another seed`).toBe(false);
      }
    });

    it(`${name}: hosts — every endpoint of the shaped rows is in IDLE_VIZ_DEMO_HOSTS, for every pick`, () => {
      const list = new Set(IDLE_VIZ_DEMO_HOSTS.map((h) => h.ip));
      for (const pick of PICKS[name]) {
        const { feed, got, tick } = feedOf(shaper);
        for (let i = 0; i < 30; i++) { feed.pollEmpty(pick.me, pick.scope); tick(); }
        const hosts = new Set(got.flat().flatMap((p) => [p[2], p[9]].filter((x): x is string => typeof x === "string")));
        expect(got.flat().length, `${JSON.stringify(pick)} rows`).toBeGreaterThan(0);
        expect([...hosts].filter((h) => !list.has(h)), `${JSON.stringify(pick)} endpoints off the list`).toEqual([]);
      }
    });
  }
});
