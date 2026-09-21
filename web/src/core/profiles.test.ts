import { describe, expect, it, afterEach } from "vitest";
import { AI_ID, LEGACY_SHIPPED_ID, ProfileStore, SHIPPED_ID, SHIPPED_LABEL, USER_ID, agentProfileId, aiCycleSettings, headerBrandProfile, isAgentProfile, isQuiet, isShippedId, normalizeSettings, quiet, shippedSettings, suggestId, workingProfileId, type ProfileList } from "./profiles";
import { setPluginModes, topology } from "./modes";

afterEach(() => setPluginModes([]));

describe("profiles", () => {
  it("ships netviz and fills defaults", () => {
    expect(SHIPPED_ID).toBe("zoto-viz");
    expect(SHIPPED_LABEL).toBe("zoto viz");
    expect(LEGACY_SHIPPED_ID).toBe("netviz");
    expect(isShippedId("zoto-viz")).toBe(true);
    expect(isShippedId("netviz")).toBe(true);
    expect(isShippedId(USER_ID)).toBe(false);
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
    expect(s.dice.include.theme).toBe(true);
    expect(s.dice.mosaicMax).toBe("6");
    expect(s.autosave).toBe(true);
    expect(s.sound).toBe(false);
    expect(normalizeSettings({ theme: "ember" }).sound).toBe(false);
    expect(normalizeSettings({ sound: true }).sound).toBe(true);
    expect(normalizeSettings({ theme: "ember" }).autosave).toBe(true);
    expect(normalizeSettings({ autosave: false }).autosave).toBe(true);
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
    expect(n.dice.include.theme).toBe(true);
    expect(normalizeSettings({ dice: { include: { physics: false }, labelsMax: 32 } }).dice).toMatchObject({
      include: { physics: false, theme: true }, labelsMax: 32, mosaicMax: "6", on: false, periodMin: 5,
    });
    expect(normalizeSettings({ feed: { textSize: 40, density: 4 } }).feed).toMatchObject({ textSize: 20, density: 12 });
    expect(normalizeSettings({
      anim: { follow: true, audioCamera: true, camInertia: 0.05, gravity: 1.9, partCap: 2420, partSize: 2.4, labelWeight: 2 },
    }).anim).toMatchObject({ camInertia: 0.45, gravity: 1, partCap: 800, labelWeight: 1.2 });
    expect(normalizeSettings(null).theme).toBe(shippedSettings().theme);
    expect(quiet(() => 7)).toBe(7);
    expect(isQuiet()).toBe(false);
    quiet(() => { expect(isQuiet()).toBe(true); });
    expect(suggestId([])).toBe(USER_ID);
    expect(suggestId([USER_ID])).toBe("user-2");
    expect(suggestId([USER_ID, ...Array.from({ length: 98 }, (_, i) => `user-${i + 2}`)])).toMatch(/^user-/);
    expect(headerBrandProfile("user-2")).toBe(" - user-2");
    expect(headerBrandProfile(SHIPPED_LABEL)).toBe(" - zoto viz");
    expect(headerBrandProfile("")).toBe("");
    expect(headerBrandProfile(undefined)).toBe("");
    expect(workingProfileId("user-2", [SHIPPED_ID, USER_ID, "user-2"])).toBe(USER_ID);
    expect(workingProfileId(SHIPPED_ID, [SHIPPED_ID, USER_ID])).toBe(USER_ID);
    expect(workingProfileId("grok-4-5", [SHIPPED_ID, "grok-4-5"])).toBe(USER_ID);
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
    expect(agentProfileId("zoto-viz")).toBe("agent-zoto-viz");
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

  it("applySession restores a snapshot onto the matching profile", () => {
    const applied: ReturnType<typeof shippedSettings>[] = [];
    const store = new ProfileStore(
      { collect: shippedSettings, apply: (s) => { applied.push(s); } },
      { value: SHIPPED_ID, el: document.createElement("div"), setOptions() {} },
      document.createElement("div"),
      document.createElement("div"),
    );
    store.list = [{ id: USER_ID, label: USER_ID, shipped: false }, { id: SHIPPED_ID, label: SHIPPED_ID, shipped: true }];
    const ok = store.applySession({ profileId: USER_ID, dirty: true, settings: { theme: "ember", dream: true } });
    expect(ok).toBe(true);
    expect(store.current).toBe(USER_ID);
    expect(store.dirty).toBe(true);
    expect(applied.at(-1)?.theme).toBe("ember");
    expect(applied.at(-1)?.dream).toBe(true);
  });

  it("maps a leftover shipped session onto user", () => {
    const store = new ProfileStore(
      { collect: shippedSettings, apply: () => {} },
      { value: "", el: document.createElement("div"), setOptions() {} },
      document.createElement("div"),
      document.createElement("div"),
    );
    store.list = [{ id: SHIPPED_ID, label: SHIPPED_LABEL, shipped: true }, { id: USER_ID, label: USER_ID, shipped: false }];
    store.applySession({ profileId: "netviz", dirty: true, settings: { theme: "ember" } });
    expect(store.current).toBe(USER_ID);
    expect(store.dirty).toBe(true);
    expect(store.shipped).toBe(false);
  });
});

function jsonOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function profileList(overrides: Partial<ProfileList> = {}): ProfileList {
  return {
    default: USER_ID,
    fresh: false,
    file: "/home/x/.zoto-viz/profiles.yml",
    profiles: [
      { id: SHIPPED_ID, label: SHIPPED_LABEL, shipped: true },
      { id: USER_ID, label: USER_ID, shipped: false },
    ],
    ...overrides,
  };
}

function mockProfilesFetch(opts: { down?: () => boolean; shippedStatus?: number } = {}) {
  return (async (url: string, init?: RequestInit) => {
    if (opts.down?.()) throw new Error("down");
    const path = String(url);
    const method = (init?.method || "GET").toUpperCase();
    if (path.includes("/api/session")) return jsonOk({ csrf: "t" });
    if (path.includes("/api/profiles/shipped") && method === "POST") {
      if (opts.shippedStatus && opts.shippedStatus >= 400) {
        return jsonOk({ error: "write failed" }, opts.shippedStatus);
      }
      return jsonOk({});
    }
    if (path.endsWith("/api/profiles") && method === "GET") return jsonOk(profileList());
    if (path.includes("/api/profiles/") && method === "GET") return jsonOk({ settings: shippedSettings() });
    return jsonOk({});
  }) as unknown as typeof fetch;
}

describe("profiles availability", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("stays available when the shipped write fails after a good list", async () => {
    globalThis.fetch = mockProfilesFetch({ shippedStatus: 500 });
    const bar = document.createElement("div");
    const store = new ProfileStore(
      { collect: shippedSettings, apply: () => {} },
      { value: "", el: document.createElement("div"), setOptions() {} },
      bar,
      document.createElement("div"),
    );
    await store.boot();
    expect(store.available).toBe(true);
    expect(bar.hidden).toBe(true);
    expect(bar.textContent).not.toMatch(/Profiles file unavailable/);
  });

  it("omits the autosave toggle and always writes writable profiles", async () => {
    let puts = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      const method = (init?.method || "GET").toUpperCase();
      if (path.includes("/api/session")) return jsonOk({ csrf: "t" });
      if (path.includes("/api/profiles/shipped") && method === "POST") return jsonOk({});
      if (path.endsWith("/api/profiles") && method === "GET") return jsonOk(profileList());
      if (path.includes("/api/profiles/") && method === "GET") {
        return jsonOk({ settings: { ...shippedSettings(), autosave: false } });
      }
      if (path.includes("/api/profiles/") && method === "PUT") {
        puts += 1;
        return jsonOk({});
      }
      return jsonOk({});
    }) as unknown as typeof fetch;
    const tools = document.createElement("div");
    const store = new ProfileStore(
      { collect: shippedSettings, apply: () => {} },
      { value: "", el: document.createElement("div"), setOptions() {} },
      document.createElement("div"),
      tools,
    );
    await store.boot();
    expect(tools.textContent).not.toMatch(/autosave/i);
    expect(store.current).toBe(USER_ID);
    expect(store.autosave).toBe(true);
    expect(store.canAutosave).toBe(true);
    store.touch();
    await new Promise((r) => setTimeout(r, 500));
    expect(puts).toBeGreaterThan(0);
  });

  it("recovers after a failed boot without applying the startup default", async () => {
    let down = true;
    const applied: string[] = [];
    globalThis.fetch = mockProfilesFetch({ down: () => down });
    const bar = document.createElement("div");
    const store = new ProfileStore(
      { collect: shippedSettings, apply: (s) => { applied.push(s.theme); } },
      { value: "", el: document.createElement("div"), setOptions() {} },
      bar,
      document.createElement("div"),
    );
    await store.boot({ profileId: USER_ID, dirty: false, settings: { theme: "ember" } });
    expect(store.available).toBe(false);
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toMatch(/Profiles file unavailable/);
    expect(applied).toEqual(["ember"]);
    down = false;
    expect(await store.recover()).toBe(true);
    expect(store.available).toBe(true);
    expect(bar.hidden).toBe(true);
    expect(bar.textContent).not.toMatch(/Profiles file unavailable/);
    expect(applied).toEqual(["ember"]);
  });

  it("treats a concurrent user-profile create as success", async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
    try {
      let listedUser = false;
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const path = String(url);
        const method = (init?.method || "GET").toUpperCase();
        if (path.includes("/api/session")) return jsonOk({ csrf: "t" });
        if (path.includes("/api/profiles/shipped") && method === "POST") return jsonOk({});
        if (path.endsWith("/api/profiles") && method === "GET") {
          const profiles = listedUser
            ? [{ id: SHIPPED_ID, label: SHIPPED_LABEL, shipped: true }, { id: USER_ID, label: USER_ID, shipped: false }]
            : [{ id: SHIPPED_ID, label: SHIPPED_LABEL, shipped: true }];
          return jsonOk(profileList({ profiles, default: SHIPPED_ID, fresh: true }));
        }
        if (path.endsWith("/api/profiles") && method === "POST") {
          listedUser = true;
          return jsonOk({ error: "profile 'user' already exists" }, 409);
        }
        if (path.includes("/api/profiles/") && method === "GET") return jsonOk({ settings: shippedSettings() });
        return jsonOk({});
      }) as unknown as typeof fetch;
      const store = new ProfileStore(
        { collect: shippedSettings, apply: () => {} },
        { value: "", el: document.createElement("div"), setOptions() {} },
        document.createElement("div"),
        document.createElement("div"),
      );
      await store.boot();
      expect(store.available).toBe(true);
      expect(warns.join("\n")).not.toMatch(/already exists/);
    } finally {
      console.warn = orig;
    }
  });
});
