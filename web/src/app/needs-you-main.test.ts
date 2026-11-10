/**
 * Needs you through the real main host (no modal, no silent fallback):
 * - both grant orders start the view in place (no reload) for Fractal Zoom and Source web;
 * - the solo tile and its notice carry one data-view-state / data-view-id;
 * - Pedant's row: every shipped consent pack, auto-consent off, runs no pack code before the OK.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { PluginView } from "../plugins/plugin";
import * as pluginModule from "../plugins/plugin";
import { countPluginSandboxIframes } from "../plugins/host";
import { defaultVizContract } from "../plugins/viz-host";
import { clearModeSwitchStatus, initModeSwitchStatusStrip, isModeSwitchStatusVisible } from "./mode-switch-message";
import { resetModeSwitchStateForTests, setLastConsentedModeId } from "./mode-switch-state";
import { resetPackConsentForTests } from "./pack-consent";
import { resetNeedsYouForTests } from "./needs-you";
import { resetViewStatesForTests } from "./view-state";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(webRoot, "..");

function mountShell(): void {
  document.body.innerHTML = `
    <div id="wall"><div id="scene"></div>
      <div id="pong" class="arcade" hidden></div><div id="invaders" class="arcade" hidden></div>
      <div id="command" class="arcade" hidden></div><div id="frogger" class="arcade" hidden></div>
      <div id="cpupong" class="arcade" hidden></div><div id="doom" class="arcade" hidden></div>
      <div id="waves" class="arcade" hidden></div><div id="orbits" class="arcade" hidden></div>
      <div id="helix" class="arcade" hidden></div><div id="skyline" class="arcade" hidden></div>
      <div id="pacman" class="arcade" hidden></div><div id="tetris" class="arcade" hidden></div>
      <div id="portal" class="arcade" hidden></div><div id="carousel" class="arcade" hidden></div>
    </div>
    <header id="bar">
      <div class="row top">
        <span id="conn" class="dot"></span><strong class="brand">zoto-viz</strong><span id="net"></span>
        <span id="pps">0</span><span id="bps">0</span><span id="lanDevs">0</span><span id="lanOnline">0</span>
        <span id="netSvcs">0</span><span id="netOnline">0</span><span id="flows">0</span><span id="active">0</span>
      </div>
      <div class="row controls">
        <span id="modeBox"></span><span id="modeOpts"></span><span id="dreamBox"></span><span id="feedBox"></span>
        <span id="chatBox"></span><span id="debugBox"></span><span id="labelsBox"></span><span id="overlaysBox"></span>
        <span id="cameraBox"></span><span id="micBox"></span><span id="soundBox"></span><span id="diceBox"></span>
        <span id="aiBox"></span><div id="quick" hidden></div><span id="settingsBox"></span>
      </div>
    </header>
    <aside id="panel" hidden></aside><div id="livefeed" hidden></div><div id="livechat" hidden></div>
    <aside id="debuglog" hidden></aside><div id="foot"><div id="hint"></div><div id="legend"></div></div>`;
}

type Recorded = { url: string; method: string };

/** Pack code or pack content on the wire: module, sky, assets, the sandbox frame and its token. */
function packTraffic(calls: Recorded[], packId?: string): Recorded[] {
  return calls.filter((c) => {
    if (/\/consent(\?|$)/.test(c.url)) return false;
    if (c.url.includes("/api/pack-assets")) return true;
    if (c.url.includes("/pack-assets/")) return true;
    if (packId) return c.url.includes(`/api/plugins/${packId}/`) || c.url.includes(`/plugins/${packId}/`);
    return /\/api\/plugins\/[^/?]+\//.test(c.url);
  });
}

let calls: Recorded[] = [];
let sockets = 0;
let eventSources = 0;
/** What GET /api/plugins answers (a catalog refresh); null = the setup stub's empty catalog. */
let catalogReply: (() => Promise<unknown>) | null = null;

function installNetworkRecorder(): void {
  const base = globalThis.fetch;
  calls = [];
  sockets = 0;
  eventSources = 0;
  vi.stubGlobal("WebSocket", class { constructor() { sockets += 1; } close() {} });
  vi.stubGlobal("EventSource", class { constructor() { eventSources += 1; } close() {} });
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const path0 = url.split("?")[0] ?? url;
    const json = (body: unknown) => new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": "test-csrf" },
    });
    if (method === "PUT" && /\/api\/plugins\/[^/]+\/consent$/.test(path0)) return json({ ok: true, needed: true });
    if (path0 === "/api/plugins" && catalogReply) return json(await catalogReply());
    return base(input, init);
  }) as typeof fetch);
}

function sceneEl(): HTMLElement {
  return document.getElementById("scene")!;
}

function sceneNotice(): HTMLElement | null {
  return sceneEl().querySelector<HTMLElement>(":scope > .mosaic-pane-notice");
}

function pickerLabel(viewId: string): string {
  const li = document.querySelector<HTMLElement>(`#modeBox li[role="option"][data-value="${viewId}"] .txt`);
  return li?.textContent ?? "";
}

async function pressReviewThenOk(kind: "I examined the source" | "I wrote this" = "I examined the source"): Promise<void> {
  await vi.waitFor(() => {
    expect(sceneNotice()?.querySelector<HTMLButtonElement>("button[data-action=review]")).toBeTruthy();
  });
  sceneNotice()!.querySelector<HTMLButtonElement>("button[data-action=review]")!.click();
  const ok = [...sceneEl().querySelectorAll<HTMLButtonElement>(".pack-review button")].find((b) => b.textContent === kind);
  expect(ok, "review panel opens inside the tile").toBeTruthy();
  ok!.click();
}

function fractalZoom(over: Partial<PluginView> = {}): PluginView {
  return {
    id: "fractal-zoom",
    name: "Fractal Zoom",
    version: 1,
    engine: "graph",
    base: "topology",
    origin: "src",
    capabilities: ["viz.read", "viz.write", "config.read"],
    runtime: "typescript",
    has_frontend: true,
    has_sky_shader: true,
    shader_sha256: "fz-sky-sha",
    hash: "fz-module-hash",
    consent: null,
    consent_state: "none",
    look: { stageOnly: true, backdrop: "plugin" },
    viz: defaultVizContract({ presentTick: true }),
    ...over,
  };
}

/** Source web as a web evaluator that still asks for it sees it (datasource, no frontend). */
function sourceWeb(over: Partial<PluginView> = {}): PluginView {
  return {
    id: "source-web",
    name: "Source web",
    version: 1,
    engine: "graph",
    base: "topology",
    origin: "src",
    capabilities: ["graph.read"],
    has_datasource: true,
    consent: null,
    consent_state: "none",
    ...over,
  };
}

async function mainHost() {
  const main = await import("./main");
  const testHost = await import("./apply-mode-test-host");
  return { ...main, ...testHost };
}

let attachSpy: MockInstance<typeof pluginModule.attachPluginFrontend>;
let skySpy: MockInstance<typeof pluginModule.fetchPluginSky>;

describe("Needs you via the main host", { timeout: 60_000 }, () => {
  beforeEach(() => {
    mountShell();
    initModeSwitchStatusStrip();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "zoto-viz.mode" ? "topology" : null), // auto-consent off
      setItem: () => {},
      removeItem: () => {},
    });
    installNetworkRecorder();
    catalogReply = null;
  });

  afterEach(async () => {
    const { resetApplyModeTestOverrides } = await import("./apply-mode-test-host");
    resetApplyModeTestOverrides();
    clearModeSwitchStatus();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    resetNeedsYouForTests();
    resetViewStatesForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function spyPackStart(): void {
    // The pack's own start: its module in the sandbox and its sky. Stubbed so the row sees the
    // host start the view (happy-dom has no sandbox frame or GL).
    attachSpy = vi.spyOn(pluginModule, "attachPluginFrontend").mockResolvedValue(true);
    skySpy = vi.spyOn(pluginModule, "fetchPluginSky").mockResolvedValue(
      "#version 300 es\nprecision highp float;out vec4 o;uniform float uTime,uOpacity,uBright;void main(){o=vec4(0.2);}",
    );
  }

  function attachedFor(id: string): number {
    return attachSpy.mock.calls.filter((c) => (c[1] as PluginView | null)?.id === id).length;
  }

  function skyFor(id: string): number {
    return skySpy.mock.calls.filter((c) => c[0] === id).length;
  }

  async function pickNeedsYou(spec: PluginView): Promise<Awaited<ReturnType<typeof mainHost>>> {
    const h = await mainHost();
    h.configureApplyModeForTests({ liveMode: "topology", lastConsentedMode: "topology", pluginSpecs: [spec] });
    setLastConsentedModeId("topology");
    h.applyMode(`plugin:${spec.id}`);
    await vi.waitFor(() => { expect(sceneEl().dataset.viewState).toBe("needs-you"); });
    return h;
  }

  function expectStartedInPlace(h: Awaited<ReturnType<typeof mainHost>>, spec: PluginView): void {
    const id = `plugin:${spec.id}`;
    const host = h.getApplyModeHostForTests();
    expect(host.modeSel.value, "picker names the pick").toBe(id);
    expect(host.getLiveMode(), "live mode is the pick, not the previous view").toBe(id);
    expect(sceneEl().dataset.viewId).toBe(id);
    expect(["starting", "ready"]).toContain(sceneEl().dataset.viewState);
    expect(sceneNotice(), "no Needs you / Couldn't start notice left").toBeNull();
    expect(document.querySelector(".modal.ask"), "no modal").toBeNull();
    expect(isModeSwitchStatusVisible(), "no Kept / Couldn't load strip").toBe(false);
    expect(pickerLabel(id)).not.toMatch(/needs OK/);
    if (spec.has_frontend) expect(attachedFor(spec.id), "pack module started once").toBe(1);
    if (spec.has_sky_shader) expect(skyFor(spec.id), "its own sky requested").toBeGreaterThanOrEqual(1);
  }

  for (const make of [fractalZoom, sourceWeb]) {
    const spec0 = make();
    it(`grant order A: ${spec0.name} — OK on the tile before the catalog refresh lands starts it in place; the stale refresh does not bring Needs you back`, async () => {
      spyPackStart();
      const h = await pickNeedsYou(make());
      const id = `plugin:${spec0.id}`;
      expect(pickerLabel(id)).toMatch(/needs OK$/);
      expect(attachedFor(spec0.id)).toBe(0);
      // A refresh requested before the OK, answering with the pre-OK row, is still in flight.
      let land!: () => void;
      const gate = new Promise<void>((r) => { land = r; });
      catalogReply = async () => { await gate; return { plugins: [make()], errors: [], blocked: [] }; };
      const refresh = h.refreshCatalogForTests();
      await pressReviewThenOk();
      await vi.waitFor(() => { expect(["starting", "ready"]).toContain(sceneEl().dataset.viewState); });
      await vi.waitFor(() => { expectStartedInPlace(h, spec0); });
      land();
      await refresh;
      await new Promise((r) => setTimeout(r, 50));
      expectStartedInPlace(h, spec0);
    });

    it(`grant order B: ${spec0.name} — OK on the tile after the catalog refresh landed starts it in place, no reload`, async () => {
      spyPackStart();
      const h = await pickNeedsYou(make());
      catalogReply = async () => ({ plugins: [make()], errors: [], blocked: [] });
      await h.refreshCatalogForTests();
      expect(sceneEl().dataset.viewState, "still Needs you after the refresh").toBe("needs-you");
      expect(h.getApplyModeHostForTests().modeSel.value).toBe(`plugin:${spec0.id}`);
      expect(attachedFor(spec0.id)).toBe(0);
      await pressReviewThenOk("I wrote this");
      await vi.waitFor(() => { expectStartedInPlace(h, spec0); });
    });
  }

  it("no silent fallback: Fractal Zoom's code fails to load after the OK — Couldn't start on the pick with Retry, never the previous view", async () => {
    spyPackStart();
    attachSpy.mockRejectedValue(new Error("module.js 403 consent required"));
    const h = await pickNeedsYou(fractalZoom());
    await pressReviewThenOk();
    await vi.waitFor(() => { expect(sceneEl().dataset.viewState).toBe("couldnt-start"); });
    await new Promise((r) => setTimeout(r, 50));
    expect(sceneEl().dataset.viewState, "a late sky landing does not paper over it").toBe("couldnt-start");
    const host = h.getApplyModeHostForTests();
    expect(host.modeSel.value, "picker keeps the pick").toBe("plugin:fractal-zoom");
    expect(host.getLiveMode(), "live mode keeps the pick").toBe("plugin:fractal-zoom");
    expect(sceneEl().dataset.viewId).toBe("plugin:fractal-zoom");
    expect(isModeSwitchStatusVisible(), "no Kept / Couldn't load strip").toBe(false);
    const notice = sceneNotice();
    expect(notice?.textContent ?? "").toMatch(/couldn't start/i);
    expect(notice?.querySelector("button[data-action=retry]")?.textContent).toBe("Retry");
  });

  it("Source web with the catalog's consent_state granted: straight to the view, no Needs you", async () => {
    spyPackStart();
    const h = await mainHost();
    h.configureApplyModeForTests({ liveMode: "topology", lastConsentedMode: "topology", pluginSpecs: [sourceWeb({ consent_state: "granted" })] });
    h.applyMode("plugin:source-web");
    await vi.waitFor(() => { expect(sceneEl().dataset.viewState).toBe("ready"); });
    expect(sceneNotice()).toBeNull();
    expect(pickerLabel("plugin:source-web")).toBe(pickerLabel("plugin:source-web").replace(/ · needs OK$/, ""));
  });

  it("solo data-view-state / data-view-id: #scene and its notice agree (Needs you → starting / ready)", async () => {
    spyPackStart();
    const h = await pickNeedsYou(fractalZoom());
    const notice = sceneNotice()!;
    expect(sceneEl().dataset.viewId).toBe("plugin:fractal-zoom");
    expect(notice.dataset.viewState).toBe("needs-you");
    expect(notice.dataset.viewId).toBe("plugin:fractal-zoom");
    expect(notice.textContent).toContain("Fractal Zoom needs your OK to run.");
    await pressReviewThenOk();
    await vi.waitFor(() => { expect(["starting", "ready"]).toContain(sceneEl().dataset.viewState); });
    const states = [...document.querySelectorAll<HTMLElement>("[data-view-state]")]
      .filter((e) => e === sceneEl() || sceneEl().contains(e))
      .map((e) => `${e.dataset.viewId}=${e.dataset.viewState}`);
    expect(new Set(states).size, `surfaces agree: ${states.join(", ")}`).toBe(1);
    expect(h.getApplyModeHostForTests().modeSel.value).toBe("plugin:fractal-zoom");
  });
});

/** Shipped packs that ship pack code a picker pick could run: `sky/fragment.glsl` (30 today: #180 gave sandbox-fixture-multi a sky; it still needs consent though it is `picker: hidden`). */
function shippedConsentPacks(): PluginView[] {
  const src = path.join(repoRoot, "plugins/src");
  const out: PluginView[] = [];
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const home = path.join(src, dir.name);
    const yml = path.join(home, "plugin.yml");
    if (!existsSync(yml) || !existsSync(path.join(home, "sky", "fragment.glsl"))) continue;
    const text = readFileSync(yml, "utf8");
    const id = text.match(/^id:\s*(\S+)/m)?.[1] ?? dir.name;
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? id;
    out.push({
      id,
      name,
      version: 1,
      engine: "graph",
      base: "topology",
      origin: "src",
      capabilities: ["viz.read", "viz.write"],
      has_frontend: existsSync(path.join(home, "frontend")) || /^frontend:/m.test(text),
      has_sky_shader: true,
      shader_sha256: `${id}-sky`,
      hash: `${id}-module`,
      consent: null,
      consent_state: "none",
      look: { backdrop: "plugin" },
      viz: defaultVizContract({ presentTick: true }),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

describe("Pedant: no pack code runs before the OK", { timeout: 120_000 }, () => {
  beforeEach(() => {
    mountShell();
    initModeSwitchStatusStrip();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k === "zoto-viz.mode" ? "topology" : null), // auto-consent off
      setItem: () => {},
      removeItem: () => {},
    });
    installNetworkRecorder();
  });

  afterEach(async () => {
    const { resetApplyModeTestOverrides } = await import("./apply-mode-test-host");
    resetApplyModeTestOverrides();
    clearModeSwitchStatus();
    resetModeSwitchStateForTests();
    resetPackConsentForTests();
    resetNeedsYouForTests();
    resetViewStatesForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("each of the 30 consent packs, auto-consent off: Needs you on the tile, no modal, 0 network listeners per pick", async () => {
    const packs = shippedConsentPacks();
    expect(packs).toHaveLength(30);
    const h = await mainHost();
    h.configureApplyModeForTests({ liveMode: "topology", lastConsentedMode: "topology", pluginSpecs: packs });
    setLastConsentedModeId("topology");
    const rows: string[] = [];
    for (const spec of packs) {
      const before = { calls: calls.length, sockets, eventSources, frames: countPluginSandboxIframes() };
      h.applyMode(`plugin:${spec.id}`);
      await vi.waitFor(() => {
        expect(sceneEl().dataset.viewId).toBe(`plugin:${spec.id}`);
        expect(sceneEl().dataset.viewState).toBe("needs-you");
      });
      await new Promise((r) => setTimeout(r, 20));
      const traffic = packTraffic(calls.slice(before.calls));
      const listeners = traffic.length
        + (sockets - before.sockets)
        + (eventSources - before.eventSources)
        + Math.max(0, countPluginSandboxIframes() - before.frames);
      const modal = document.querySelector(".modal.ask");
      const review = sceneNotice()?.querySelector("button[data-action=review]")?.textContent ?? null;
      rows.push(`${spec.id}: listeners=${listeners} modal=${modal ? 1 : 0} review=${review ?? "-"}${traffic.length ? ` [${traffic.map((t) => `${t.method} ${t.url}`).join(", ")}]` : ""}`);
    }
    const bad = rows.filter((r) => !/listeners=0 modal=0 review=Review$/.test(r));
    expect(bad, rows.join("\n")).toEqual([]);
  });
});
