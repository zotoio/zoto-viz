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
import { shippedSettings } from "../core/profiles";
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

type RawLive = { aiCycle?: unknown; settings?: Record<string, unknown> };

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
    expect(first.settings?.v).toBe(1);
    // collectSettings itself wrote v: a collect without it is stored as legacy.
    expect(first.settings?.legacy).toBe(false);
    expect(first.settings?.newer).toBe(false);
    expect(first.settings?.dream).toBe(true);
    expect(first.settings?.merge).toBe(true);
    // Apply what collect wrote, and collect again (persistLive drops the aiCycle marker in).
    seed(first.settings);
    const second = await boot();
    expect(second.settings?.v).toBe(1);
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
