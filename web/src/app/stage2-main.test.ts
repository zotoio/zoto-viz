/**
 * Batch B stage 2 through the real main host:
 * - stale consent: Rocket Car Soccer with an OK that went stale (`changed`, `incomplete`) shows
 *   "Rocket Car Soccer needs your OK again. Review", and no word "changed" anywhere on the tile;
 * - option (a) on the web auto path: auto-consent on never grants an incomplete record;
 * - UX Pro's flash row: auto-consent on, a fresh pick never writes a consent notice, not for a frame;
 * - #183: a plugin-settings write while Frogger is up keeps the host graph hidden (both orders),
 *   and the graph comes back on leaving the arcade;
 * - mosaic header pick: the header keeps naming the pick while its pane shows Needs you.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mosaic } from "../graph/mosaic";
import type { PluginView } from "../plugins/plugin";
import * as pluginModule from "../plugins/plugin";
import { defaultVizContract } from "../plugins/viz-host";
import { clearModeSwitchStatus, initModeSwitchStatusStrip } from "./mode-switch-message";
import { resetModeSwitchStateForTests, setLastConsentedModeId } from "./mode-switch-state";
import { resetPackConsentForTests } from "./pack-consent";
import { resetNeedsYouForTests } from "./needs-you";
import { resetViewStatesForTests, viewStateOf } from "./view-state";

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


let puts: string[] = [];
let store: Record<string, string> = {};

function installStubs(autoconsent: boolean): void {
  puts = [];
  store = { "zoto-viz.mode": "topology", "zoto-viz.autoconsent": autoconsent ? "1" : "0" };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
  });
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT" && /\/api\/plugins\/[^/]+\/consent$/.test(url.split("?")[0] ?? url)) {
      puts.push(url);
      return new Response(JSON.stringify({ ok: true, needed: true }), {
        status: 200, headers: { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": "test-csrf" },
      });
    }
    return base(input, init);
  }) as typeof fetch);
  vi.spyOn(pluginModule, "attachPluginFrontend").mockResolvedValue(true);
  vi.spyOn(pluginModule, "fetchPluginSky").mockResolvedValue(
    "#version 300 es\nprecision highp float;out vec4 o;uniform float uTime,uOpacity,uBright;void main(){o=vec4(0.2);}",
  );
}

function sceneEl(): HTMLElement {
  return document.getElementById("scene")!;
}

function sceneNotice(): HTMLElement | null {
  return sceneEl().querySelector<HTMLElement>(":scope > .mosaic-pane-notice");
}

function pack(over: Partial<PluginView>): PluginView {
  return {
    id: "fractal-zoom",
    name: "Fractal Zoom",
    version: 1,
    engine: "graph",
    base: "topology",
    origin: "src",
    capabilities: ["viz.read", "viz.write"],
    runtime: "typescript",
    has_frontend: true,
    has_sky_shader: true,
    shader_sha256: "sky-sha",
    hash: "module-hash",
    consent: null,
    consent_state: "none",
    look: { stageOnly: true, backdrop: "plugin" },
    viz: defaultVizContract({ presentTick: true }),
    ...over,
  };
}

function rocketCarSoccer(state: "changed" | "stale"): PluginView {
  return pack({
    id: "rocket-car-soccer",
    name: "Rocket Car Soccer",
    version: 2,
    consent: null,
    consent_state: state,
    assets_sha256: "assets-now",
  });
}

async function mainHost() {
  const main = await import("./main");
  const testHost = await import("./apply-mode-test-host");
  return { ...main, ...testHost };
}

async function resetAll(): Promise<void> {
  const { resetApplyModeTestOverrides, configureApplyModeForTests } = await import("./apply-mode-test-host");
  configureApplyModeForTests({ mosaic: null });
  resetApplyModeTestOverrides();
  clearModeSwitchStatus();
  resetModeSwitchStateForTests();
  resetPackConsentForTests();
  resetNeedsYouForTests();
  resetViewStatesForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

describe("stage 2 via the main host", { timeout: 60_000 }, () => {
  beforeEach(() => {
    mountShell();
    initModeSwitchStatusStrip();
  });
  afterEach(resetAll);

  async function pick(spec: PluginView, extra: PluginView[] = []) {
    const h = await mainHost();
    h.configureApplyModeForTests({ liveMode: "topology", lastConsentedMode: "topology", pluginSpecs: [spec, ...extra] });
    setLastConsentedModeId("topology");
    h.applyMode(`plugin:${spec.id}`);
    return h;
  }

  for (const [state, reason] of [["changed", "changed"], ["stale", "incomplete"]] as const) {
    it(`stale reason ${reason}: "Rocket Car Soccer needs your OK again. Review", never the word "changed"`, async () => {
      installStubs(false);
      await pick(rocketCarSoccer(state));
      await vi.waitFor(() => { expect(sceneEl().dataset.viewState).toBe("needs-you"); });
      expect(viewStateOf("main")).toEqual({ kind: "needs-you", reason, packId: "rocket-car-soccer" });
      const notice = sceneNotice()!;
      const text = notice.querySelector(".mosaic-pane-notice-text")?.textContent ?? "";
      const button = notice.querySelector("button[data-action=review]")?.textContent ?? "";
      expect(`${text} ${button}`).toBe("Rocket Car Soccer needs your OK again. Review");
      notice.querySelector<HTMLButtonElement>("button[data-action=review]")!.click();
      const panel = sceneEl().querySelector(".pack-review");
      expect(panel, "the review opens on the tile").toBeTruthy();
      expect(sceneEl().textContent ?? "").not.toMatch(/changed/i);
      expect(document.body.textContent ?? "").not.toMatch(/has changed/i);
    });
  }

  it("option (a), web auto path: auto-consent on never grants an incomplete record — Needs you (incomplete), no PUT", async () => {
    installStubs(true);
    await pick(rocketCarSoccer("stale"));
    await vi.waitFor(() => { expect(sceneEl().dataset.viewState).toBe("needs-you"); });
    await new Promise((r) => setTimeout(r, 50));
    expect(viewStateOf("main")).toEqual({ kind: "needs-you", reason: "incomplete", packId: "rocket-car-soccer" });
    expect(puts).toEqual([]);
  });

  it("option (a), web auto path: a complete record whose content moved on (changed) is auto-consented as before", async () => {
    installStubs(true);
    await pick(rocketCarSoccer("changed"));
    await vi.waitFor(() => { expect(["starting", "ready"]).toContain(sceneEl().dataset.viewState); });
    await vi.waitFor(() => { expect(puts.some((u) => u.includes("/api/plugins/rocket-car-soccer/consent"))).toBe(true); });
  });

  it("UX Pro's flash row: auto-consent on, a fresh pick never inserts a consent notice (not for one frame)", async () => {
    installStubs(true);
    const seen: string[] = [];
    const states: string[] = [];
    const bad = /needs source review consent|needs your OK|Review/;
    const obs = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.attributeName === "data-view-state") {
          states.push((r.target as HTMLElement).dataset.viewState ?? "");
        }
        const nodes = r.type === "characterData" ? [r.target] : [...r.addedNodes];
        for (const n of nodes) {
          const t = n.textContent ?? "";
          if (bad.test(t)) seen.push(t);
        }
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-view-state"] });
    await pick(pack({}));
    await vi.waitFor(() => { expect(puts.some((u) => u.includes("/api/plugins/fractal-zoom/consent"))).toBe(true); });
    await vi.waitFor(() => { expect(["starting", "ready"]).toContain(sceneEl().dataset.viewState); });
    await new Promise((r) => setTimeout(r, 100));
    obs.disconnect();
    expect(seen, "consent text written during the pick").toEqual([]);
    expect(states.filter((s) => s === "needs-you"), "never Needs you, even for a frame").toEqual([]);
  });

  const frogger: PluginView = {
    id: "frogger", name: "Frogger", version: 1, engine: "frogger", origin: "src",
    capabilities: [], consent: null, consent_state: "granted",
  };
  const topology: PluginView = {
    id: "topology", name: "Topology", version: 1, engine: "graph", base: "topology", origin: "src",
    capabilities: [], consent: null, consent_state: "granted",
  };

  async function froggerHost() {
    installStubs(false);
    const h = await mainHost();
    h.configureApplyModeForTests({ liveMode: "plugin:topology", lastConsentedMode: "plugin:topology", pluginSpecs: [topology, frogger] });
    h.applyMode("plugin:topology");
    await vi.waitFor(() => { expect(h.getApplyModeHostForTests().getLiveMode()).toBe("plugin:topology"); });
    return h;
  }

  it("#183 order A: Frogger up, then a plugin-settings write — stage only stays on, the graph layer is not drawn", async () => {
    const h = await froggerHost();
    h.applyMode("plugin:frogger");
    await vi.waitFor(() => { expect(document.body.classList.contains("arcade")).toBe(true); });
    expect(h.sceneForTests().testGraphLayer()).toEqual({ stageOnly: true, graphDrawn: false });
    h.firePluginChangeForTests("frogger", { speed: "2" });
    expect(h.sceneForTests().testGraphLayer(), "after settings.onPluginChange").toEqual({ stageOnly: true, graphDrawn: false });
    h.applyMode("plugin:topology");
    await vi.waitFor(() => { expect(document.body.classList.contains("arcade")).toBe(false); });
    expect(h.sceneForTests().testGraphLayer(), "the graph comes back on leaving").toEqual({ stageOnly: false, graphDrawn: true });
  });

  it("#183 order B: the settings write lands before Frogger mounts, then again after — graph hidden while it is up, back after", async () => {
    const h = await froggerHost();
    h.firePluginChangeForTests("frogger", { speed: "3" });
    expect(h.sceneForTests().testGraphLayer().stageOnly, "Topology is not stage only").toBe(false);
    h.applyMode("plugin:frogger");
    await vi.waitFor(() => { expect(document.body.classList.contains("arcade")).toBe(true); });
    expect(h.sceneForTests().testGraphLayer()).toEqual({ stageOnly: true, graphDrawn: false });
    h.firePluginChangeForTests("frogger", { speed: "4" });
    expect(h.sceneForTests().testGraphLayer()).toEqual({ stageOnly: true, graphDrawn: false });
    h.applyMode("plugin:topology");
    await vi.waitFor(() => { expect(document.body.classList.contains("arcade")).toBe(false); });
    expect(h.sceneForTests().testGraphLayer()).toEqual({ stageOnly: false, graphDrawn: true });
  });

  it("mosaic header pick of a pack waiting on its OK: the header keeps the pick, the pane shows Needs you", async () => {
    installStubs(false);
    const h = await mainHost();
    const fakeMosaic = {
      on: true, heroPos: "off", heroMode: "topology", current: "2", tileIds: ["topology", "talkers"],
      focusedId: "topology", mainTileId: "topology", mainMode: "topology",
      setPaneView: vi.fn(() => true), setPaneNotice: vi.fn(), focus: vi.fn(), graphScene: () => null,
      setSize: vi.fn(), graphs: [], syncPreviewCaptions: vi.fn(), markSkyPending: vi.fn(), settlePanes: vi.fn(), settlePane: vi.fn(), paneSky: () => undefined,
    } as unknown as Mosaic;
    // Topology and Fractal Zoom are both real catalog rows, so a snap back to Topology is visible.
    h.configureApplyModeForTests({ liveMode: "plugin:topology", lastConsentedMode: "plugin:topology", pluginSpecs: [topology, pack({})], mosaic: fakeMosaic });
    const sel = h.getApplyModeHostForTests().modeSel;
    sel.value = "plugin:topology";
    expect(sel.value, "a snap back would be visible").toBe("plugin:topology");
    h.applyMode("plugin:fractal-zoom");
    await vi.waitFor(() => { expect(viewStateOf("topology")?.kind).toBe("needs-you"); });
    await new Promise((r) => setTimeout(r, 30));
    expect(h.getApplyModeHostForTests().modeSel.value, "header names the pick, no snap back").toBe("plugin:fractal-zoom");
    expect((fakeMosaic.setPaneView as ReturnType<typeof vi.fn>).mock.calls.length, "the pane has not swapped before the OK").toBe(0);
  });
});
