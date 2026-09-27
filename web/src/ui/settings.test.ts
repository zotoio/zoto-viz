import { beforeEach, describe, expect, it } from "vitest";
import { compileMatcher, Settings } from "./settings";
import type { Device } from "../core/types";
import { loadSettingsDeclFixture } from "../plugins/test/load-settings-fixture";

const d = (over: Partial<Device> = {}): Device => ({
  ip: "192.168.86.4", mac: "", vendor: "Google", hostnames: ["Nest-Cam"], names: ["Nest-Cam"],
  sources: [], ports: [], ifaces: [], aliases: ["192.168.86.4"], first_seen: 0, last_seen: 0,
  bytes_in: 0, bytes_out: 0, packets: 0, role: "lan", online: true, ...over,
});

describe("compileMatcher", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("matches CIDR, prefixes, names, and globs", () => {
    expect(compileMatcher("")(undefined, "1.1.1.1")).toBe(false);
    const cidr = compileMatcher("192.168.86.0/24");
    expect(cidr(undefined, "192.168.86.10")).toBe(true);
    expect(cidr(undefined, "10.0.0.1")).toBe(false);
    const prefix = compileMatcher("192.168.86.");
    expect(prefix(undefined, "192.168.86.10")).toBe(true);
    const name = compileMatcher("nest");
    expect(name(d(), "192.168.86.4")).toBe(true);
    expect(name(undefined, "other")).toBe(false);
    const glob = compileMatcher("Nest-*");
    expect(glob(d(), "192.168.86.4")).toBe(true);
    expect(compileMatcher("10.0.0.1")(undefined, "10.0.0.1")).toBe(true);
  });
});

describe("Settings panes", () => {
  it("puts Network and System on Graph, host filters on Privacy, and plugin copy on This view", () => {
    const s = new Settings({ storePrefix: "zoto-viz-test", onChange: () => {} });
    const labels = [...s.el.querySelectorAll(".s-nav-btn")].map((b) => b.textContent);
    expect(s.el.querySelector(".float-handle")?.textContent).toBe("settings");
    expect(s.el.querySelector(".float-resize")).toBeTruthy();
    expect(labels).toContain("This view");
    expect(labels).toContain("Graph");
    expect(labels).toContain("Physics");
    expect(labels).toContain("Dice");
    expect(labels).toContain("Sources");
    const dicePane = s.el.querySelector('[data-pane="dice"]');
    expect(dicePane?.textContent).toMatch(/Repeat/);
    expect(dicePane?.textContent).toMatch(/every/);
    expect(dicePane?.textContent).toMatch(/min/);
    expect(dicePane?.textContent).toMatch(/Randomiser/);
    expect(dicePane?.textContent).toMatch(/theme/);
    expect(dicePane?.textContent).toMatch(/Soft ceilings/);
    expect(dicePane?.textContent).toMatch(/does not start a chat/);
    const net = document.createElement("div");
    net.dataset.k = "net";
    const sys = document.createElement("div");
    sys.dataset.k = "sys";
    s.addSection("Network", [{ el: net }], "LAN nodes");
    s.addSection("System", [{ el: sys }], "CPU graphs");
    const dbg = document.createElement("div");
    dbg.dataset.k = "dbg";
    s.addSection("Debug", [{ el: dbg }], "monitor stderr");
    const graph = s.host;
    expect(graph.querySelector("[data-k=net]")).toBe(net);
    expect(graph.querySelector("[data-k=sys]")).toBe(sys);
    expect(graph.textContent).toContain("LAN nodes");
    expect(graph.textContent).toContain("CPU graphs");
    expect(graph.textContent).not.toContain("Allow host patterns");
    expect(s.el.querySelector('[data-pane="appearance"]')?.textContent).toMatch(/monitor stderr/);
    const privacy = s.privacyHost;
    expect(privacy.textContent).toContain("Network detail");
    expect(privacy.textContent).toContain("Allow host patterns");
    expect(privacy.textContent).toContain("Devices");
    expect(privacy.textContent).toMatch(/sound/);
    expect(privacy.textContent).toMatch(/starts off/);
    expect(privacy.textContent).toMatch(/AI and dice cannot/);
    expect(dicePane?.textContent).toMatch(/camera, microphone, sound/);
    expect(dicePane?.textContent).toMatch(/Nest cams/);
    expect(dicePane?.textContent).toMatch(/Guardian/);
    s.bindView(null);
    const pluginPane = s.el.querySelector('[data-pane="view"]');
    expect(pluginPane?.textContent).toMatch(/On a single view, the cog next to the header view menu opens this tab/);
    expect(pluginPane?.textContent).toMatch(/On a wall, use the corner cog on that pane/);
    expect(pluginPane?.textContent).toMatch(/Network and system visibility live under Graph/);
    expect(pluginPane?.textContent).toMatch(/Host and subnet filters live under Privacy/);
  });

  it("exposes graph layout and link chips on Look", () => {
    const s = new Settings({ storePrefix: "zoto-viz-graph-layout", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    const graph = s.host;
    expect(graph.textContent).toMatch(/layout/);
    expect(graph.textContent).toMatch(/tree/);
    expect(graph.textContent).toMatch(/globe/);
    expect(graph.textContent).toMatch(/helix/);
    expect(graph.textContent).toMatch(/vortex/);
    expect(graph.textContent).toMatch(/bloom/);
    expect(graph.textContent).toMatch(/hilbert/);
    expect(graph.textContent).toMatch(/fft/);
    expect(graph.textContent).toMatch(/heap/);
    expect(graph.textContent).toMatch(/bars/);
    expect(graph.textContent).toMatch(/arrows/);
    expect(graph.textContent).toMatch(/bundle/);
    expect(s.el.querySelector('[data-pane="motion"]')?.textContent).toMatch(/selection/);
  });

  it("exposes a feed text-size slider", () => {
    const s = new Settings({ storePrefix: "zoto-viz-feed-size", onChange: () => {} });
    s.addLiveFeed(() => {});
    const feedPane = s.el.querySelector('[data-pane="feed"]');
    expect(feedPane?.textContent).toMatch(/text/);
    expect(feedPane?.textContent).toMatch(/lines/);
  });

  it("shows plugin options and config knobs on This view", () => {
    const s = new Settings({ storePrefix: "zoto-viz-view-knobs", onChange: () => {} });
    s.bindView({
      id: "lan-heat", packName: "LAN heat", version: 1, engine: "graph", base: "talkers",
      options: [{ key: "rank", label: "rank by", values: [["rate", "current rate"], ["bytes", "bytes"]], default: "rate" }],
      config: [{ key: "internet", label: "internet hosts", type: "select", values: [["dim", "dim"], ["hide", "hide"]], default: "dim" }],
    });
    const pane = s.el.querySelector('[data-pane="view"]');
    expect(pane?.textContent).toMatch(/rank by/);
    expect(pane?.textContent).toMatch(/internet hosts/);
    expect(pane?.querySelector("textarea[aria-label=prompt]")).toBeTruthy();
    s.bindView({ id: "agent", packName: "Agent", version: 1 });
    expect(s.el.querySelector('[data-pane="view"]')?.querySelector("textarea[aria-label=prompt]")).toBeTruthy();
    expect(s.el.querySelector('[data-pane="view"]')?.textContent).not.toMatch(/no extra settings/);
  });

  it("opens This view from the view cog and hosts arcade knobs there", () => {
    const s = new Settings({ storePrefix: "zoto-viz-view-cog", onChange: () => {} });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cog = s.attachViewCog(host);
    expect(cog.classList.contains("plugin-cog")).toBe(true);
    expect(cog.getAttribute("aria-expanded")).toBe("false");
    cog.click();
    expect(s.isOpen).toBe(true);
    expect((s.el.querySelector('[data-pane="view"]') as HTMLElement | null)?.hidden).toBe(false);
    expect(cog.getAttribute("aria-expanded")).toBe("true");
    const extra = document.createElement("button");
    extra.type = "button";
    extra.textContent = "source";
    s.bindView({ id: "netpong", packName: "NetPong", version: 1, engine: "netpong" }, undefined, null, [extra]);
    const pane = s.el.querySelector('[data-pane="view"]');
    expect(pane?.textContent).toMatch(/source/);
    const prompt = pane?.querySelector("textarea[aria-label=prompt]");
    expect(prompt).toBeTruthy();
    expect(pane?.textContent).not.toMatch(/no extra settings/);
    expect(pane?.contains(extra)).toBe(true);
    const nodes = [...(pane?.querySelectorAll("button, textarea") ?? [])];
    expect(nodes.indexOf(extra)).toBeLessThan(nodes.indexOf(prompt as HTMLTextAreaElement));
    cog.click();
    expect(s.isOpen).toBe(false);
    expect(cog.getAttribute("aria-expanded")).toBe("false");
    host.remove();
  });

  it("puts mosaic pane pickers on This view", () => {
    const s = new Settings({ storePrefix: "zoto-viz-mosaic-view", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    const view = s.el.querySelector('[data-pane="view"]');
    expect(view?.textContent).toMatch(/Wall/);
    expect(view?.textContent).toMatch(/1×/);
    expect(view?.textContent).toMatch(/hero/);
    expect(s.el.querySelector('[data-pane="motion"]')?.textContent).not.toMatch(/assign a view to every pane/);
    s.bindView({ id: "nest-cams", packName: "Nest cams", version: 1, engine: "graph" });
    const thisView = s.el.querySelector('[data-pane="view"]');
    expect(thisView?.textContent).toMatch(/View/);
    expect(thisView?.textContent).toMatch(/Wall/);
    expect(thisView?.querySelector(".mosaic-settings")).toBeTruthy();
    expect(thisView?.querySelector('[data-layer="view"]')).toBeTruthy();
    expect(thisView?.querySelector('[data-layer="pack"]')?.textContent).toMatch(/Plugin pack/);
  });

  it("opens This view from a pane cog and marks that pane row", () => {
    const s = new Settings({ storePrefix: "zoto-viz-pane-cog", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...s.animSettings,
      mosaic: "4",
      mosaicTiles: ["plugin:cores", "plugin:memory", "plugin:disk", "plugin:gpu"],
    });
    s.openView("plugin:memory");
    expect(s.isOpen).toBe(true);
    expect(s.viewFocus).toBe("plugin:memory");
    expect(s.el.querySelector('.mosaic-pane-row[data-pane="plugin:memory"]')?.classList.contains("focus")).toBe(true);
    s.openView("plugin:memory");
    expect(s.isOpen).toBe(false);
  });

  it("binds This view when that settings tab opens", () => {
    const s = new Settings({ storePrefix: "zoto-viz-show-view", onChange: () => {} });
    let n = 0;
    s.onShowView = () => { n += 1; };
    s.open("view");
    expect(n).toBe(1);
    expect(s.openPane).toBe("view");
    s.showPane("appearance");
    expect(n).toBe(1);
    expect(s.openPane).toBe("appearance");
    s.showPane("view");
    expect(n).toBe(2);
  });

  it("keeps plugin settings announcer on the view pane after randomise", () => {
    const s = new Settings({ storePrefix: "zoto-plugin-ann-rand", onChange: () => {} });
    const spec = loadSettingsDeclFixture();
    s.bindView(spec, spec.config);
    const pane = s.el.querySelector('[data-pane="view"]')!;
    const announcer = pane.querySelector(":scope > .plugin-settings-announcer");
    const viewHost = [...pane.children].find(
      (el) => !el.classList.contains("plugin-settings-announcer"),
    ) as HTMLElement;
    expect(announcer).toBeTruthy();
    viewHost.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]')?.click();
    expect(pane.querySelector(":scope > .plugin-settings-announcer")).toBe(announcer);
    expect(viewHost.contains(announcer)).toBe(false);
  });

  it("mounts plugin settings announcer on the view pane outside the view layer", () => {
    const s = new Settings({ storePrefix: "zoto-plugin-announcer", onChange: () => {} });
    const spec = loadSettingsDeclFixture();
    s.bindView(spec, spec.config);
    const pane = s.el.querySelector('[data-pane="view"]');
    const announcer = pane?.querySelector(":scope > .plugin-settings-announcer");
    const viewLayer = pane?.querySelector('[data-layer="view"]');
    expect(announcer).toBeTruthy();
    expect(viewLayer?.contains(announcer)).toBe(false);
    s.bindView(spec, spec.config);
    expect(pane?.querySelector(":scope > .plugin-settings-announcer")).toBe(announcer);
  });

  it("hides pack scope note for production-shaped mosaic walls", () => {
    const s = new Settings({ storePrefix: "zoto-pack-scope", onChange: () => {} });
    s.addAnimation(() => {}, { el: document.createElement("div") });
    s.applyAnim({
      ...s.animSettings,
      mosaic: "4",
      mosaicTiles: ["plugin:settings-fixture", "plugin:topology", "plugin:memory", "plugin:disk"],
    });
    s.bindView(loadSettingsDeclFixture(), loadSettingsDeclFixture().config);
    expect(s.el.querySelector('[data-pane="view"]')?.textContent).not.toMatch(/Applies to all/);
  });
});
