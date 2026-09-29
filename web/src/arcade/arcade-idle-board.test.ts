/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import type { Packet, StateMsg } from "../core/types";
import { DEMO_DATA_LABEL, DEMO_LABEL_CLASS } from "../core/demo-source";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { IDLE_VIZ_DEMO_HOSTS } from "../plugins/fixtures/idle-viz-frame";
import { FroggerView } from "./frogger";
import { InvadersView } from "./invaders";
import { PongView } from "./pong";

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

/** Every host the board holds as an entity (not the view's own single-device pick). */
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
  return [...v.sources.rows.keys(), ...[...v.lanes.rows.values()].filter((l) => l.owner !== "source").map((l) => l.host)];
}

type FetchMode = "empty" | "live" | "hold";

describe("#181 arcade views show a board with no LAN traffic (clean HOME)", () => {
  let rec: Recorder;
  let fetches = 0;
  let mode: FetchMode = "empty";
  let held: ((r: Response) => void)[] = [];
  let liveSeq = 0;

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  /** one real packet per poll, newer each time (a device on the LAN talking to a web host) */
  const liveBody = (ip: string) => {
    liveSeq++;
    const t = Date.now() / 1000;
    const p: Packet = [t, "out", "93.184.216.34", "TCP", "tcp/443", 74, "eth0", "[SYN] Seq=0", `${50000 + liveSeq}→443`, "192.168.1.50"];
    return { ip, peer: null, ts: t, packets: [p], window: null, summary: { protos: [], ports: [], queries: [], sni: [], peers: [] } };
  };

  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(rec.ctx as never);
    fetches = 0; mode = "empty"; held = []; liveSeq = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetches++;
      const ip = new URL(url, "http://x").searchParams.get("ip") ?? "";
      if (mode === "hold") return new Promise<Response>((res) => held.push(res));
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
    const ingest = vi.spyOn(protoOf(engine), "ingest");
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
    const labelShown = () => { const l = label(); return !!l && l.classList.contains("is-visible") && l.textContent === DEMO_DATA_LABEL; };
    /** advance exactly one poll interval (one /api/traffic fetch) */
    const poll = async () => { const f = fetches; await vi.advanceTimersByTimeAsync(1000); expect(fetches, "one poll per interval").toBe(f + 1); };
    return { el, view, ingest, demoCalls, allRows, labelShown, poll };
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
    it(`${engine}: UX — while the feed runs "waiting for packets…" is never drawn and the demo label is shown`, async () => {
      const { labelShown, demoCalls } = mount(engine, cleanHomeState());
      let labelFrames = 0;
      for (let s = 0; s < 5; s++) { await vi.advanceTimersByTimeAsync(1000); if (labelShown()) labelFrames++; }
      const waits = rec.texts.filter((t) => t === WAIT_TEXT).length;
      expect(demoCalls(), "the feed ran").toBeGreaterThan(0);
      expect(waits, `"${WAIT_TEXT}" draws over 5 s of demo frames`).toBe(0);
      expect(labelFrames, "demo label shown at each of 5 polls").toBe(5);
    });

    it(`${engine}: UX — after the first real non-empty poll the demo label is gone within one poll`, async () => {
      const { labelShown, poll } = mount(engine, cleanHomeState());
      await poll(); await poll();
      expect(labelShown(), "label shown while the demo runs").toBe(true);
      mode = "live";
      await poll();
      expect(labelShown(), "label after one live poll").toBe(false);
    });

    it(`${engine}: (c) takeover — 0 feed calls while live traffic arrives; back only on the 3rd empty poll in a row`, async () => {
      const { demoCalls, labelShown, poll, ingest } = mount(engine, cleanHomeState());
      await poll();
      expect(demoCalls(), "demo before live").toBeGreaterThan(0);
      mode = "live";
      const before = demoCalls(), calls0 = ingest.mock.calls.length;
      for (let i = 0; i < 4; i++) await poll();
      expect(demoCalls() - before, "feed calls during 4 live polls").toBe(0);
      expect(ingest.mock.calls.length - calls0, "ingest calls during 4 live polls (live only)").toBe(4);
      mode = "empty";
      const off = demoCalls();
      await poll();
      expect(demoCalls() - off, "feed calls after 1 empty poll").toBe(0);
      expect(labelShown(), "label after 1 empty poll").toBe(false);
      await poll();
      expect(demoCalls() - off, "feed calls after 2 empty polls").toBe(0);
      // time alone does not bring it back: a long stretch with the poll held produces nothing
      mode = "hold";
      await vi.advanceTimersByTimeAsync(5000);
      expect(demoCalls() - off, "feed calls after 5 s with no poll result").toBe(0);
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

    it(`${engine}: (a) stillness — zero feed calls and zero extra renders while the demo state holds still`, async () => {
      const step = vi.spyOn(protoOf(engine), "step");
      const render = vi.spyOn(protoOf(engine), engine === "netpong" ? "drawHud" : "draw");
      const { view, demoCalls } = mount(engine, cleanHomeState());
      await vi.advanceTimersByTimeAsync(1000);
      expect(entities(engine, view), "demo board up").toBeGreaterThan(0);
      mode = "hold"; // no poll result lands: the demo state holds still
      await vi.advanceTimersByTimeAsync(1000);
      const d0 = demoCalls(), s0 = step.mock.calls.length, r0 = render.mock.calls.length;
      for (let i = 0; i < 60; i++) await vi.advanceTimersByTimeAsync(17);
      const frames = step.mock.calls.length - s0, renders = render.mock.calls.length - r0;
      expect(frames, "frames in the still stretch").toBeGreaterThanOrEqual(60);
      expect(demoCalls() - d0, "feed calls while still").toBe(0);
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
      const rowHosts = allRows().flatMap((p) => [p[2], p[9]].filter((x): x is string => !!x));
      const onBoard = boardHosts(engine, view);
      expect(demoCalls(), "the feed ran").toBeGreaterThan(0);
      expect(onBoard.length, "hosts on the board").toBeGreaterThan(0);
      expect([...new Set(rowHosts)].filter((h) => !list.has(h)), "row hosts off the demo list").toEqual([]);
      expect([...new Set(onBoard)].filter((h) => !list.has(h)), "board hosts off the demo list").toEqual([]);
    });
  }
});
