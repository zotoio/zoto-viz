// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import type { Packet, StateMsg, TrafficMsg } from "../core/types";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { PongView } from "./pong";

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

interface Recorder { ctx: CanvasRenderingContext2D; texts: string[] }

/** A 2D context that records fillText and no-ops everything else (happy-dom has no canvas). */
function recordingCtx(): Recorder {
  const texts: string[] = [];
  const store: CanvasRenderingContext2D = Object.create(null);
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return Reflect.get(t, k);
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

function sceneFor(msg: StateMsg): NetScene {
  const scene: Pick<NetScene, "deviceOf" | "resolve"> = {
    deviceOf: (ip: string) => msg.devices.find((d) => d.ip === ip),
    resolve: (ip: string) => ip,
  };
  return Object.assign(Object.create(null), { pulseNow: { level: 0 }, selectIp: () => {} }, scene);
}

/** A clean HOME: this host and its router only (netpong's default source is the gateway). */
function cleanHomeState(): StateMsg {
  const g = goldenLanFixture();
  const self = { ...g.devices[0], ip: "192.168.1.50", names: ["box"], hostnames: [] };
  const gw = { ...g.devices[1], ip: "192.168.1.1", names: ["router"] };
  return { ...g, local_ip: self.ip, gateway: gw.ip, devices: [self, gw], flows: [] };
}

type Mode = "live" | "empty" | "error" | "away";

describe("netpong: the packets-per-second reading drops back once packets stop", () => {
  let rec: Recorder;
  let mode: Mode = "live";
  let fetches = 0;
  let seq = 0;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  /** K real packets, newest first like the server, all newer than the previous poll's */
  const liveBody = (ip: string): TrafficMsg => {
    const t = Date.now() / 1000;
    const packets: Packet[] = [];
    for (let i = 0; i < K; i++) {
      seq++;
      packets.push([t - i * 0.1, "out", "93.184.216.34", "TCP", "tcp/443", 74, "eth0", "[SYN] Seq=0", `${50000 + seq}→443`]);
    }
    return { ip, peer: null, ts: t, packets, window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] } };
  };

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(rec.ctx);
    mode = "live"; fetches = 0; seq = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetches++;
      const ip = new URL(url, "http://x").searchParams.get("ip") ?? "";
      if (mode === "away") throw new TypeError("Failed to fetch");
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
    const demoShowing = () => view["idle"].showing;
    return { view, pps, hud, poll, demoShowing };
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
    const quiet = 12; // 4.352 x 0.6^12 = 0.0095 → "0 pkt/s"
    for (let i = 1; i <= quiet; i++) {
      await v.poll();
      expect(v.pps(), `after ${i} failed fetch(es)`).toBeCloseTo(LIVE * 0.6 ** i, 9);
    }
    const row = await v.hud();
    expect(row, `HUD after ${quiet} s with the server away`).toMatch(/^0 pkt\/s · /);
    expect(row, "no demo cue: the demo feed sends nothing while the server is away").not.toMatch(/· demo\b/);
    expect(v.demoShowing(), "demo while the server is away").toBe(false);
  });
});
