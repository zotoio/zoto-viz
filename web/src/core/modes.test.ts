import { describe, expect, it } from "vitest";
import {
  GRAPH_MODES, MODES, allModes, bluetooth, categorize, CPU_RED, cpuHeat, defaultOpts, hashColor, heat,
  modeById, orgOf, paneLabelCap, parseWatchList, setPluginModes, viewCaption, viewSource, wifi,
} from "./modes";
import type { Device } from "./types";

describe("modes", () => {
  it("ships topology first and unique ids", () => {
    expect(MODES[0]?.id).toBe("topology");
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
    expect(GRAPH_MODES.every((m) => !m.standalone)).toBe(true);
  });

  it("builds legends and default opts for every shipped view", () => {
    for (const m of MODES) {
      const opts = defaultOpts(m);
      const legend = m.legend(opts);
      expect(Array.isArray(legend)).toBe(true);
      expect(modeById(m.id).id).toBe(m.id);
    }
    expect(Array.isArray(wifi.legend(defaultOpts(wifi)))).toBe(true);
    expect(Array.isArray(bluetooth.legend(defaultOpts(bluetooth)))).toBe(true);
    expect(modeById("missing").id).toBe("topology");
  });

  it("hashes, heats, categorises, and parses watch lists", () => {
    expect(hashColor("a")).toBe(hashColor("a"));
    expect(heat(0)).toBeTypeOf("number");
    expect(heat(1)).toBeTypeOf("number");
    expect(heat(0.4)).toBeTypeOf("number");
    expect(cpuHeat(0)).toBe(heat(0));
    expect(cpuHeat(CPU_RED)).toBe(heat(1));
    expect(cpuHeat(100)).toBe(heat(1));
    expect(categorize(["udp/53"]).id).toBe("dns");
    expect(categorize(["tcp/443"]).id).toBe("tls");
    expect(categorize(["udp/443"]).id).toBe("quic");
    expect(categorize([])).toBeTruthy();
    expect(parseWatchList("a, b, c")).toEqual(["a", "b", "c"]);
    expect(paneLabelCap({ smallPane: true, labelCount: 10 } as never, 10)).toBe(5);
    expect(paneLabelCap({ smallPane: false, labelCount: 10 } as never)).toBe(10);
    setPluginModes([{ ...MODES[0]!, id: "plugin:x", pluginId: "x" }]);
    expect(allModes().some((m) => m.id === "plugin:x")).toBe(true);
    setPluginModes([]);
    expect(orgOf({ ip: "1.1.1.1", names: ["api.google.com"], hostnames: [], role: "internet" } as unknown as Device).length).toBeGreaterThan(0);
    expect(viewSource(MODES[0]!)).toBe("NET");
    expect(viewCaption(MODES[0]!)).toBe("NET Topology");
    expect(viewCaption(wifi)).toMatch(/^AIR /);
    expect(viewCaption(bluetooth)).toMatch(/^BT /);
  });
});
