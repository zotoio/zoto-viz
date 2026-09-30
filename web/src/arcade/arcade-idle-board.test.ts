/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { NetScene } from "../graph/scene";
import type { Packet, StateMsg } from "../core/types";
import { DEMO_DATA_LABEL, DEMO_LABEL_CLASS } from "../core/demo-source";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { IDLE_VIZ_DEMO_HOSTS } from "../plugins/fixtures/idle-viz-frame";
import { FroggerView } from "./frogger";
import { InvadersView } from "./invaders";
import { PongView } from "./pong";
import { LiveFeed } from "../ui/feed";

/**
 * #181: on a clean HOME with no LAN traffic, frogger / netpong / invaders must still show a board (the standing
 * rule: every pack ships demo data; an empty board is a Fail). happy-dom, no GPU: the snapshot arrives over
 * update(StateMsg) like the live websocket, /api/traffic answers with no packets (no capture), and the view runs
 * on fake timers + fake rAF. Observable: the engine's on-screen entities (frogs / paddle balls / invader rows, what
 * draw() paints), the canvas text of each frame, the demo label in the DOM, and the rows each `ingest` call gets.
 * Counts only, never timing.
 */

const WAIT_TEXT = "waiting for packets…";
const ENGINES = ["frogger", "netpong", "invaders"] as const;
type Engine = (typeof ENGINES)[number];
type AnyView = FroggerView | InvadersView | PongView;
type Proto = Record<string, (...a: unknown[]) => unknown>;

interface Recorder { ctx: CanvasRenderingContext2D; texts: string[] }

function recordingCtx(): Recorder {
  const texts: string[] = [];
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "fillText") return (s: string) => { texts.push(String(s)); };
      if (k === "measureText") return (s: string) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop() {} });
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === "getLineDash") return () => [];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

function sceneFor(msg: StateMsg): NetScene {
  return {
    pulseNow: { level: 0 },
    selectIp: () => {},
    deviceOf: (ip: string) => msg.devices.find((d) => d.ip === ip),
    resolve: (ip: string) => ip,
  } as unknown as NetScene;
}

/** A clean HOME: this host and its router only, on addresses the demo host list does not use. */
function cleanHomeState(): StateMsg {
  const g = goldenLanFixture();
  const self = { ...g.devices[0], ip: "192.168.1.50", names: ["box"], hostnames: [] };
  const gw = { ...g.devices[1], ip: "192.168.1.1", names: ["router"] };
  return { ...g, local_ip: self.ip, gateway: gw.ip, devices: [self, gw], flows: [] };
}

/** A LAN device with no name at all (no DNS, mDNS or hostname). */
const NAMELESS_IP = "192.168.1.77";
function cleanHomeWithNameless(): StateMsg {
  const m = cleanHomeState();
  return { ...m, devices: [...m.devices, { ...m.devices[0], ip: NAMELESS_IP, role: "lan", online: true, names: [], hostnames: [], mdns_name: undefined, aliases: [] }] };
}

/** An off-fixture internet host that live traffic talks to (TEST-NET-1). */
const OFF_HOST = "192.0.2.7";
function cleanHomeWithOffHost(): StateMsg {
  const m = cleanHomeState();
  return { ...m, devices: [...m.devices, { ...m.devices[0], ip: OFF_HOST, role: "internet", names: ["off.example.net"] }] };
}

const protoOf = (engine: Engine): Proto =>
  (engine === "frogger" ? FroggerView.prototype : engine === "invaders" ? InvadersView.prototype : PongView.prototype) as unknown as Proto;

/** Rows handed to one ingest call (pong takes the whole TrafficMsg). */
function rowsOf(engine: Engine, args: unknown[]): Packet[] {
  return engine === "netpong" ? (args[0] as { packets: Packet[] }).packets : (args[0] as Packet[]);
}
/** Rows from the demo feed carry the shapers' iface; live rows here carry eth0. */
const isDemo = (rows: Packet[]) => rows.length > 0 && rows.every((p) => p[6] === "demo");

function entities(engine: Engine, view: unknown): number {
  const v = view as { frogs?: unknown[]; balls?: unknown[]; rows?: Map<string, unknown> };
  if (engine === "frogger") return v.frogs!.length;
  if (engine === "netpong") return v.balls!.length;
  return v.rows!.size;
}

/** The view's own single-device pick: the one host the board may show besides the demo list (none for a group). */
function pickedOf(engine: Engine, view: unknown): string[] {
  if (engine === "netpong") { const v = view as { srcIsGroup: boolean; srcIp: string }; return v.srcIsGroup ? [] : [v.srcIp]; }
  const v = view as { picker: { isGroup: boolean; ip(): string } };
  return v.picker.isGroup ? [] : [v.picker.ip()];
}
/** Allowed hosts on a demo board: IDLE_VIZ_DEMO_HOSTS plus the picked device, and nothing else. */
const allowedFor = (engine: Engine, view: unknown) => new Set([...(IDLE_VIZ_DEMO_HOSTS ?? []).map((h) => h.ip), ...pickedOf(engine, view)]);
const PICK_KEY: Record<Engine, string> = { frogger: "zoto-viz.frogger.devices", invaders: "zoto-viz.invaders.cannons", netpong: "zoto-viz.pong.source" };

/** Every host the board holds as an entity (the view's own pick included where the engine draws it). */
function boardHosts(engine: Engine, view: unknown): string[] {
  if (engine === "frogger") {
    const v = view as { cols: Map<string, unknown>; frogs: { dev: string; peer: string }[] };
    return [...v.cols.keys(), ...v.frogs.flatMap((f) => [f.dev, f.peer].filter(Boolean))];
  }
  if (engine === "invaders") {
    const v = view as { cannons: Map<string, unknown>; rows: Map<string, { aliens: Map<string, unknown> }> };
    return [...v.cannons.keys(), ...[...v.rows.values()].flatMap((r) => [...r.aliens.keys()])];
  }
  const v = view as { sources: { rows: Map<string, unknown> }; lanes: { rows: Map<string, { host: string; owner: string }> } };
  return [...v.sources.rows.keys(), ...[...v.lanes.rows.values()].map((l) => l.host)];
}

type FetchMode = "empty" | "live" | "hold" | "error" | "away" | "hang";

describe("#181 arcade views show a board with no LAN traffic (clean HOME)", () => {
  let rec: Recorder;
  let fetches = 0;
  let mode: FetchMode = "empty";
  let held: ((r: Response) => void)[] = [];
  let liveSeq = 0;
  let livePeer = "93.184.216.34";
  /** real packets per live poll (#199 drives the rate to a pinned r0 with more) */
  let liveK = 1;

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  /** liveK real packets per poll (newest first), newer each time (a device on the LAN talking to a web host) */
  const liveBody = (ip: string) => {
    const t = Date.now() / 1000;
    const packets: Packet[] = [];
    for (let i = 0; i < liveK; i++) {
      liveSeq++;
      packets.push([t - i * 0.001, "out", livePeer, "TCP", "tcp/443", 74, "eth0", "[SYN] Seq=0", `${50000 + liveSeq}→443`, "192.168.1.50"]);
    }
    return { ip, peer: null, ts: t, packets, window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] } };
  };

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(rec.ctx as never);
    fetches = 0; mode = "empty"; held = []; liveSeq = 0; livePeer = "93.184.216.34"; liveK = 1;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetches++;
      const ip = new URL(url, "http://x").searchParams.get("ip") ?? "";
      if (mode === "hold") return new Promise<Response>((res) => held.push(res));
      if (mode === "away") throw new TypeError("Failed to fetch");
      if (mode === "hang") return new Promise<Response>(() => {}); // never settles
      if (mode === "error") return new Response(JSON.stringify({ error: "unknown device" }), { status: 404, headers: { "Content-Type": "application/json" } });
      return json(mode === "live" ? liveBody(ip) : { ip, packets: [] });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mount(engine: Engine, msg: StateMsg = goldenLanFixture()) {
    const proto = protoOf(engine);
    const ingest: MockInstance<Proto[string]> = vi.isMockFunction(proto.ingest) ? proto.ingest : vi.spyOn(proto, "ingest");
    const el = document.createElement("div");
    el.className = "arcade";
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 960 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 640 });
    document.body.append(el);
    const scene = sceneFor(msg);
    const view: AnyView = engine === "frogger" ? new FroggerView(el, scene) : engine === "invaders" ? new InvadersView(el, scene) : new PongView(el, scene);
    view.update(msg);
    view.start(null);
    view.update(msg);
    const demoCalls = () => ingest.mock.calls.filter((c) => isDemo(rowsOf(engine, c))).length;
    const allRows = () => ingest.mock.calls.flatMap((c) => rowsOf(engine, c));
    const label = () => el.querySelector<HTMLElement>(`.${DEMO_LABEL_CLASS}`);
    const badge = () => label()?.textContent ?? "";
    const labelShown = () => { const l = label(); return !!l && l.classList.contains("is-visible") && (badge() === DEMO_DATA_LABEL || badge().startsWith("Demo traffic around ")); };
    // #182: the feed panel next to the board, with the stale "waiting for packets…" its last empty poll left
    // behind before the arcade view opened (the feed panel does not poll while an arcade view is up)
    const feedEl = document.createElement("div");
    document.body.append(feedEl);
    const feed = new LiveFeed(feedEl, scene);
    (feed as unknown as { ingest(m: { packets: Packet[] }): void }).ingest({ packets: [] });
    const feedStatus = () => feedEl.querySelector<HTMLElement>(".feed-hint")?.textContent ?? "";
    /** the HUD rate row of the next drawn frame: its count and whether it carries the demo cue */
    const hud = async () => {
      rec.texts.length = 0;
      await vi.advanceTimersByTimeAsync(40);
      const row = [...rec.texts].reverse().find((t) => /^\d+ pkt\/s/.test(t)) ?? "";
      return { row, pps: Number(/^(\d+) pkt\/s/.exec(row)?.[1] ?? NaN), demo: /^\d+ pkt\/s · demo\b/.test(row) };
    };
    /** advance exactly one poll interval (one /api/traffic fetch) */
    const poll = async () => { const f = fetches; await vi.advanceTimersByTimeAsync(1000); expect(fetches, "one poll per interval").toBe(f + 1); };
    /** one poll interval that must not start a fetch (the previous one is still in flight) */
    const tick = async () => { const f = fetches; await vi.advanceTimersByTimeAsync(1000); expect(fetches, "no second fetch while one is in flight").toBe(f); };
    return { el, view, ingest, demoCalls, allRows, labelShown, badge, poll, tick, hud, feedStatus };
  }

  async function runEngine(engine: Engine) {
    const { view } = mount(engine);
    for (let s = 0; s < 10; s++) await vi.advanceTimersByTimeAsync(1000);
    rec.texts.length = 0;
    await vi.advanceTimersByTimeAsync(40);
    const lastFrame = [...rec.texts];
    const n = entities(engine, view);
    view.stop();
    return { n, lastFrame, why: `${engine}: ${n} on-screen entities after 10 s, ${fetches} empty /api/traffic polls; last frame text: ${JSON.stringify(lastFrame.filter((t) => /waiting|no |demo/i.test(t)))}` };
  }

  for (const engine of ENGINES) {
    it(`${engine}: non-empty board after 10 s with no live traffic`, async () => {
      const r = await runEngine(engine);
      expect(r.lastFrame.length, `drew a frame: ${r.why}`).toBeGreaterThan(0);
      expect(r.lastFrame, r.why).not.toContain(WAIT_TEXT);
      expect(r.n, r.why).toBeGreaterThan(0);
    });
  }

  for (const engine of ENGINES) {
    it(`${engine}: UX — while the feed runs "waiting for packets…" is never drawn, the demo label is shown, and the HUD rate (> 0, "· demo") and the feed panel status line agree with it (#182)`, async () => {
      const { labelShown, demoCalls, badge, hud, feedStatus } = mount(engine, cleanHomeState());
      expect(feedStatus(), "stale feed status before the demo").toBe(WAIT_TEXT);
      let labelFrames = 0, waits = 0;
      for (let s = 0; s < 5; s++) {
        await vi.advanceTimersByTimeAsync(1000);
        if (labelShown()) labelFrames++;
        waits += rec.texts.filter((t) => t === WAIT_TEXT).length;
        const h = await hud();
        // one row: the badge, the HUD counter and the feed panel status line can never disagree
        expect(h.row, `HUD rate row drawn at poll ${s + 1}`).not.toBe("");
        expect(h.demo, `HUD "· demo" cue iff the badge is visible (poll ${s + 1}: "${h.row}", badge ${labelShown()})`).toBe(labelShown());
        expect(feedStatus() === badge() && feedStatus() !== "", `feed status iff the badge (poll ${s + 1}: "${feedStatus()}" vs "${badge()}")`).toBe(labelShown());
        expect(h.pps, `HUD rate while demo rows are ingested (poll ${s + 1}: "${h.row}")`).toBeGreaterThan(0);
      }
      expect(demoCalls(), "the feed ran").toBeGreaterThan(0);
      expect(waits, `"${WAIT_TEXT}" draws over 5 s of demo frames`).toBe(0);
      expect(labelFrames, "demo label shown at each of 5 polls").toBe(5);
    });

    it(`${engine}: UX — after the first real non-empty poll the demo label, the HUD "· demo" cue and the feed panel's demo status are all gone within one poll (#182)`, async () => {
      const { labelShown, poll, hud, feedStatus, badge } = mount(engine, cleanHomeState());
      await poll(); await poll();
      expect(labelShown(), "label shown while the demo runs").toBe(true);
      const d = await hud();
      expect(d.demo, `HUD cue while the demo runs ("${d.row}")`).toBe(true);
      expect(d.pps, `HUD rate while the demo runs ("${d.row}")`).toBeGreaterThan(0);
      expect(feedStatus(), "feed status while the demo runs").toBe(badge());
      mode = "live";
      await poll();
      expect(labelShown(), "label after one live poll").toBe(false);
      const l = await hud();
      expect(l.row, "HUD rate row still drawn after takeover (the counter is never hidden)").not.toBe("");
      expect(l.demo, `HUD cue after one live poll ("${l.row}")`).toBe(false);
      expect(feedStatus(), "feed status after one live poll: no demo text, no stale waiting").toBe("");
    });

    // ArcadeView engines only: netpong keeps its own stats.pps; its quiet-poll decay rows are in pong-pps-decay.test.ts (#197).
    if (engine !== "netpong") it(`${engine}: a failed poll (HTTP error) decays the HUD rate x0.6, exactly like an empty poll (#182)`, async () => {
      const { view, poll, labelShown, demoCalls } = mount(engine, cleanHomeState());
      const pps = () => (view as unknown as { pps: number }).pps;
      mode = "live";
      for (let i = 0; i < 3; i++) await poll();
      expect(labelShown(), "live traffic: no demo").toBe(false);
      const live = pps();
      expect(live, "HUD rate after 3 live polls").toBeGreaterThan(0);
      mode = "error";
      const off = demoCalls();
      await poll();
      expect(pps(), "after 1 failed poll: live x 0.6").toBeCloseTo(live * 0.6, 9);
      await poll();
      expect(pps(), "after 2 failed polls: live x 0.6 x 0.6").toBeCloseTo(live * 0.36, 9);
      expect(demoCalls() - off, "no demo batch before the 3rd empty/failed poll in a row").toBe(0);
    });

    // #199: with the server away (fetch rejects) the rate falls back x0.6 per failed poll, as netpong's does (#197).
    // First HUD zero pinned (Math.round): from 4.352 on failed poll 5, from 50 on 10, from 200 on 12.
    if (engine !== "netpong") for (const r of [{ r0: 4.352, k: 5, polls: 4, n: 5 }, { r0: 50, k: 125, polls: 1, n: 10 }, { r0: 200, k: 500, polls: 1, n: 12 }]) {
      it(`${engine}: server away (fetch rejects) from ${r.r0} pkt/s — the HUD first reads 0 on failed poll ${r.n} (poll ${r.n - 1} still >= 1) (#199)`, async () => {
        const { view, poll, hud, labelShown, demoCalls, ingest } = mount(engine, cleanHomeState());
        if (view instanceof PongView) throw new Error("ArcadeView engines only");
        const pps = () => view["pps"];
        liveK = r.k;
        mode = "live";
        for (let i = 0; i < r.polls; i++) await poll();
        expect(labelShown(), "live traffic: no demo").toBe(false);
        expect(pps(), `r0 after ${r.polls} live poll(s) of ${r.k} packets`).toBeCloseTo(r.r0, 9);
        const off = demoCalls();
        mode = "away";
        const seen: number[] = [];
        for (let i = 1; i <= r.n; i++) {
          await poll();
          expect(pps(), `after ${i} failed fetch(es): r0 x 0.6^${i}`).toBeCloseTo(r.r0 * 0.6 ** i, 9);
          expect(demoCalls() - off, `no demo batch by failed poll ${i} (up to the first zero)`).toBe(0);
          const h = await hud();
          expect(h.row, `HUD rate row drawn after failed poll ${i}`).not.toBe("");
          seen.push(h.pps);
        }
        expect(seen.slice(0, -1).every((x) => x >= 1), `HUD readings before failed poll ${r.n}: ${seen.join(", ")}`).toBe(true);
        expect(seen[r.n - 1], `HUD reading on failed poll ${r.n} (all: ${seen.join(", ")})`).toBe(0);
        expect(labelShown(), "no demo while the server is away").toBe(false);
        // #199 (UX Pro, an empty board is a Fail): the tick after the first zero hands the board to the demo
        await poll();
        expect(demoCalls() - off, `demo batches on failed poll ${r.n + 1}, the tick after the first zero`).toBe(1);
        expect(labelShown(), `demo label on failed poll ${r.n + 1}`).toBe(true);
        const d = await hud();
        expect(d.row, `HUD on failed poll ${r.n + 1}: the demo cue`).toMatch(/· demo\b/);
        // the demo's own rate: the batch it just ingested (the live rows left with the board), not a made-up one
        const batch = rowsOf(engine, ingest.mock.calls[ingest.mock.calls.length - 1]);
        expect(pps(), `HUD rate on the demo: its ${batch.length}-row batch x 0.4`).toBeCloseTo(batch.length * 0.4, 9);
        expect(d.pps, "HUD reading on the demo").toBe(Math.round(batch.length * 0.4));
      });
    }

    // #199: a fetch that never settles: each interval tick that finds it still in flight is a quiet poll (x0.6) and
    // starts no second fetch, as netpong's hung rows (pong-pps-decay.test.ts): first HUD zero on quiet tick 5 / 10 / 12.
    if (engine !== "netpong") for (const r of [{ r0: 4.352, k: 5, polls: 4, n: 5 }, { r0: 50, k: 125, polls: 1, n: 10 }, { r0: 200, k: 500, polls: 1, n: 12 }]) {
      it(`${engine}: hung fetch (never settles) from ${r.r0} pkt/s — each tick that finds it in flight is a quiet poll, no second fetch, and the HUD first reads 0 on quiet tick ${r.n} (#199)`, async () => {
        const { view, poll, tick, hud, labelShown, demoCalls, ingest } = mount(engine, cleanHomeState());
        if (view instanceof PongView) throw new Error("ArcadeView engines only");
        const pps = () => view["pps"];
        liveK = r.k;
        mode = "live";
        for (let i = 0; i < r.polls; i++) await poll();
        expect(labelShown(), "live traffic: no demo").toBe(false);
        expect(pps(), `r0 after ${r.polls} live poll(s) of ${r.k} packets`).toBeCloseTo(r.r0, 9);
        const off = demoCalls();
        mode = "hang";
        await poll(); // this tick starts the fetch that never settles: nothing is known about it yet
        expect(pps(), "the tick that starts the hung fetch").toBeCloseTo(r.r0, 9);
        const f0 = fetches;
        const seen: number[] = [];
        for (let i = 1; i <= r.n; i++) {
          await tick();
          expect(pps(), `after ${i} tick(s) with the fetch still in flight: r0 x 0.6^${i}`).toBeCloseTo(r.r0 * 0.6 ** i, 9);
          expect(demoCalls() - off, `no demo batch by quiet tick ${i} (up to the first zero)`).toBe(0);
          const h = await hud();
          expect(h.row, `HUD rate row drawn after quiet tick ${i}`).not.toBe("");
          seen.push(h.pps);
        }
        expect(seen.slice(0, -1).every((x) => x >= 1), `HUD readings before quiet tick ${r.n}: ${seen.join(", ")}`).toBe(true);
        expect(seen[r.n - 1], `HUD reading on quiet tick ${r.n} (all: ${seen.join(", ")})`).toBe(0);
        expect(fetches - f0, "fetches started while the hung one is in flight").toBe(0);
        expect(labelShown(), "no demo while the fetch hangs").toBe(false);
        // #199 (UX Pro, an empty board is a Fail): the tick after the first zero hands the board to the demo
        await tick();
        expect(demoCalls() - off, `demo batches on quiet tick ${r.n + 1}, the tick after the first zero`).toBe(1);
        expect(labelShown(), `demo label on quiet tick ${r.n + 1}`).toBe(true);
        const d = await hud();
        expect(d.row, `HUD on quiet tick ${r.n + 1}: the demo cue`).toMatch(/· demo\b/);
        // the demo's own rate: the batch it just ingested (the live rows left with the board), not a made-up one
        const batch = rowsOf(engine, ingest.mock.calls[ingest.mock.calls.length - 1]);
        expect(pps(), `HUD rate on the demo: its ${batch.length}-row batch x 0.4`).toBeCloseTo(batch.length * 0.4, 9);
        expect(d.pps, "HUD reading on the demo").toBe(Math.round(batch.length * 0.4));
        // the demo keeps playing locally on the next quiet tick, still with no second fetch
        await tick();
        expect(demoCalls() - off, "demo batches over 2 quiet ticks after the first zero").toBe(2);
        expect(fetches - f0, "fetches started after the demo took over").toBe(0);
      });
    }

    // #199: live takes over again from a demo that a failed or a hung fetch brought in, within that poll
    if (engine !== "netpong") for (const path of ["away", "hold"] as const) {
      it(`${engine}: ${path === "away" ? "server away" : "hung fetch"} → demo after the first zero → live answer: live takes over at once (no demo cue, live rate) (#199)`, async () => {
        const { view, poll, tick, hud, labelShown, demoCalls } = mount(engine, cleanHomeState());
        if (view instanceof PongView) throw new Error("ArcadeView engines only");
        const pps = () => view["pps"];
        liveK = 5;
        mode = "live";
        for (let i = 0; i < 4; i++) await poll();
        expect(pps(), "r0 after 4 live polls of 5 packets").toBeCloseTo(4.352, 9);
        const off = demoCalls();
        mode = path;
        if (path === "hold") await poll(); // starts the fetch that hangs until the row answers it
        for (let i = 1; i <= 6; i++) await (path === "hold" ? tick() : poll());
        expect(demoCalls() - off, "demo batches: one, on quiet tick 6 (the tick after the first zero)").toBe(1);
        expect(labelShown(), "demo label on quiet tick 6").toBe(true);
        expect((await hud()).demo, "HUD demo cue on quiet tick 6").toBe(true);
        const f = fetches;
        mode = "live";
        if (path === "hold") {
          expect(held.length, "the one hung fetch").toBe(1);
          held.forEach((res) => res(json(liveBody("")))); held = [];
          await vi.advanceTimersByTimeAsync(0);
          expect(fetches, "the hung fetch's answer starts no fetch").toBe(f);
        } else {
          await poll();
        }
        expect(labelShown(), "demo label after the live answer").toBe(false);
        const l = await hud();
        expect(l.demo, `HUD after the live answer: no demo cue ("${l.row}")`).toBe(false);
        expect(pps(), "live rate: 5 packets in one poll from a 0 start").toBeCloseTo(2, 9);
        await poll(); // and polling carries on
        expect(labelShown(), "demo label after the next live poll").toBe(false);
      });
    }

    // #199 (UX Pro): once the demo is playing it makes its own batch on every tick whether the server answers, fails
    // or hangs; it never waits on the fetch, so the board can't drain under a "Demo data" label.
    for (const path of ["away", "hold"] as const) {
      it(`${engine}: demo already playing, then ${path === "away" ? "the server goes away (fetch rejects)" : "the fetch hangs"} — a demo batch on every one of 12 ticks, board not empty, "· demo" and "Demo data" stay; a live answer then takes over on its tick (#199)`, async () => {
        const { view, poll, tick, hud, labelShown, badge, demoCalls } = mount(engine, cleanHomeState());
        const rate = () => (view instanceof PongView ? view["stats"].pps : view["pps"]);
        // reach the demo the natural way: the poll at start and 2 quiet (empty) polls
        await vi.advanceTimersByTimeAsync(0);
        await poll();
        await poll();
        expect(labelShown(), "demo playing before the server goes away").toBe(true);
        const f0 = fetches, d0 = demoCalls();
        mode = path;
        const perTick: number[] = [];
        for (let i = 1; i <= 12; i++) {
          const d = demoCalls();
          // a rejected fetch each tick; for the hang, tick 1 starts the fetch that stays in flight and 2..12 start none
          await (path === "hold" && i > 1 ? tick() : poll());
          perTick.push(demoCalls() - d);
        }
        expect(demoCalls() - d0, `demo batches over 12 ticks with the server ${path === "away" ? "away" : "hung"} (per tick: ${perTick.join(", ")})`).toBe(12);
        expect(fetches - f0, "fetches started over the 12 ticks").toBe(path === "away" ? 12 : 1);
        expect(entities(engine, view), "board entities after 12 ticks").toBeGreaterThan(0);
        const h = await hud();
        expect(h.demo, `HUD "· demo" cue after 12 ticks ("${h.row}")`).toBe(true);
        expect(h.pps, `HUD rate after 12 ticks ("${h.row}")`).toBeGreaterThan(0);
        expect(labelShown(), "demo label after 12 ticks").toBe(true);
        expect(badge(), "demo label text after 12 ticks").toBe(DEMO_DATA_LABEL);
        // the server is back with live packets: live takes over on that tick
        liveK = 5;
        mode = "live";
        if (path === "hold") {
          expect(held.length, "the one hung fetch").toBe(1);
          const f = fetches;
          held.forEach((res) => res(json(liveBody("")))); held = [];
          await vi.advanceTimersByTimeAsync(0);
          expect(fetches, "the hung fetch's answer starts no fetch").toBe(f);
        } else {
          await poll();
        }
        expect(labelShown(), "demo label on the live answer's tick").toBe(false);
        const l = await hud();
        expect(l.demo, `HUD after the live answer: no demo cue ("${l.row}")`).toBe(false);
        expect(rate(), "live rate: 5 packets in one poll from a 0 start").toBeCloseTo(2, 9);
      });
    }

    // #202 (#199 follow-up): the same top-of-tick demo step on the HTTP-error answer. A `!r.ok` reply must skip the
    // poll's own empty step while the demo is playing (it already stepped), or each tick plays two demo batches.
    it(`${engine}: demo already playing, then the server answers with an HTTP error (404) — exactly 1 demo batch on each of 12 ticks, board never empty, "· demo" and "Demo data" stay (#202)`, async () => {
      const { view, poll, hud, labelShown, badge, demoCalls } = mount(engine, cleanHomeState());
      // reach the demo the natural way: the poll at start and 2 quiet (empty) polls
      await vi.advanceTimersByTimeAsync(0);
      await poll();
      await poll();
      expect(labelShown(), "demo playing before the server starts answering with an error").toBe(true);
      const f0 = fetches;
      mode = "error";
      const perTick: number[] = [], board: number[] = [], shown: boolean[] = [];
      for (let i = 1; i <= 12; i++) {
        const d = demoCalls();
        await poll(); // one tick: one fetch, answered 404
        perTick.push(demoCalls() - d);
        board.push(entities(engine, view));
        shown.push(labelShown());
      }
      expect(fetches - f0, "fetches over the 12 ticks (each answered 404)").toBe(12);
      expect(perTick, `demo batches per tick with the server answering 404 (per tick: ${perTick.join(", ")})`).toEqual(Array(12).fill(1));
      expect(board.filter((n) => n === 0).length, `ticks with an empty board (entities per tick: ${board.join(", ")})`).toBe(0);
      expect(shown.every(Boolean), `demo label on every tick (${shown.join(", ")})`).toBe(true);
      const h = await hud();
      expect(h.demo, `HUD "· demo" cue after 12 ticks ("${h.row}")`).toBe(true);
      expect(h.pps, `HUD rate after 12 ticks ("${h.row}")`).toBeGreaterThan(0);
      expect(labelShown(), "demo label after 12 ticks").toBe(true);
      expect(badge(), "demo label text after 12 ticks").toBe(DEMO_DATA_LABEL);
    });

    it(`${engine}: view stop — the feed panel drops the demo status with the view (#182)`, async () => {
      const { view, poll, feedStatus, badge, labelShown } = mount(engine, cleanHomeState());
      await poll();
      expect(labelShown(), "label shown while the demo runs").toBe(true);
      expect(feedStatus(), "feed status while the demo runs").toBe(badge());
      view.stop();
      expect(feedStatus(), "feed status after the view stopped").toBe("");
    });

    it(`${engine}: (c) takeover — 0 feed calls while live traffic arrives; back only on the 3rd empty poll in a row`, async () => {
      const { demoCalls, labelShown, poll, ingest } = mount(engine, cleanHomeState());
      await poll();
      expect(demoCalls(), "demo before live").toBeGreaterThan(0);
      liveK = 5; // 4.352 pkt/s after 4 live polls: the reading stays >= 1 through the held stretch below (#199)
      mode = "live";
      const before = demoCalls(), calls0 = ingest.mock.calls.length;
      // #199: the demo never waits on the fetch, so the first live poll's tick still plays its demo batch before the
      // live answer lands; that answer takes over on the same tick (the batch leaves with the board). None after.
      await poll();
      expect(demoCalls() - before, "feed calls on the first live poll (its tick, before the answer)").toBe(1);
      expect(labelShown(), "label after the first live poll").toBe(false);
      for (let i = 0; i < 3; i++) await poll();
      expect(demoCalls() - before, "feed calls during 4 live polls").toBe(1);
      expect(ingest.mock.calls.length - calls0, "ingest calls during 4 live polls (4 live + that 1 demo batch)").toBe(5);
      mode = "empty";
      const off = demoCalls();
      await poll();
      expect(demoCalls() - off, "feed calls after 1 empty poll").toBe(0);
      expect(labelShown(), "label after 1 empty poll").toBe(false);
      await poll();
      expect(demoCalls() - off, "feed calls after 2 empty polls").toBe(0);
      // time alone does not bring it back: a stretch with the poll held produces nothing while the reading is >= 1
      // (#199: once a no-answer tick finds it at 0, the demo takes the board on that tick; see the hung-fetch rows)
      mode = "hold";
      await vi.advanceTimersByTimeAsync(3000);
      expect(demoCalls() - off, "feed calls after 3 ticks with no poll result").toBe(0);
      held.forEach((res) => res(json({ ip: "", packets: [] }))); held = [];
      await vi.advanceTimersByTimeAsync(0);
      expect(demoCalls() - off, "feed calls after the 3rd empty poll in a row").toBe(1);
      expect(labelShown(), "label after the 3rd empty poll").toBe(true);
    });

    it(`${engine}: (b) fixed pace — feed ingest calls stay at or below one per empty poll over 60 frames`, async () => {
      const step = vi.spyOn(protoOf(engine), "step");
      const { demoCalls } = mount(engine, cleanHomeState());
      const f0 = fetches;
      for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(17);
      const frames = step.mock.calls.length, polls = fetches - f0 + 1; // + the poll at start
      expect(frames, "frames stepped").toBeGreaterThanOrEqual(60);
      expect(demoCalls(), "the feed ran").toBeGreaterThan(0);
      expect(demoCalls(), `feed ingest calls over ${frames} frames and ${polls} polls`).toBeLessThanOrEqual(polls);
    });

    it(`${engine}: (a) stillness — over one full poll interval (tick included) exactly one feed call, the top-of-tick demo step, and zero extra renders while the demo state holds still`, async () => {
      const step = vi.spyOn(protoOf(engine), "step");
      const render = vi.spyOn(protoOf(engine), engine === "netpong" ? "drawHud" : "draw");
      const { view, demoCalls } = mount(engine, cleanHomeState());
      await vi.advanceTimersByTimeAsync(1000);
      expect(entities(engine, view), "demo board up").toBeGreaterThan(0);
      mode = "hold"; // no poll result lands: the demo state holds still
      const d0 = demoCalls(), s0 = step.mock.calls.length, r0 = render.mock.calls.length, f0 = fetches;
      // one full poll interval, from just after a tick up to and including the next tick (1000 ms, the boundary in):
      // frame by frame, 17 ms at a time, the last advance landing exactly on the tick. #199: a playing demo makes its
      // own batch at the top of every tick, before (and whatever) the fetch does, so exactly that one step lands in the
      // window, on the tick that starts the fetch that then hangs. Nothing in between.
      const perAdvance: number[] = [];
      for (let t = 0; t < 1000; t += 17) {
        const d = demoCalls();
        await vi.advanceTimersByTimeAsync(Math.min(17, 1000 - t));
        perAdvance.push(demoCalls() - d);
      }
      const frames = step.mock.calls.length - s0, renders = render.mock.calls.length - r0;
      const at = perAdvance.flatMap((n, i) => (n ? [`${n} by ${Math.min(1000, (i + 1) * 17)} ms`] : []));
      expect(fetches - f0, "fetches in the window (the tick at its end starts the one that hangs)").toBe(1);
      expect(frames, "frames in the still stretch").toBeGreaterThanOrEqual(55);
      expect(demoCalls() - d0, `feed calls in one full interval, tick included (${at.join(", ") || "none"})`).toBe(1);
      expect(perAdvance[perAdvance.length - 1], "the one feed call is the tick's top-of-tick demo step").toBe(1);
      expect(renders, "renders while still (one per frame, no extra)").toBe(frames);
    });

    it(`${engine}: dispose — after the view stops, an in-flight poll makes 0 more ingest calls`, async () => {
      const { view, ingest, demoCalls } = mount(engine, cleanHomeState());
      await vi.advanceTimersByTimeAsync(1000);
      expect(demoCalls(), "demo before stop").toBeGreaterThan(0);
      mode = "hold";
      await vi.advanceTimersByTimeAsync(1000);
      expect(held.length, "a poll in flight").toBe(1);
      const n = ingest.mock.calls.length;
      view.stop();
      held.forEach((res) => res(json({ ip: "", packets: [] }))); held = [];
      await vi.advanceTimersByTimeAsync(5000);
      expect(ingest.mock.calls.length - n, "ingest calls after stop").toBe(0);
    });

    it(`${engine}: hosts — every host on the board and in the shaped rows is in IDLE_VIZ_DEMO_HOSTS`, async () => {
      const { view, allRows, demoCalls } = mount(engine, cleanHomeState());
      for (let s = 0; s < 6; s++) await vi.advanceTimersByTimeAsync(1000);
      const list = new Set((IDLE_VIZ_DEMO_HOSTS ?? []).map((h) => h.ip));
      const allowed = allowedFor(engine, view); // the demo list plus the picked device (netpong's default pick: the gateway)
      const rowHosts = allRows().flatMap((p) => [p[2], p[9]].filter((x): x is string => !!x));
      const onBoard = boardHosts(engine, view);
      expect(demoCalls(), "the feed ran").toBeGreaterThan(0);
      expect(onBoard.length, "hosts on the board").toBeGreaterThan(0);
      expect(allowed.size - list.size, "exceptions besides the demo list (the pick only)").toBeLessThanOrEqual(1);
      expect([...new Set(rowHosts)].filter((h) => !list.has(h)), "row hosts off the demo list (rows never carry the pick)").toEqual([]);
      expect([...new Set(onBoard)].filter((h) => !allowed.has(h)), "board hosts off the demo list + pick").toEqual([]);
    });

    it(`${engine}: resume — after live traffic from ${OFF_HOST} and 3 empty polls, every board host is in IDLE_VIZ_DEMO_HOSTS (+ the pick)`, async () => {
      livePeer = OFF_HOST;
      const { view, poll, labelShown } = mount(engine, cleanHomeWithOffHost());
      await poll();
      mode = "live";
      await poll();
      expect(boardHosts(engine, view), "the live host is on the board").toContain(OFF_HOST);
      mode = "empty";
      await poll(); await poll(); await poll();
      expect(labelShown(), "demo back on the 3rd empty poll").toBe(true);
      const allowed = allowedFor(engine, view);
      expect([...new Set(boardHosts(engine, view))].filter((h) => !allowed.has(h)), "board hosts off the demo list + pick under the demo label").toEqual([]);
    });

    it(`${engine}: restart — a view restarted with no live cursor shows the demo on its first empty poll (no "waiting for packets…")`, async () => {
      const { view, poll, demoCalls, labelShown } = mount(engine, cleanHomeState());
      await poll();
      mode = "live";
      await poll(); // the feed is off now
      view.stop();
      mode = "empty";
      // a new pick while stopped starts the board over: the live cursor is 0 again
      const v = view as unknown as { picker?: { set(x: string): void }; chooseSource?: (x: string) => void };
      if (v.picker) v.picker.set("self"); else v.chooseSource!("self");
      const d0 = demoCalls();
      rec.texts.length = 0;
      view.start(null);
      await vi.advanceTimersByTimeAsync(500); // the poll at start, and some frames; no interval poll yet
      expect(demoCalls() - d0, "feed calls on the first empty poll after restart").toBe(1);
      expect(labelShown(), "label after the first empty poll").toBe(true);
      expect(rec.texts.filter((t) => t === WAIT_TEXT).length, `"${WAIT_TEXT}" draws after restart`).toBe(0);
    });

    it(`${engine}: badge — only an explicit pick changes it ("Demo traffic around <name>", or "…the selected device" with no name, never an address); no explicit pick${engine === "netpong" ? " (the default gateway source)" : ""} reads exactly "Demo data"`, async () => {
      const ADDRESS = /\b\d{1,3}(?:\.\d{1,3}){3}\b|[0-9a-f]{0,4}:[0-9a-f]{0,4}:[0-9a-f:]*/i;
      const run = async (stored: string | null, msg: StateMsg) => {
        localStorage.clear();
        if (stored !== null) localStorage.setItem(PICK_KEY[engine], stored);
        const v = mount(engine, msg);
        await v.poll(); await v.poll(); await v.poll();
        expect(v.labelShown(), `badge shown (stored pick ${stored})`).toBe(true);
        const allowed = allowedFor(engine, v.view);
        const onBoard = boardHosts(engine, v.view);
        expect(onBoard.length, "hosts on the board").toBeGreaterThan(0);
        expect([...new Set(onBoard)].filter((h) => !allowed.has(h)), "board hosts off the demo list + pick").toEqual([]);
        return v;
      };

      const def = await run(null, cleanHomeState());
      expect(pickedOf(engine, def.view), "default pick").toEqual(engine === "netpong" ? ["192.168.1.1"] : []);
      expect(def.badge(), "no explicit pick").toBe(DEMO_DATA_LABEL);
      def.view.stop();

      const group = await run(engine === "netpong" ? "any" : "lan", cleanHomeState());
      expect(pickedOf(engine, group.view), "explicit group pick").toEqual([]);
      expect(group.badge(), "explicit group pick").toBe(DEMO_DATA_LABEL);
      group.view.stop();

      const named = await run("self", cleanHomeState());
      expect(pickedOf(engine, named.view), "named pick").toEqual(["192.168.1.50"]);
      expect(named.badge(), "explicit pick with a name").toBe("Demo traffic around box");
      named.view.stop();

      const nameless = await run(NAMELESS_IP, cleanHomeWithNameless());
      expect(pickedOf(engine, nameless.view), "nameless pick").toEqual([NAMELESS_IP]);
      expect(nameless.badge(), "explicit pick with no name").toBe("Demo traffic around the selected device");
      expect(nameless.badge(), "no address in the badge").not.toMatch(ADDRESS);
    });
  }
});
