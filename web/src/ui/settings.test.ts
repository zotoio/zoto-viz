import { describe, expect, it } from "vitest";
import { compileMatcher, Settings } from "./settings";
import type { Device } from "../core/types";

const d = (over: Partial<Device> = {}): Device => ({
  ip: "192.168.86.4", mac: "", vendor: "Google", hostnames: ["Nest-Cam"], names: ["Nest-Cam"],
  sources: [], ports: [], ifaces: [], aliases: ["192.168.86.4"], first_seen: 0, last_seen: 0,
  bytes_in: 0, bytes_out: 0, packets: 0, role: "lan", online: true, ...over,
});

describe("compileMatcher", () => {
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
    expect(labels).toContain("This view");
    expect(labels).toContain("Graph");
    expect(labels).toContain("Physics");
    expect(labels).toContain("Dice");
    const dicePane = s.el.querySelector('[data-pane="dice"]');
    expect(dicePane?.textContent).toMatch(/Randomiser/);
    expect(dicePane?.textContent).toMatch(/theme/);
    expect(dicePane?.textContent).toMatch(/Soft ceilings/);
    expect(dicePane?.textContent).toMatch(/hand back to AI/);
    const net = document.createElement("div");
    net.dataset.k = "net";
    const sys = document.createElement("div");
    sys.dataset.k = "sys";
    s.addSection("Network", [{ el: net }], "LAN nodes");
    s.addSection("System", [{ el: sys }], "CPU graphs");
    const graph = s.host;
    expect(graph.querySelector("[data-k=net]")).toBe(net);
    expect(graph.querySelector("[data-k=sys]")).toBe(sys);
    expect(graph.textContent).toContain("LAN nodes");
    expect(graph.textContent).toContain("CPU graphs");
    expect(graph.textContent).not.toContain("Allow host patterns");
    const privacy = s.privacyHost;
    expect(privacy.textContent).toContain("Network detail");
    expect(privacy.textContent).toContain("Allow host patterns");
    s.bindView(null);
    const pluginPane = s.el.querySelector('[data-pane="view"]');
    expect(pluginPane?.textContent).toMatch(/The cog next to the view menu opens this tab/);
    expect(pluginPane?.textContent).toMatch(/Network and system visibility live under Graph/);
    expect(pluginPane?.textContent).toMatch(/Host and subnet filters live under Privacy/);
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
      id: "lan-heat", name: "LAN heat", version: 1, engine: "graph", base: "talkers",
      options: [{ key: "rank", label: "rank by", values: [["rate", "current rate"], ["bytes", "bytes"]], default: "rate" }],
      config: [{ key: "internet", label: "internet hosts", type: "select", values: [["dim", "dim"], ["hide", "hide"]], default: "dim" }],
    });
    const pane = s.el.querySelector('[data-pane="view"]');
    expect(pane?.textContent).toMatch(/rank by/);
    expect(pane?.textContent).toMatch(/internet hosts/);
    expect(pane?.querySelector("textarea[aria-label=prompt]")).toBeTruthy();
    s.bindView({ id: "agent", name: "Agent", version: 1 });
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
    s.bindView({ id: "netpong", name: "NetPong", version: 1, engine: "netpong" }, undefined, null, [extra]);
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
});
