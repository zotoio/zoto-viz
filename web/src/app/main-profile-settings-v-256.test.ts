/**
 * #256 rows 2 and 4, through main.ts's real collectSettings / applySettings. main.ts boots at
 * collection (main-entry-env, #239); each "boot" below runs its catalog boot (the test hook), which
 * applies the same-tab session snapshot (applySettings) and then writes it back from
 * collectSettings (persistLive), normalised by writeSessionLive. Two boots make one round trip:
 * collect -> normalise -> apply -> collect. The rows read that snapshot raw: readSessionLive
 * normalises it again, and the first normalise has already stamped v: 1, so only the raw blob
 * shows what collect wrote (a collect with no v is stored as legacy). The seed carries no aiCycle,
 * which persistLive always writes, so its presence shows the boot did write the snapshot back.
 *
 * Row 4 pins the arcade families: every family in ARCADE_STORAGE_RE (read from main.ts's source,
 * not a hand-kept list) survives collect -> apply.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// An inert Worker for this page, as main-entry-harness stubs one: otherwise each LayoutClient
// main.ts makes has happy-dom fetch layout.worker.ts (or, with no Worker, layout.wasm) from a dev
// server that isn't there, and happy-dom's teardown aborts that pending fetch. Stubbed before
// main.ts loads, and again before each test (setup.ts unstubs globals after each one).
const { InertWorker } = vi.hoisted(() => {
  class InertWorker {
    onmessage: unknown = null;
    onerror: unknown = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  vi.stubGlobal("Worker", InertWorker);
  return { InertWorker };
});
import "../../test-support/main-entry-env";
import "./main";
import { SHIPPED_ID, shippedSettings, USER_ID } from "../core/profiles";
import { SESSION_LIVE_KEY, writeSessionLive } from "../core/session-live";
import { mainEntryTestBootCatalog } from "./main-entry-test-host";

const MAIN_SRC = readFileSync(resolve(__dirname, "main.ts"), "utf8");

/** The families named in main.ts's `ARCADE_STORAGE_RE`, and that regex rebuilt from its source. */
function arcadeFamilies(): { families: string[]; re: RegExp } {
  const m = MAIN_SRC.match(/^const ARCADE_STORAGE_RE = \/(.+)\/;$/m);
  const body = m?.[1] ?? "";
  const group = body.match(/\(([a-z|]+)\)/)?.[1] ?? "";
  return { families: group ? group.split("|") : [], re: new RegExp(body) };
}

function arcadeKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && arcadeFamilies().re.test(k)) keys.push(k);
  }
  return keys.sort();
}

// #208: the booted page goes away the way a real one does, so its pagehide disposes the LiveFeed
// poll before happy-dom's teardown (main-entry-harness does the same).
afterAll(() => {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
});

type RawLive = { aiCycle?: unknown; settings?: Record<string, unknown>; newerIds?: unknown; legacy?: unknown };

/** The same-tab session snapshot as stored, before readSessionLive normalises it again. */
function rawLive(): RawLive {
  const raw = sessionStorage.getItem(SESSION_LIVE_KEY);
  const live: RawLive = raw ? JSON.parse(raw) : {};
  return live;
}

/** One catalog boot; returns the snapshot it wrote back, raw. */
async function boot(): Promise<RawLive> {
  expect("aiCycle" in rawLive()).toBe(false);
  await mainEntryTestBootCatalog();
  const live = rawLive();
  expect("aiCycle" in live).toBe(true);
  return live;
}

/** Seed the snapshot the next boot applies, without the aiCycle persistLive adds. */
function seed(settings: RawLive["settings"]): void {
  writeSessionLive({ profileId: "user", dirty: false, settings: { ...shippedSettings(), ...settings } });
}

describe("#256: main.ts collect / apply keep v: 1 and every arcade family", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.stubGlobal("Worker", InertWorker);
    sessionStorage.removeItem(SESSION_LIVE_KEY);
  });

  afterEach(() => {
    sessionStorage.removeItem(SESSION_LIVE_KEY);
    for (const k of arcadeKeys()) localStorage.removeItem(k);
  });

  it("(2) round trip collect -> normalise -> apply -> collect is stable and keeps v: 1", async () => {
    seed({ dream: true, merge: true });
    const first = await boot();
    expect(first.settings?.v).toBe(2);
    // collectSettings itself wrote v: a collect without it is stored as legacy.
    expect(first.settings?.legacy).toBe(false);
    expect(first.settings?.newer).toBe(false);
    expect(first.settings?.dream).toBe(true);
    expect(first.settings?.merge).toBe(true);
    // Apply what collect wrote, and collect again (persistLive drops the aiCycle marker in).
    seed(first.settings);
    const second = await boot();
    expect(second.settings?.v).toBe(2);
    expect(second.settings?.legacy).toBe(false);
    expect(second.settings).toEqual(first.settings);
  });

  it("(4) all 14 arcade families in ARCADE_STORAGE_RE survive collect -> apply", async () => {
    const { families, re } = arcadeFamilies();
    expect(families).toHaveLength(14);
    expect(new Set(families).size).toBe(14);
    const arcade = Object.fromEntries(families.map((f) => [`zoto-viz.${f}.best`, `score-${f}`]));
    for (const k of Object.keys(arcade)) expect(re.test(k), k).toBe(true);
    // Apply puts every family's key into this browser, and collect reads every one back.
    seed({ arcade });
    const first = await boot();
    expect(arcadeKeys()).toEqual(Object.keys(arcade).sort());
    expect(first.settings?.arcade).toEqual(arcade);
    // Drop them from the browser: the collected blob alone brings all 14 back.
    for (const k of arcadeKeys()) localStorage.removeItem(k);
    expect(arcadeKeys()).toEqual([]);
    seed(first.settings);
    const second = await boot();
    expect(arcadeKeys()).toHaveLength(14);
    for (const [k, v] of Object.entries(arcade)) expect(localStorage.getItem(k), k).toBe(v);
    expect(second.settings?.arcade).toEqual(arcade);
  });
});

// ---- #256b: same-tab reload, saved blobs, the line per boot ----

const NEWER_LINE = "This profile was saved by a newer version of zoto-viz, so changes won't be saved to it. Use Save as to keep them in a new profile.";

/** Profiles server for main.ts with one listed profile `id` (the startup default) holding `blob`. */
function profilesServer(id: string, blob: unknown) {
  const base = globalThis.fetch;
  const puts: { path: string; body: unknown }[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": "test-csrf" } });
  const list = {
    default: id,
    fresh: false,
    file: "/home/test/.zoto-viz/profiles.yml",
    profiles: [
      { id: SHIPPED_ID, label: "zoto viz", shipped: true },
      { id: USER_ID, label: USER_ID, shipped: false },
      { id, label: id, shipped: false },
    ],
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.split("?")[0] ?? url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/profiles" && method === "GET") return json(list);
    if (path === `/api/profiles/${id}`) {
      if (method === "GET") return json({ settings: blob });
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (method === "PUT") puts.push({ path, body });
      return json({});
    }
    return base(input, init);
  };
  vi.stubGlobal("fetch", fetchFn);
  return { puts };
}

/** The same tab reloading: the next boot applies exactly the snapshot this one wrote. */
function reload(live: RawLive): void {
  const next: Record<string, unknown> = { ...live };
  delete next.aiCycle;
  sessionStorage.setItem(SESSION_LIVE_KEY, JSON.stringify(next));
}

/** Every element on the page showing the newer-version line. */
const newerLines = () => [...document.body.querySelectorAll("*")]
  .filter((n) => n.childElementCount === 0 && n.textContent === NEWER_LINE).length;

/** Count the line being set on the profile bar's status span. */
function countLineSets(): { sets: () => number } {
  const span = document.querySelector('.profile-bar [role="status"]');
  if (!(span instanceof HTMLElement)) throw new Error("no profile-bar role=status span");
  let proto: object | null = span;
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    proto = Object.getPrototypeOf(proto);
    desc = proto ? Object.getOwnPropertyDescriptor(proto, "textContent") : undefined;
  }
  let n = 0;
  Object.defineProperty(span, "textContent", {
    configurable: true,
    get() { return desc?.get?.call(span); },
    set(v: string) { if (v === NEWER_LINE) n++; desc?.set?.call(span, v); },
  });
  return { sets: () => n };
}

/** A real edit (the merge names toggle calls touch()), then autosave's debounce runs out. */
async function editTick(): Promise<void> {
  const t = document.getElementById("mergeNames");
  if (!(t instanceof HTMLInputElement)) throw new Error("no mergeNames toggle");
  t.checked = !t.checked;
  t.dispatchEvent(new Event("change"));
  await vi.runOnlyPendingTimersAsync();
  await vi.runOnlyPendingTimersAsync();
}

function storedKeys(body: unknown): { v: unknown; keys: string[] } {
  const settings = body && typeof body === "object" && "settings" in body ? body.settings : null;
  if (!settings || typeof settings !== "object") return { v: undefined, keys: [] };
  return { v: "v" in settings ? settings.v : undefined, keys: Object.keys(settings) };
}

describe("#256b: main.ts keeps the version markers through a same-tab reload", () => {
  beforeEach(() => {
    expect.hasAssertions();
    vi.stubGlobal("Worker", InertWorker);
    sessionStorage.removeItem(SESSION_LIVE_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.removeItem(SESSION_LIVE_KEY);
  });

  it("(10) a v: 99 profile stays unsaved after a same-tab reload; the line is set once per boot", async () => {
    const srv = profilesServer("future", { ...shippedSettings(), v: 99, futureOnly: { x: 1 } });
    const line = countLineSets();
    const first = await boot();
    expect(first.newerIds).toEqual(["future"]);
    expect(line.sets()).toBe(1);
    expect(newerLines()).toBe(1);
    // The reload's snapshot settings say v: 1; the markers beside them still say newer.
    expect(first.settings?.v).toBe(2);
    reload(first);
    const second = await boot();
    expect(second.newerIds).toEqual(["future"]);
    // A reload is a new load: the line is set again on that boot, and still shown once.
    expect(line.sets()).toBe(2);
    expect(newerLines()).toBe(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (let i = 0; i < 3; i++) await editTick();
    expect(srv.puts).toHaveLength(0);
    expect(line.sets()).toBe(2);
    expect(newerLines()).toBe(1);
  });

  it("(11) a v: 1 profile autosaves after the same reload, and the PUT carries v: 1 without markers", async () => {
    const srv = profilesServer("mine", { ...shippedSettings(), v: 1 });
    const first = await boot();
    // (This file's one main.ts still knows row 10's "future" is newer; "mine" isn't.)
    expect(Array.isArray(first.newerIds) ? first.newerIds : []).not.toContain("mine");
    reload(first);
    await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (let i = 0; i < 3; i++) await editTick();
    expect(srv.puts).toHaveLength(3);
    for (const put of srv.puts) {
      const stored = storedKeys(put.body);
      expect(stored.v).toBe(2);
      expect(stored.keys).not.toContain("legacy");
      expect(stored.keys).not.toContain("newer");
    }
    expect(newerLines()).toBe(0);
  });

  it("(12) a legacy profile stays legacy through a same-tab reload until its first autosave", async () => {
    const blob: Record<string, unknown> = { ...shippedSettings() };
    delete blob.v;
    delete blob.legacy;
    delete blob.newer;
    const srv = profilesServer("old", blob);
    const first = await boot();
    expect(first.legacy).toBe(true);
    reload(first);
    const second = await boot();
    expect(second.legacy).toBe(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await editTick();
    expect(srv.puts).toHaveLength(1);
    expect(storedKeys(srv.puts[0]?.body).v).toBe(2);
    // The next snapshot after that write: the server blob is v: 1 now.
    await editTick();
    const after: RawLive = JSON.parse(sessionStorage.getItem(SESSION_LIVE_KEY) ?? "{}");
    expect(after.legacy).toBe(false);
  });
});
