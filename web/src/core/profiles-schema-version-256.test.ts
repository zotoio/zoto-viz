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
import { normalizeSettings, ProfileStore, SHIPPED_ID, shippedSettings, type ProfileSettings } from "./profiles";

const NEWER_LINE = "This profile was saved by a newer version of zoto-viz, so changes won't be saved to it.";

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
    expect(out.v).toBe(1);
    expect(out.legacy).toBe(true);
    expect(out.newer).toBe(false);
    expect(withoutVersion({ ...out })).toEqual(withoutVersion(blob));
    // A current blob is not legacy, and normalises to the same fields.
    const current = normalizeSettings({ ...blob, v: 1 });
    expect(current.v).toBe(1);
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
    expect(withV.v).toBe(1);
    expect(withV.legacy).toBe(false);
    expect(withV).toEqual(shipped);
    const bare: Record<string, unknown> = { ...shipped };
    delete bare.v;
    const noV = normalizeSettings(bare);
    expect(noV.v).toBe(1);
    expect(noV.legacy).toBe(true);
    expect(withoutVersion({ ...noV })).toEqual(withoutVersion({ ...shipped }));

    // The store's startup load of the shipped profile.
    const srv = fakeServer("mine", { ...savedBlob(), v: 1 }, SHIPPED_ID);
    vi.stubGlobal("fetch", srv.fetchFn);
    const s = store();
    await s.store.boot();
    expect(s.store.current).toBe(SHIPPED_ID);
    expect(s.applied).toHaveLength(1);
    expect(s.applied[0]?.v).toBe(1);
    expect(newerLines()).toBe(0);
  });
});
