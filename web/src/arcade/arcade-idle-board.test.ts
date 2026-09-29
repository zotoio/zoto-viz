/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetScene } from "../graph/scene";
import type { StateMsg } from "../core/types";
import { goldenLanFixture } from "../plugins/fixtures/golden-lan-state";
import { FroggerView } from "./frogger";
import { InvadersView } from "./invaders";
import { PongView } from "./pong";

/**
 * #181: on a clean HOME with no LAN traffic, frogger / netpong / invaders must still show a
 * board (the standing rule: every pack ships demo data; an empty board is a Fail). jsdom-style
 * (happy-dom), no GPU: the golden LAN snapshot arrives over update(StateMsg) like the live
 * websocket, /api/traffic answers with no packets (no capture on the box), and the view runs
 * 10 s of frames. Observable: the engine's on-screen entities (frogs / paddle balls / invader
 * rows, the things draw() paints) and the canvas text of the last frame.
 */

const WAIT_TEXT = "waiting for packets…";

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

type Engine = "frogger" | "netpong" | "invaders";

function entities(engine: Engine, view: unknown): number {
  const v = view as { frogs?: unknown[]; balls?: unknown[]; rows?: Map<string, unknown> };
  if (engine === "frogger") return v.frogs!.length;
  if (engine === "netpong") return v.balls!.length;
  return v.rows!.size;
}

describe("#181 arcade views show a board with no LAN traffic (clean HOME)", () => {
  let rec: Recorder;
  let fetches = 0;

  beforeEach(() => {
    expect.hasAssertions();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    rec = recordingCtx();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(rec.ctx as never);
    fetches = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetches++;
      const ip = new URL(url, "http://x").searchParams.get("ip") ?? "";
      return new Response(JSON.stringify({ ip, packets: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  async function runEngine(engine: Engine) {
    const msg = goldenLanFixture();
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 960 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 640 });
    document.body.append(el);
    const scene = sceneFor(msg);
    const view = engine === "frogger" ? new FroggerView(el, scene) : engine === "invaders" ? new InvadersView(el, scene) : new PongView(el, scene);
    view.update(msg);
    view.start(null);
    view.update(msg);
    for (let s = 0; s < 10; s++) await vi.advanceTimersByTimeAsync(1000);
    rec.texts.length = 0;
    await vi.advanceTimersByTimeAsync(40);
    const lastFrame = [...rec.texts];
    const n = entities(engine, view);
    view.stop();
    return { n, lastFrame, why: `${engine}: ${n} on-screen entities after 10 s, ${fetches} empty /api/traffic polls; last frame text: ${JSON.stringify(lastFrame.filter((t) => /waiting|no |demo/i.test(t)))}` };
  }

  for (const engine of ["frogger", "netpong", "invaders"] as const) {
    it(`${engine}: non-empty board after 10 s with no live traffic`, async () => {
      const r = await runEngine(engine);
      expect(r.lastFrame.length, `drew a frame: ${r.why}`).toBeGreaterThan(0);
      expect(r.lastFrame, r.why).not.toContain(WAIT_TEXT);
      expect(r.n, r.why).toBeGreaterThan(0);
    });
  }
});
