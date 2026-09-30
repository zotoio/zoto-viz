import { vi } from "vitest";
import { PACK_PERF_STORE } from "../src/core/pack-host-perf";

/** #196 read counters for the pack-perf flag: storage reads, URL parses, `location.search` reads. */
export type PackPerfReadCounts = {
  storageReads: () => number;
  packStoreReads: () => number;
  urlParses: () => number;
  searchReads: () => number;
};

const RealURLSearchParams = globalThis.URLSearchParams;

/**
 * Spy `Storage.prototype.getItem`, `new URLSearchParams` and the `location.search` getter. happy-dom
 * binds Storage methods onto the instance on first use (plugins/host.ts reads storage at import), which
 * bypasses prototype and instance spies, so `localStorage` is also stubbed with a counting view.
 * Undo with `vi.restoreAllMocks()` + `vi.unstubAllGlobals()`.
 */
export function countPackPerfReads(): PackPerfReadCounts {
  const protoGetItem = vi.spyOn(Storage.prototype, "getItem");
  const keys: unknown[] = [];
  const real = window.localStorage;
  vi.stubGlobal("localStorage", new Proxy(real, {
    get(target, prop) {
      if (prop === "getItem") return (key: string) => { keys.push(key); return target.getItem(key); };
      const v: unknown = Reflect.get(target, prop);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }));
  // vi.spyOn hands back the live spy when one is already installed, so count from here on.
  const protoBase = protoGetItem.mock.calls.length;
  const getItemCalls = (): unknown[] => [...protoGetItem.mock.calls.slice(protoBase).map(([k]) => k), ...keys];
  let parses = 0;
  vi.stubGlobal("URLSearchParams", class extends RealURLSearchParams {
    constructor(init?: ConstructorParameters<typeof URLSearchParams>[0]) {
      super(init);
      parses++;
    }
  });
  let owner: object | null = window.location;
  while (owner && !Object.getOwnPropertyDescriptor(owner, "search")) owner = Object.getPrototypeOf(owner) as object | null;
  if (!owner) throw new Error("location.search accessor not found");
  const search = vi.spyOn(owner as { search: string }, "search", "get");
  const searchBase = search.mock.calls.length;
  return {
    storageReads: () => getItemCalls().length,
    packStoreReads: () => getItemCalls().filter((k) => k === PACK_PERF_STORE).length,
    urlParses: () => parses,
    searchReads: () => search.mock.calls.length - searchBase,
  };
}
