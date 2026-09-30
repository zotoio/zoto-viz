// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import type { Packet, StateMsg, TrafficMsg } from "../core/types";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { PongView } from "./pong";
import { mockPartial } from "../../test-support/mock-partial";

/**
 * NetPong's packets-per-second reading (the HUD's "N pkt/s") must fall back once packets stop.
 *
 * `stats.pps` is an EWMA stepped once per /api/traffic poll: pps = pps x 0.6 + (fresh packets / s) x 0.4.
 * A poll with no packets is a 0-packet sample (x 0.6), exactly as the ArcadeView engines do it (arcade.ts),
 * unless the #181 demo feed hands a batch to the real ingest on that poll (that ingest is the poll's step).
 * Counts and values only: fake timers drive the poll interval, nothing is timed.
 */

const K = 5;               // live packets per poll
const LIVE_POLLS = 4;
const LIVE = K * (1 - 0.6 ** LIVE_POLLS); // 4.352 pkt/s after 4 polls of 5 packets from a 0 start

/**
 * #199: where the HUD's Math.round first reads 0 once every quiet poll multiplies the rate by 0.6:
 * n = ceil(ln(0.5 / r0) / ln 0.6). Pinned, not computed: poll n - 1 still reads >= 1, poll n reads 0.
 * r0 is driven through the real ingest: `polls` live polls of `k` packets from a 0 start (k x (1 - 0.6^polls)).
 */
const FIRST_ZERO = [
  { r0: LIVE, k: K, polls: LIVE_POLLS, n: 5 },
  { r0: 50, k: 125, polls: 1, n: 10 },
  { r0: 200, k: 500, polls: 1, n: 12 },
] as const;

interface Recorder { ctx: CanvasRenderingContext2D; texts: string[] }

/** A 2D context that records fillText and no-ops everything else (happy-dom has no canvas). */
function recordingCtx(): Recorder {
  const texts: string[] = [];
  // collaborator fake: an empty 2D context; the Proxy answers every method, own properties hold what the view sets
  const store = mockPartial<CanvasRenderingContext2D>({});
  const ctx = new Proxy(store, {
    get(t, k) {
      if (Object.prototype.hasOwnProperty.call(t, k)) return Reflect.get(t, k);
      if (k === "fillText") return (s: string) => { texts.push(String(s)); };
      if (k === "measureText") return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop() {} });
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === "getLineDash") return () => [];
      return () => {};
    },
    set(t, k, v) { return Reflect.set(t, k, v); },
  });
  return { ctx, texts };
}

/** Collaborator fake: the two NetScene members PongView reads (device lookup, alias resolve). */
function sceneFor(msg: StateMsg): NetScene {
  return mockPartial<NetScene>({
    deviceOf: (ip: string) => msg.devices.find((d) => d.ip === ip),
    resolve: (ip: string) => ip,
  });
}

/** A clean HOME: this host and its router only (netpong's default source is the gateway). */
function cleanHomeState(): StateMsg {
  const g = goldenLanFixture();
  const self = { ...g.devices[0], ip: "192.168.1.50", names: ["box"], hostnames: [] };
  const gw = { ...g.devices[1], ip: "192.168.1.1", names: ["router"] };
  return { ...g, local_ip: self.ip, gateway: gw.ip, devices: [self, gw], flows: [] };
}

type Mode = "live" | "empty" | "error" | "away" | "hang" | "hold";

describe("netpong: the packets-per-second reading drops back once packets stop", () => {
  let rec: Recorder;
  let mode: Mode = "live";
  let fetches = 0;
  let seq = 0;
  let liveK: number = K;
  /** resolvers of fetches held in "hold" mode (a hung fetch that the row answers later) */
  let held: ((r: Response) => void)[] = [];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  /** liveK real packets, newest first like the server, all newer than the previous poll's (and inside REPLAY_S) */
  const liveBody = (ip: string): TrafficMsg => {
    const t = Date.now() / 1000;
    const packets: Packet[] = [];
    for (let i = 0; i < liveK; i++) {
      seq++;
      packets.push([t - i * 0.001, "out", "93.184.216.34", "TCP", "tcp/443", 74, "eth0", "[SYN] Seq=0", `${50000 + seq}→443`]);
    }
    return { ip, peer: null, ts: t, packets, window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] } };
  };

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(rec.ctx);
    mode = "live"; fetches = 0; seq = 0; liveK = K; held = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetches++;
      const ip = new URL(url, "http://x").searchParams.get("ip") ?? "";
      if (mode === "away") throw new TypeError("Failed to fetch");
      if (mode === "hang") return new Promise<Response>(() => {}); // never settles
      if (mode === "hold") return new Promise<Response>((res) => held.push(res));
      if (mode === "error") return json({ error: "unknown device" }, 404);
      return json(mode === "live" ? liveBody(ip) : { ip, packets: [] });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mount() {
    const msg = cleanHomeState();
    const el = document.createElement("div");
    el.className = "arcade";
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 960 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 640 });
    document.body.append(el);
    const view = new PongView(el, sceneFor(msg));
    view.update(msg);
    view.start(null); // the poll at start
    view.update(msg);
    const pps = () => view["stats"].pps;
    /** the HUD rate row of the next drawn frame */
    const hud = async () => {
      rec.texts.length = 0;
      await vi.advanceTimersByTimeAsync(40);
      return [...rec.texts].reverse().find((t) => /^\d+ pkt\/s/.test(t)) ?? "";
    };
    /** exactly one poll interval (one /api/traffic fetch) */
    const poll = async () => { const f = fetches; await vi.advanceTimersByTimeAsync(1000); expect(fetches, "one poll per interval").toBe(f + 1); };
    /** one poll interval that must not start a fetch (the previous one is still in flight) */
    const tick = async () => { const f = fetches; await vi.advanceTimersByTimeAsync(1000); expect(fetches, "no second fetch while one is in flight").toBe(f); };
    const demoShowing = () => view["idle"].showing;
    /** demo batches the idle feed has handed to the real ingest */
    const delivered = () => view["idle"].delivered;
    return { view, pps, hud, poll, tick, demoShowing, delivered };
  }

  /** LIVE_POLLS polls of K live packets each (the poll at start + LIVE_POLLS - 1 interval polls) */
  async function flowLive(v: ReturnType<typeof mount>) {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i < LIVE_POLLS; i++) await v.poll();
    expect(fetches, "live polls").toBe(LIVE_POLLS);
    expect(v.pps(), `pps after ${LIVE_POLLS} polls of ${K} packets`).toBeCloseTo(LIVE, 9);
    const row = await v.hud();
    expect(row.startsWith(`${Math.round(LIVE)} pkt/s · `), `HUD while packets flow: "${row}"`).toBe(true);
    expect(v.demoShowing(), "live traffic: no demo").toBe(false);
  }

  for (const quiet of ["empty", "error"] as const) {
    it(`${quiet === "empty" ? "empty" : "failed (HTTP 404)"} polls after live traffic: the reading decays x0.6 per poll while the demo is off, then the demo's own rate takes over on the 3rd`, async () => {
      const v = mount();
      await flowLive(v);
      mode = quiet;
      await v.poll();
      expect(v.pps(), `after 1 ${quiet} poll: live x 0.6`).toBeCloseTo(LIVE * 0.6, 9);
      expect(await v.hud(), `HUD after 1 ${quiet} poll`).toMatch(/^3 pkt\/s · /);
      await v.poll();
      expect(v.pps(), `after 2 ${quiet} polls: live x 0.36`).toBeCloseTo(LIVE * 0.36, 9);
      expect(await v.hud(), `HUD after 2 ${quiet} polls`).toMatch(/^2 pkt\/s · /);
      expect(v.demoShowing(), "no demo before the 3rd quiet poll in a row").toBe(false);
      // 3rd quiet poll: the demo is back and genuinely sending demo packets through the real ingest
      await v.poll();
      expect(v.demoShowing(), "demo after the 3rd quiet poll").toBe(true);
      const row = await v.hud();
      expect(row, "HUD on the demo: its own rate, with the demo cue").toMatch(/^[1-9]\d* pkt\/s · demo\b/);
    });
  }

  it("server away (fetch rejects) after live traffic: the reading reaches 0 pkt/s and no demo is faked", async () => {
    const v = mount();
    await flowLive(v);
    mode = "away";
    const quiet = 5; // 4.352 x 0.6^5 = 0.338 → "0 pkt/s" (the first zero; #199: the next tick is the demo's, rows below)
    for (let i = 1; i <= quiet; i++) {
      await v.poll();
      expect(v.pps(), `after ${i} failed fetch(es)`).toBeCloseTo(LIVE * 0.6 ** i, 9);
    }
    const row = await v.hud();
    expect(row, `HUD after ${quiet} failed polls with the server away`).toMatch(/^0 pkt\/s · /);
    expect(row, "no demo cue: the demo feed sends nothing while the server is away").not.toMatch(/· demo\b/);
    expect(v.demoShowing(), "demo while the server is away").toBe(false);
  });

  /** `polls` live polls of `k` packets (the poll at start + polls - 1 interval polls); returns the view at r0 */
  async function driveTo(r: (typeof FIRST_ZERO)[number]) {
    liveK = r.k;
    const v = mount();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i < r.polls; i++) await v.poll();
    expect(v.pps(), `r0 after ${r.polls} poll(s) of ${r.k} packets`).toBeCloseTo(r.r0, 9);
    expect(v.demoShowing(), "live traffic: no demo").toBe(false);
    return v;
  }

  /** the HUD's integer reading */
  const reading = async (v: ReturnType<typeof mount>) => {
    const row = await v.hud();
    expect(row, "HUD rate row drawn").toMatch(/^\d+ pkt\/s/);
    return Number(/^(\d+) pkt\/s/.exec(row)?.[1]);
  };

  for (const r of FIRST_ZERO) {
    it(`#199 server away (fetch rejects) from ${r.r0.toFixed(3)} pkt/s: the HUD first reads 0 on failed poll ${r.n} (poll ${r.n - 1} still >= 1)`, async () => {
      const v = await driveTo(r);
      mode = "away";
      const seen: number[] = [];
      for (let i = 1; i <= r.n; i++) {
        await v.poll();
        expect(v.pps(), `after ${i} failed fetch(es): r0 x 0.6^${i}`).toBeCloseTo(r.r0 * 0.6 ** i, 9);
        expect(v.demoShowing(), `no demo on failed poll ${i} (up to the first zero)`).toBe(false);
        seen.push(await reading(v));
      }
      expect(seen.slice(0, -1).every((x) => x >= 1), `HUD readings before failed poll ${r.n}: ${seen.join(", ")}`).toBe(true);
      expect(seen[r.n - 1], `HUD reading on failed poll ${r.n} (all: ${seen.join(", ")})`).toBe(0);
      expect(v.demoShowing(), "no demo while the server is away").toBe(false);
      // #199 (UX Pro, an empty board is a Fail): the tick after the first zero hands the board to the demo
      const d0 = v.delivered();
      await v.poll();
      expect(v.delivered() - d0, `demo batches on failed poll ${r.n + 1}, the tick after the first zero`).toBe(1);
      expect(v.demoShowing(), `demo on failed poll ${r.n + 1}`).toBe(true);
      const demoRow = await v.hud();
      expect(demoRow, `HUD on failed poll ${r.n + 1}: the demo's own rate, with the demo cue`).toMatch(/^[1-9]\d* pkt\/s · demo\b/);
      expect(v.pps(), "HUD rate on the demo").toBeGreaterThan(0);
    });

    it(`#199 hung fetch (never settles) from ${r.r0.toFixed(3)} pkt/s: each tick that finds it in flight is a quiet poll, no second fetch, and the HUD first reads 0 on quiet poll ${r.n}`, async () => {
      const v = await driveTo(r);
      mode = "hang";
      await v.poll(); // this tick starts the fetch that never settles: nothing is known about it yet
      expect(v.pps(), "the tick that starts the hung fetch").toBeCloseTo(r.r0, 9);
      const seen: number[] = [];
      for (let i = 1; i <= r.n; i++) {
        await v.tick();
        expect(v.pps(), `after ${i} tick(s) with the fetch still in flight: r0 x 0.6^${i}`).toBeCloseTo(r.r0 * 0.6 ** i, 9);
        expect(v.demoShowing(), `no demo on quiet tick ${i} (up to the first zero)`).toBe(false);
        seen.push(await reading(v));
      }
      expect(seen.slice(0, -1).every((x) => x >= 1), `HUD readings before quiet poll ${r.n}: ${seen.join(", ")}`).toBe(true);
      expect(seen[r.n - 1], `HUD reading on quiet poll ${r.n} (all: ${seen.join(", ")})`).toBe(0);
      expect(fetches, "fetches: the live ones + the one hung fetch").toBe(r.polls + 1);
      expect(v.demoShowing(), "no demo while the fetch hangs").toBe(false);
      // #199 (UX Pro, an empty board is a Fail): the tick after the first zero hands the board to the demo
      const d0 = v.delivered();
      await v.tick();
      expect(v.delivered() - d0, `demo batches on quiet tick ${r.n + 1}, the tick after the first zero`).toBe(1);
      expect(v.demoShowing(), `demo on quiet tick ${r.n + 1}`).toBe(true);
      const demoRow = await v.hud();
      expect(demoRow, `HUD on quiet tick ${r.n + 1}: the demo's own rate, with the demo cue`).toMatch(/^[1-9]\d* pkt\/s · demo\b/);
      expect(v.pps(), "HUD rate on the demo").toBeGreaterThan(0);
      // the demo keeps playing locally on the next quiet tick, still with no second fetch
      await v.tick();
      expect(v.delivered() - d0, "demo batches over 2 quiet ticks after the first zero").toBe(2);
      expect(fetches, "fetches after the demo took over: still the live ones + the one hung fetch").toBe(r.polls + 1);
    });
  }

  // #199: live takes over again from a demo that a failed or a hung fetch brought in, within that poll
  for (const path of ["away", "hold"] as const) {
    it(`#199 ${path === "away" ? "server away" : "hung fetch"} → demo after the first zero → live answer: live takes over at once (no demo cue, live rate)`, async () => {
      const r = FIRST_ZERO[0];
      const v = await driveTo(r);
      mode = path;
      if (path === "hold") await v.poll(); // starts the fetch that hangs until the row answers it
      for (let i = 1; i <= r.n + 1; i++) await (path === "hold" ? v.tick() : v.poll());
      expect(v.demoShowing(), `demo on quiet tick ${r.n + 1}`).toBe(true);
      expect(await v.hud(), "HUD on the demo").toMatch(/· demo\b/);
      const f = fetches;
      mode = "live";
      if (path === "hold") {
        expect(held.length, "the one hung fetch").toBe(1);
        held.forEach((res) => res(json(liveBody("")))); held = [];
        await vi.advanceTimersByTimeAsync(0);
        expect(fetches, "the hung fetch's answer starts no fetch").toBe(f);
      } else {
        await v.poll();
      }
      expect(v.demoShowing(), "demo after the live answer").toBe(false);
      const row = await v.hud();
      expect(row, "HUD after the live answer: no demo cue").not.toMatch(/· demo\b/);
      expect(v.pps(), `live rate: ${r.k} packets in one poll from a 0 start`).toBeCloseTo(r.k * 0.4, 9);
      await v.poll(); // and polling carries on
      expect(v.demoShowing(), "demo after the next live poll").toBe(false);
    });
  }
});
