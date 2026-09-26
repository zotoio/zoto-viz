import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMode } from "../core/modes";
import {
  MAIN_PRESENT_OPTS_LOCALSTORAGE_GETS_PER_FRAME_6520B01,
  buildPresentOptsFor,
  invokePresentLoopOptsForSites,
} from "./main-present-opts-localstorage";
import type { PluginView } from "../plugins/plugin";

describe("present-loop optsFor localStorage (main @6520b01)", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("W4: steady frame getItem count matches main@6520b01 (packet-tunnel)", () => {
    const mode: ViewMode = {
      id: "plugin:packet-tunnel",
      label: "Packet Tunnel",
      pluginId: "packet-tunnel",
      options: [],
      config: [
        { key: "bright", type: "number", default: 1, min: 0, max: 2 },
        { key: "speed", type: "number", default: 1, min: 0, max: 2 },
        { key: "depth", type: "number", default: 1, min: 0, max: 2 },
        { key: "gain", type: "number", default: 1, min: 0, max: 2 },
      ],
    };
    const spec: PluginView = {
      id: "packet-tunnel",
      name: "Packet Tunnel",
      capabilities: ["viz.read"],
      config: mode.config,
    };
    let count = 0;
    const orig = localStorage.getItem.bind(localStorage);
    const optsFor = (m: ViewMode) => {
      const spy = vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
        count++;
        return orig(key);
      });
      const o = buildPresentOptsFor(m, spec);
      spy.mockRestore();
      return o;
    };
    invokePresentLoopOptsForSites(optsFor, mode, "packet-tunnel");
    expect(count).toBe(MAIN_PRESENT_OPTS_LOCALSTORAGE_GETS_PER_FRAME_6520B01);
    expect(count).toBe(MAIN_PRESENT_OPTS_LOCALSTORAGE_GETS_PER_FRAME_6520B01);
  });
});
