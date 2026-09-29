import { describe, expect, it } from "vitest";
import { loadTilesSettlingEach } from "./sky-sync-tiles";

/** QE batch A replay: a held Backrooms sky (first tile) kept all four panes warming. */
const IDS = ["plugin:backrooms", "topology", "load", "memory"];
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("loadTilesSettlingEach", () => {
  it("settles the three other panes while the first tile's sky is still held", async () => {
    const settled: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const done = loadTilesSettlingEach(IDS, new AbortController().signal,
      (id) => (id === "plugin:backrooms" ? held : Promise.resolve()), (id) => settled.push(id));
    await flush();
    expect(settled).toEqual(["topology", "load", "memory"]);
    release();
    await done;
    expect(settled).toEqual(["topology", "load", "memory", "plugin:backrooms"]);
  });

  it("starts every tile's load at once (1 call each before any resolves)", async () => {
    const started: string[] = [];
    const never = new Promise<void>(() => {});
    void loadTilesSettlingEach(IDS, new AbortController().signal, (id) => { started.push(id); return never; }, () => {});
    await flush();
    expect(started).toEqual(IDS);
  });

  it("a failing tile still settles, the others settle, and the first error is rethrown after all end", async () => {
    const settled: string[] = [];
    const err = new Error("compile failed");
    await expect(loadTilesSettlingEach(IDS, new AbortController().signal,
      (id) => (id === "load" ? Promise.reject(err) : Promise.resolve()), (id) => settled.push(id))).rejects.toBe(err);
    expect([...settled].sort()).toEqual([...IDS].sort());
  });

  it("a superseded (aborted) sync settles nothing", async () => {
    const settled: string[] = [];
    const ac = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const done = loadTilesSettlingEach(IDS, ac.signal, () => held, (id) => settled.push(id));
    ac.abort();
    release();
    await done;
    expect(settled).toEqual([]);
  });
});
