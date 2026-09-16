import { describe, expect, it, afterEach } from "vitest";
import { AI_ID, SHIPPED_ID, USER_ID, agentProfileId, aiCycleSettings, isAgentProfile, normalizeSettings, quiet, shippedSettings, suggestId } from "./profiles";
import { setPluginModes, topology } from "./modes";

afterEach(() => setPluginModes([]));

describe("profiles", () => {
  it("ships netviz and fills defaults", () => {
    expect(SHIPPED_ID).toBe("netviz");
    const s = shippedSettings();
    expect(s.mode).toBe("topology");
    expect(s.modeOptions).toEqual({});
    setPluginModes([{ ...topology, id: "plugin:topology", pluginId: "topology", label: "Topology" }]);
    expect(shippedSettings().mode).toBe("plugin:topology");
    expect(shippedSettings().modeOptions["plugin:topology"]).toEqual({});
    setPluginModes([]);
    expect(s.chrome).toBe("top");
    expect(s.feed.source).toBe("traffic");
    expect(s.feed.textSize).toBe(12);
  });

  it("normalizes partial blobs and suggests ids", () => {
    const n = normalizeSettings({
      theme: "matrix", dream: true, chrome: "left", merge: true, redact: true,
      show: { lan: false }, filters: { allowNames: "nest" }, arcade: { a: "1" }, plugins: { p: { k: "v" } },
    });
    expect(n.theme).toBe("matrix");
    expect(n.dream).toBe(true);
    expect(n.chrome).toBe("left");
    expect(n.show.lan).toBe(false);
    expect(n.show.internet).toBe(true);
    expect(n.show.cpuIdle).toBe(true);
    expect(n.filters.allowNames).toBe("nest");
    expect(n.arcade.a).toBe("1");
    expect(n.feed.textSize).toBe(12);
    expect(normalizeSettings({ feed: { textSize: 40, density: 4 } }).feed).toMatchObject({ textSize: 20, density: 12 });
    expect(normalizeSettings(null).theme).toBe(shippedSettings().theme);
    expect(quiet(() => 7)).toBe(7);
    expect(suggestId([])).toBe(USER_ID);
    expect(suggestId([USER_ID])).toBe("user-2");
    expect(suggestId([USER_ID, ...Array.from({ length: 98 }, (_, i) => `user-${i + 2}`)])).toMatch(/^user-/);
  });

  it("overlays cycling flags for a new agent profile", () => {
    const s = aiCycleSettings(shippedSettings());
    expect(AI_ID).toBe("ai");
    expect(s.dream).toBe(true);
    expect(s.autosave).toBe(true);
    expect(s.anim.backdrop).toBe("dynamic");
    expect(s.anim.cycle).toBe(true);
    expect(s.anim.follow).toBe(true);
    expect(s.anim.randomize).toBe(true);
    expect(s.anim.themeCycle).toBe("cadence");
    expect(s.anim.skyCycle).toBe("off");
    expect(s.show.lan).toBe(true);
    expect(s.camera).toBe("auto");
    expect(s.agent.decos).toEqual([]);
  });

  it("slugs Ollama model tags into profile ids", () => {
    expect(agentProfileId("gemma4:latest")).toBe("gemma4-latest");
    expect(agentProfileId("llama3.1:8b")).toBe("llama3-1-8b");
    expect(agentProfileId("Gemma4")).toBe("gemma4");
    expect(agentProfileId("3b-model")).toBe("m-3b-model");
    expect(agentProfileId("netviz")).toBe("agent-netviz");
    expect(agentProfileId("user")).toBe("agent-user");
    expect(isAgentProfile({ id: "ai" })).toBe(true);
    expect(isAgentProfile({ id: "gemma4", model: "gemma4:latest" })).toBe(true);
    expect(isAgentProfile({ id: "user" })).toBe(false);
  });

  it("keeps an existing AI look when refreshing the cycle overlay", () => {
    const base = shippedSettings();
    base.anim.backdrop = "aurora";
    base.agent = { shader: "vec3 color(vec3 dir, float t) { return uAccent; }", decos: [] };
    const keep = aiCycleSettings(base, { keepLook: true });
    expect(keep.anim.backdrop).toBe("custom");
    expect(keep.agent.shader).toContain("color");
  });
});
