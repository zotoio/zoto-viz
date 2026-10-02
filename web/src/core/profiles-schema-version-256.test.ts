/**
 * #256: ProfileSettings carries a schema version. `collectSettings()` writes `v: 1`;
 * `normalizeSettings()` takes a blob with no `v` as legacy (v0) and returns `v: 1` with
 * `legacy: true`, so the next autosave upgrades it and #257 can tell an untouched legacy
 * default from a stored value. A blob with a `v` this build doesn't know (newer) loads for what it
 * understands, but autosave never writes over it, and the profile bar says so once.
 *
 * Rows 1, 3 and 5 here; rows 2 and 4 drive main.ts's real collect / apply
 * (app/main-profile-settings-v-256.test.ts). Row 3 runs the real ProfileStore over a fake
 * /api/profiles server and counts the writes to the profile; autosave's debounce runs on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSettings, ProfileStore, SHIPPED_ID, shippedSettings, storedSettings, USER_ID, type ProfileSettings } from "./profiles";

const NEWER_LINE = "This profile was saved by a newer version of zoto-viz, so changes won't be saved to it. Use Save as to keep them in a new profile.";

/** A blob as a user's profiles.yml holds it: every field set, several off their defaults. */
function savedBlob(): Record<string, unknown> {
  const s = shippedSettings();
  return {
    ...s,
    theme: "aurora",
    dream: true,
    merge: true,
    vizGovernor: false,
    arcade: { "zoto-viz.pong.best": "12" },
    recentViews: ["topology"],
    mosaicFocus: "p1",
    chrome: "left",
  };
}

/** Every field except the version markers. */
function withoutVersion(s: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(s).filter(([k]) => k !== "v" && k !== "legacy" && k !== "newer"));
}

type Call = { method: string; path: string };

/** A profiles server with one writable profile `id` holding `blob`, and the shipped row. */
function fakeServer(id: string, blob: unknown, defaultId = id) {
  const calls: Call[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const list = {
    default: defaultId,
    fresh: false,
    file: "/home/test/.zoto-viz/profiles.yml",
    profiles: [
      { id: SHIPPED_ID, label: "zoto viz", shipped: true },
      { id: "user", label: "user", shipped: false },
      { id, label: id, shipped: false },
    ],
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.split("?")[0] ?? url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path });
    if (path === "/api/session") return json({ csrf: "test-csrf", aiControl: false, pluginService: false, typesafeConfigured: false });
    if (path === "/api/profiles" && method === "GET") return json(list);
    if (path === "/api/profiles/global") return json({});
    if (path === `/api/profiles/${id}` && method === "GET") return json({ settings: blob });
    return json({});
  };
  /** Writes that would land on the profile's own blob. */
  const writesTo = (pid: string) => calls.filter((c) => c.method !== "GET" && c.path === `/api/profiles/${pid}`).length;
  return { fetchFn, calls, writesTo };
}

function store(): { store: ProfileStore; applied: ProfileSettings[]; bar: HTMLElement } {
  const applied: ProfileSettings[] = [];
  let live = shippedSettings();
  const host = {
    collect: () => live,
    apply: (s: ProfileSettings) => { applied.push(s); live = s; },
  };
  const el = document.createElement("div");
  const sel = { setOptions: () => {}, value: "", el };
  const bar = document.createElement("div");
  const tools = document.createElement("div");
  document.body.append(el, bar, tools);
  return { store: new ProfileStore(host, sel, bar, tools), applied, bar };
}

/** How many elements on the page carry exactly the newer-version line. */
const newerLines = () => [...document.body.querySelectorAll("*")]
  .filter((n) => n.childElementCount === 0 && n.textContent === NEWER_LINE).length;

describe("#256: ProfileSettings schema version", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("(1) a blob with no v normalises to v: 1, marked legacy, every other field unchanged", () => {
    const blob = savedBlob();
    delete blob.v;
    expect("v" in blob).toBe(false);
    const out = normalizeSettings(blob);
    expect(out.v).toBe(2);
    expect(out.legacy).toBe(true);
    expect(out.newer).toBe(false);
    expect(withoutVersion({ ...out })).toEqual(withoutVersion(blob));
    // A current blob is not legacy, and normalises to the same fields.
    const current = normalizeSettings({ ...blob, v: 1 });
    expect(current.v).toBe(2);
    expect(current.legacy).toBe(false);
    expect(withoutVersion({ ...current })).toEqual(withoutVersion({ ...out }));
  });

  it("(3) a v: 99 blob loads; autosave makes 0 writes over it; the status line shows exactly once", async () => {
    vi.useFakeTimers();
    // Control: a current (v: 1) profile does autosave, through the same store and server.
    const ok = fakeServer("mine", { ...savedBlob(), v: 1 });
    vi.stubGlobal("fetch", ok.fetchFn);
    const a = store();
    await a.store.boot();
    expect(a.store.current).toBe("mine");
    for (let i = 0; i < 3; i++) {
      a.store.touch();
      await vi.runOnlyPendingTimersAsync();
    }
    expect(ok.writesTo("mine")).toBe(3);
    expect(newerLines()).toBe(0);
    document.body.replaceChildren();

    const srv = fakeServer("future", { ...savedBlob(), v: 99, futureOnly: { x: 1 } });
    vi.stubGlobal("fetch", srv.fetchFn);
    const b = store();
    await b.store.boot();
    expect(b.store.current).toBe("future");
    // Loaded for what this build understands.
    expect(b.applied).toHaveLength(1);
    expect(b.applied[0]?.theme).toBe("aurora");
    expect(b.applied[0]?.chrome).toBe("left");
    // Soft, so a build without the line still reports whether it wrote over the profile.
    expect.soft(newerLines()).toBe(1);
    for (let i = 0; i < 5; i++) {
      b.store.touch();
      await vi.runOnlyPendingTimersAsync();
    }
    expect(srv.writesTo("future")).toBe(0);
    expect(b.store.dirty).toBe(false);
    expect(b.bar.hidden).toBe(false);
    expect(newerLines()).toBe(1);
  });

  it("(5) the shipped zoto-viz profile loads with and without v", async () => {
    const shipped = shippedSettings();
    const withV = normalizeSettings(shipped);
    expect(withV.v).toBe(2);
    expect(withV.legacy).toBe(false);
    expect(withV).toEqual(shipped);
    const bare: Record<string, unknown> = { ...shipped };
    delete bare.v;
    const noV = normalizeSettings(bare);
    expect(noV.v).toBe(2);
    expect(noV.legacy).toBe(true);
    expect(withoutVersion({ ...noV })).toEqual(withoutVersion({ ...shipped }));

    // The store's startup load of the shipped profile.
    const srv = fakeServer("mine", { ...savedBlob(), v: 1 }, SHIPPED_ID);
    vi.stubGlobal("fetch", srv.fetchFn);
    const s = store();
    await s.store.boot();
    expect(s.store.current).toBe(SHIPPED_ID);
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]?.v).toBe(2);
    expect(newerLines()).toBe(0);
  });
});

// ---- #256b: the gaps closed before QE, and UX Pro's sign-off (A-C) ----

type Sent = { method: string; path: string; body: unknown };

/**
 * A profiles server holding `blobs` by id (each one listed), the shipped row and `user`.
 * `models` marks agent profiles (their meta carries the model).
 */
function profilesServer(blobs: Record<string, unknown>, defaultId: string, models: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const ids = [...new Set([USER_ID, ...Object.keys(blobs)])];
  const list = {
    default: defaultId,
    fresh: false,
    file: "/home/test/.zoto-viz/profiles.yml",
    profiles: [
      { id: SHIPPED_ID, label: "zoto viz", shipped: true },
      ...ids.map((id) => ({ id, label: models[id] ?? id, shipped: false, ...(models[id] ? { model: models[id] } : {}) })),
    ],
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.split("?")[0] ?? url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ method, path, body });
    if (path === "/api/session") return json({ csrf: "test-csrf", aiControl: false, pluginService: false, typesafeConfigured: false });
    if (path === "/api/profiles" && method === "GET") return json(list);
    if (path === "/api/profiles/global") return json({});
    const id = path.startsWith("/api/profiles/") ? path.slice("/api/profiles/".length) : "";
    if (method === "GET" && id in blobs) return json({ settings: blobs[id] });
    return json({});
  };
  vi.stubGlobal("fetch", fetchFn);
  /** Writes (PUT / POST / DELETE) that land on profile `id`'s own blob. */
  const writesTo = (id: string) => sent.filter((c) => c.method !== "GET" && c.path === `/api/profiles/${id}`);
  const getsOf = (id: string) => sent.filter((c) => c.method === "GET" && c.path === `/api/profiles/${id}`).length;
  return { sent, writesTo, getsOf };
}

const v1 = () => ({ ...savedBlob(), v: 1 });

/** A sent body's settings: its v and whether it carries a load-time marker. */
function stored(c: Sent | undefined): { v: unknown; markers: string[] } {
  const settings = c?.body && typeof c.body === "object" && "settings" in c.body ? c.body.settings : null;
  if (!settings || typeof settings !== "object") return { v: undefined, markers: [] };
  return { v: "v" in settings ? settings.v : undefined, markers: Object.keys(settings).filter((k) => k === "legacy" || k === "newer") };
}
const v99 = () => ({ ...savedBlob(), v: 99, futureOnly: { x: 1 } });

function buttonIn(root: ParentNode, label: string): HTMLButtonElement {
  const b = [...root.querySelectorAll("button")].find((x) => x.textContent === label);
  if (!b) throw new Error(`no ${label} button`);
  return b;
}

/** Answer the open ask() dialog titled `title` with its `label` button; returns its body text. */
async function answer(title: string, label: string): Promise<string> {
  const modal = await vi.waitFor(() => {
    const m = [...document.querySelectorAll(".modal.ask")].find((x) => x.querySelector("strong")?.textContent === title);
    if (!m) throw new Error(`no ${title} dialog`);
    return m;
  });
  const text = modal.querySelector(".ask-body p")?.textContent ?? "";
  buttonIn(modal, label).click();
  return text;
}

/** Edit, then let autosave's debounce and anything it starts run out. */
async function editTick(s: ProfileStore): Promise<void> {
  s.touch();
  await vi.runOnlyPendingTimersAsync();
  await vi.runOnlyPendingTimersAsync();
}

describe("#256b: nothing writes over a newer profile; the line is announced once per load", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("(6) manual Save reaches writeNow: a v: 1 profile is written, a v: 99 one gets 0 PUTs", async () => {
    const ok = profilesServer({ mine: v1() }, "mine");
    const a = store();
    await a.store.boot();
    buttonIn(a.bar, "Save").click();
    await answer("Save profile", "Save");
    await vi.waitFor(() => expect(ok.writesTo("mine")).toHaveLength(1));
    // What the host collects here (shippedSettings) carries the markers; the PUT doesn't.
    expect(a.store.newerProfile).toBe(false);
    expect(stored(ok.writesTo("mine")[0])).toEqual({ v: 2, markers: [] });
    document.body.replaceChildren();

    const srv = profilesServer({ future: v99() }, "future");
    const b = store();
    await b.store.boot();
    expect(b.store.newerProfile).toBe(true);
    // Hidden, but its click handler still runs confirmSave -> saveCurrent -> writeNow.
    buttonIn(b.bar, "Save").click();
    await answer("Save profile", "Save");
    // writeNow refused, so saveCurrent reports why: the status line.
    expect(await answer("Could not save", "OK")).toBe(NEWER_LINE);
    expect(srv.writesTo("future")).toHaveLength(0);
  });

  it("(7) writeAi never writes over an agent profile whose loaded copy was newer, even once left", async () => {
    const ok = profilesServer({ gemma4: v1() }, "gemma4", { gemma4: "gemma4" });
    const a = store();
    await a.store.boot();
    await a.store.writeAi(normalizeSettings(v1()), "gemma4");
    expect(ok.writesTo("gemma4")).toHaveLength(1);
    expect(stored(ok.writesTo("gemma4")[0])).toEqual({ v: 2, markers: [] });
    document.body.replaceChildren();

    const srv = profilesServer({ gemma4: v99(), [USER_ID]: v1() }, "gemma4", { gemma4: "gemma4" });
    const b = store();
    await b.store.boot();
    expect(b.store.newerProfile).toBe(true);
    await b.store.writeAi(shippedSettings(), "gemma4");
    await b.store.select(USER_ID);
    expect(b.store.current).toBe(USER_ID);
    await b.store.writeAi(shippedSettings(), "gemma4");
    expect(srv.writesTo("gemma4")).toHaveLength(0);
  });

  it("(8) the first edit on the shipped profile doesn't adopt a newer working profile", async () => {
    vi.useFakeTimers();
    const ok = profilesServer({ [USER_ID]: v1() }, USER_ID);
    const a = store();
    await a.store.boot();
    await a.store.select(SHIPPED_ID);
    await editTick(a.store);
    expect(ok.writesTo(USER_ID).filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(a.store.current).toBe(USER_ID);
    document.body.replaceChildren();

    const srv = profilesServer({ [USER_ID]: v99() }, USER_ID);
    const b = store();
    await b.store.boot();
    expect(b.store.newerProfile).toBe(true);
    await b.store.select(SHIPPED_ID);
    expect(b.store.current).toBe(SHIPPED_ID);
    for (let i = 0; i < 3; i++) await editTick(b.store);
    expect(srv.writesTo(USER_ID)).toHaveLength(0);
    // The edit stays on the shipped profile, unsaved, with Save as offered.
    expect(b.store.current).toBe(SHIPPED_ID);
    expect(b.store.dirty).toBe(true);
    expect(buttonIn(b.bar, "Save as…").hidden).toBe(false);
  });

  it("(9) a fresh store applying the same-tab snapshot keeps newer and legacy from the markers", async () => {
    vi.useFakeTimers();
    // The snapshot's settings were collected (v: 1); only the markers say what the server held.
    const srv = profilesServer({ future: v99(), old: withoutVersion(savedBlob()) }, "future");
    const a = store();
    await a.store.boot({ profileId: "future", dirty: true, settings: shippedSettings(), newerIds: ["future"] });
    expect(a.store.current).toBe("future");
    expect(a.store.newerProfile).toBe(true);
    expect(a.store.dirty).toBe(false);
    expect(newerLines()).toBe(1);
    for (let i = 0; i < 3; i++) await editTick(a.store);
    expect(srv.writesTo("future")).toHaveLength(0);
    document.body.replaceChildren();

    const b = store();
    await b.store.boot({ profileId: "old", dirty: false, settings: shippedSettings(), legacy: true });
    expect(b.store.legacyProfile).toBe(true);
    expect(b.applied[0]?.legacy).toBe(true);
    // Its first autosave upgrades the blob, so it isn't legacy any more.
    await editTick(b.store);
    expect(srv.writesTo("old")).toHaveLength(1);
    expect(b.store.legacyProfile).toBe(false);
    // Without the marker the same snapshot is current, not legacy.
    document.body.replaceChildren();
    const c = store();
    await c.store.boot({ profileId: "old", dirty: false, settings: shippedSettings() });
    expect(c.store.legacyProfile).toBe(false);
    expect(c.applied[0]?.legacy).toBe(false);
  });

  it("(B) role=status span, empty in the DOM first; the line is set once per load and cleared on switch", async () => {
    vi.useFakeTimers();
    const srv = profilesServer({ [USER_ID]: v1(), future: v99() }, USER_ID);
    const s = store();
    const span = s.bar.querySelector('[role="status"]');
    if (!(span instanceof HTMLElement)) throw new Error("no role=status span");
    expect(span.isConnected).toBe(true);
    expect(span.textContent).toBe("");
    // Count every text set on the span, and what the span looked like just before each line set.
    let proto: object | null = span;
    let desc: PropertyDescriptor | undefined;
    while (proto && !desc) {
      proto = Object.getPrototypeOf(proto);
      desc = proto ? Object.getOwnPropertyDescriptor(proto, "textContent") : undefined;
    }
    const lineSets: { connected: boolean; before: string }[] = [];
    Object.defineProperty(span, "textContent", {
      configurable: true,
      get() { return desc?.get?.call(span); },
      set(v: string) {
        if (v === NEWER_LINE) lineSets.push({ connected: span.isConnected, before: String(desc?.get?.call(span) ?? "") });
        desc?.set?.call(span, v);
      },
    });
    await s.store.boot();
    expect(lineSets).toHaveLength(0);
    await s.store.select("future");
    expect(lineSets).toEqual([{ connected: true, before: "" }]);
    // In-app re-renders, a store reload of the same profile, and autosave ticks: no new set.
    await s.store.pinStartup();
    buttonIn(s.bar, "Discard").click();
    await vi.waitFor(() => expect(srv.getsOf("future")).toBe(2));
    await vi.runOnlyPendingTimersAsync();
    for (let i = 0; i < 3; i++) await editTick(s.store);
    expect(lineSets).toHaveLength(1);
    expect(span.textContent).toBe(NEWER_LINE);
    // Switching to another profile clears it; coming back is a new load of it.
    await s.store.select(USER_ID);
    expect(span.textContent).toBe("");
    await s.store.select("future");
    expect(lineSets).toHaveLength(2);
    expect(srv.writesTo("future")).toHaveLength(0);
  });

  it("(C) focus on Save or Discard moves to Save as when a newer profile hides them", async () => {
    profilesServer({ [USER_ID]: v1(), future: v99() }, USER_ID);
    const s = store();
    await s.store.boot();
    const saveAs = buttonIn(s.bar, "Save as…");
    for (const label of ["Save", "Discard"]) {
      await s.store.select(USER_ID);
      const b = buttonIn(s.bar, label);
      expect(b.hidden).toBe(false);
      b.focus();
      expect(document.activeElement).toBe(b);
      await s.store.select("future");
      expect(b.hidden).toBe(true);
      expect(document.activeElement).toBe(saveAs);
    }
    // Focus elsewhere stays where it is.
    await s.store.select(USER_ID);
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    await s.store.select("future");
    expect(document.activeElement).toBe(other);
  });
});

// ---- #275: two write paths can still lose a newer build's profile ----

/** How many times the status span is assigned the #256 line. */
function countNewerLineSets(span: HTMLElement): { n: () => number } {
  let n = 0;
  let proto: object | null = span;
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    proto = Object.getPrototypeOf(proto);
    desc = proto ? Object.getOwnPropertyDescriptor(proto, "textContent") : undefined;
  }
  Object.defineProperty(span, "textContent", {
    configurable: true,
    get() { return desc?.get?.call(span); },
    set(v: string) {
      if (v === NEWER_LINE) n += 1;
      desc?.set?.call(span, v);
    },
  });
  return { n: () => n };
}

/**
 * profilesServer that keeps POST / DELETE, so a renamed profile's next GET is the body that was written.
 */
function rememberingServer(blobs: Record<string, unknown>, defaultId: string, models: Record<string, string> = {}) {
  const held = { ...blobs };
  const named = { ...models };
  const sent: Sent[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const listBody = () => ({
    default: defaultId,
    fresh: false,
    file: "/home/test/.zoto-viz/profiles.yml",
    profiles: [
      { id: SHIPPED_ID, label: "zoto viz", shipped: true },
      ...[...new Set([USER_ID, ...Object.keys(held)])].map((id) => ({
        id,
        label: named[id] ?? id,
        shipped: false,
        ...(named[id] ? { model: named[id] } : {}),
      })),
    ],
  });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.split("?")[0] ?? url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    sent.push({ method, path, body });
    if (path === "/api/session") return json({ csrf: "test-csrf", aiControl: false, pluginService: false, typesafeConfigured: false });
    if (path === "/api/profiles" && method === "GET") return json(listBody());
    if (path === "/api/profiles/global") return json({});
    if (path === "/api/profiles" && method === "POST" && body && typeof body === "object" && "id" in body) {
      const posted = body as { id: string; settings?: unknown; model?: string };
      held[posted.id] = posted.settings;
      if (posted.model) named[posted.id] = posted.model;
      return json({});
    }
    const id = path.startsWith("/api/profiles/") ? path.slice("/api/profiles/".length) : "";
    if (method === "DELETE" && id) {
      delete held[id];
      delete named[id];
      return json({ default: defaultId });
    }
    if (method === "GET" && id in held) return json({ settings: held[id] });
    if (method === "PUT" && id && body && typeof body === "object" && "settings" in body) {
      held[id] = (body as { settings: unknown }).settings;
      return json({});
    }
    return json({});
  };
  vi.stubGlobal("fetch", fetchFn);
  const writesTo = (id: string) => sent.filter((c) => c.method !== "GET" && c.path === `/api/profiles/${id}`);
  const postOf = (id: string) => sent.find((c) => c.method === "POST" && c.path === "/api/profiles" && !!c.body && typeof c.body === "object" && "id" in c.body && c.body.id === id);
  return { sent, writesTo, postOf };
}

describe("#275: two write paths keep a newer profile", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("(a) moving ai onto the model id keeps a v: 99 blob, and the next edit writes nothing", async () => {
    vi.useFakeTimers();
    const blob = v99();
    const srv = rememberingServer({ ai: blob }, "ai");
    const s = store();
    await s.store.boot();
    await s.store.activateAiCycle(shippedSettings(), { model: "gemma4", online: true });
    const post = srv.postOf("gemma4");
    const settings = post?.body && typeof post.body === "object" && "settings" in post.body ? post.body.settings : null;
    expect(settings).toEqual(blob);
    expect(s.store.current).toBe("gemma4");
    expect(s.store.newerProfile).toBe(true);
    await editTick(s.store);
    expect(srv.writesTo("gemma4")).toHaveLength(0);

    document.body.replaceChildren();
    const current = v1();
    const ok = rememberingServer({ ai: current }, "ai");
    const b = store();
    await b.store.boot();
    await b.store.activateAiCycle(shippedSettings(), { model: "gemma4", online: true });
    const moved = ok.postOf("gemma4");
    const movedSettings = moved?.body && typeof moved.body === "object" && "settings" in moved.body ? moved.body.settings : null;
    expect(movedSettings).toEqual(JSON.parse(JSON.stringify(storedSettings(normalizeSettings(current)))));
    expect(b.store.newerProfile).toBe(false);
    await editTick(b.store);
    expect(ok.writesTo("gemma4").filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("(b) the first edit on the shipped profile does not adopt a newer user this tab never loaded", async () => {
    vi.useFakeTimers();
    const srv = profilesServer({ [USER_ID]: v99() }, SHIPPED_ID);
    const s = store();
    const span = s.bar.querySelector('[role="status"]');
    if (!(span instanceof HTMLElement)) throw new Error("no role=status span");
    const line = countNewerLineSets(span);
    await s.store.boot();
    expect(s.store.current).toBe(SHIPPED_ID);
    expect(srv.getsOf(USER_ID)).toBe(0);
    expect(line.n()).toBe(0);
    await editTick(s.store);
    await editTick(s.store);
    expect(srv.getsOf(USER_ID)).toBe(1);
    expect(srv.writesTo(USER_ID)).toHaveLength(0);
    expect(s.store.current).toBe(SHIPPED_ID);
    expect(s.store.dirty).toBe(true);
    expect(buttonIn(s.bar, "Save as…").hidden).toBe(false);
    expect(line.n()).toBe(1);
    expect(span.textContent).toBe(NEWER_LINE);

    document.body.replaceChildren();
    const ok = profilesServer({ [USER_ID]: v1() }, SHIPPED_ID);
    const b = store();
    await b.store.boot();
    expect(ok.getsOf(USER_ID)).toBe(0);
    await editTick(b.store);
    const userCalls = ok.sent.filter((c) => c.path === `/api/profiles/${USER_ID}`);
    expect(userCalls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(b.store.current).toBe(USER_ID);
  });
});
