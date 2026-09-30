import { afterEach, describe, expect, it } from "vitest";
import { PluginSandbox } from "../plugins/host";
import { configStoreId, type PluginCapability, type PluginView } from "../plugins/plugin";
import { SandboxConfigBatcher } from "./sandbox-config-batcher";
import {
  mayPushSandboxOnPluginChange,
  mayPushSandboxOnPluginFields,
  routePluginChangeSandboxPush,
  sandboxConfigPostMatchesLoaded,
  sandboxLoadedConfigStoreId,
} from "./plugin-sandbox-config-push-route";

const PACK = "pack-a";
const STORE_A1 = "pack-a:tile-a1";
const STORE_A2 = "pack-a:tile-a2";

type ConfigPost = { type: string; config: Record<string, string> };

function frontendSpec(storeId: string, caps: PluginCapability[]): PluginView {
  const instanceId = storeId.includes(":") ? storeId.split(":")[1]! : storeId;
  return {
    id: PACK,
    instanceId,
    name: storeId,
    version: 1,
    engine: "graph",
    has_frontend: true,
    capabilities: caps,
    config: [{ key: "a", label: "a", type: "text", default: "0" }],
  };
}

function createConfigPostTap(box: PluginSandbox): { posted: ConfigPost[]; rehook: () => void } {
  const posted: ConfigPost[] = [];
  const rehook = () => {
    const port = box["hostPort"];
    if (!port) return;
    const orig = port.postMessage.bind(port);
    port.postMessage = (data, transfer) => {
      const msg = data as { type?: string; config?: Record<string, string> };
      if (msg?.type === "config" && msg.config) posted.push({ type: msg.type, config: msg.config });
      if (Array.isArray(transfer)) orig(data, transfer);
      else orig(data, transfer);
    };
  };
  return { posted, rehook };
}

function productionPushOnChange(
  tsWatchStoreId: string,
  loadedSpec: PluginView | null,
  editStoreId: string,
  editSpec: PluginView | null,
  values: Record<string, string>,
  schedule: (storeId: string, config: Record<string, string>) => void,
): void {
  const loaded = sandboxLoadedConfigStoreId(tsWatchStoreId, loadedSpec);
  routePluginChangeSandboxPush(loaded, editStoreId, editSpec, values, schedule);
}

function productionPushOnFields(
  tsWatchStoreId: string,
  loadedSpec: PluginView | null,
  fieldsSpec: PluginView,
  config: Record<string, string>,
  schedule: (storeId: string, config: Record<string, string>) => void,
): void {
  const loaded = sandboxLoadedConfigStoreId(tsWatchStoreId, loadedSpec);
  if (!mayPushSandboxOnPluginFields(loaded, fieldsSpec)) return;
  schedule(configStoreId(fieldsSpec), config);
}

function makeBatcher(
  box: PluginSandbox,
  tsWatchStoreId: string,
): (storeId: string, config: Record<string, string>) => void {
  const batcher = new SandboxConfigBatcher(
    (storeId, config) => {
      if (sandboxConfigPostMatchesLoaded(storeId, tsWatchStoreId)) box.setConfig(config);
    },
    (cb) => {
      cb();
      return 1;
    },
    () => {},
  );
  return (storeId, config) => batcher.schedule(storeId, config);
}

describe("plugin sandbox config push (production route)", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("two instances: editing A posts once to A and never to B", async () => {
    expect.hasAssertions();
    const specA1 = frontendSpec(STORE_A1, ["config.read"]);
    const specA2 = frontendSpec(STORE_A2, ["config.read"]);
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(STORE_A1, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    const schedule = makeBatcher(box, STORE_A1);

    productionPushOnChange(STORE_A1, specA1, STORE_A2, specA2, { a: "wrong" }, schedule);
    productionPushOnChange(STORE_A1, specA1, STORE_A1, specA1, { a: "tile-a1" }, schedule);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "tile-a1" });
    box.unload();
  });

  it("pack without config.read posts nothing on change or fields refresh", async () => {
    expect.hasAssertions();
    const spec = frontendSpec(PACK, ["graph.read"]);
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK, "globalThis.ok = true;", ["graph.read"], { a: "0" });
    tap.rehook();
    const schedule = makeBatcher(box, PACK);

    expect(mayPushSandboxOnPluginChange(PACK, PACK, spec)).toBe(false);
    expect(mayPushSandboxOnPluginFields(PACK, spec)).toBe(false);
    productionPushOnChange(PACK, spec, PACK, spec, { a: "2" }, schedule);
    productionPushOnFields(PACK, spec, spec, { a: "2" }, schedule);
    expect(tap.posted).toHaveLength(0);
    box.unload();
  });

  it("SandboxConfigBatcher dedupe: ten identical edits to A yield exactly one post", async () => {
    expect.hasAssertions();
    const specA1 = frontendSpec(STORE_A1, ["config.read"]);
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(STORE_A1, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    const schedule = makeBatcher(box, STORE_A1);

    for (let i = 0; i < 10; i++) {
      productionPushOnChange(STORE_A1, specA1, STORE_A1, specA1, { a: "same" }, schedule);
    }
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "same" });
    box.unload();
  });

  it("single-instance pack: each distinct change posts exactly once", async () => {
    expect.hasAssertions();
    const spec = frontendSpec(PACK, ["config.read"]);
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    const schedule = makeBatcher(box, PACK);

    productionPushOnChange(PACK, spec, PACK, spec, { a: "1" }, schedule);
    productionPushOnChange(PACK, spec, PACK, spec, { a: "2" }, schedule);
    expect(tap.posted).toHaveLength(2);
    expect(tap.posted[0]!.config).toEqual({ a: "1" });
    expect(tap.posted[1]!.config).toEqual({ a: "2" });
    box.unload();
  });

  it("onPluginFields path uses the same store-id guard as onPluginChange", async () => {
    expect.hasAssertions();
    const specA1 = frontendSpec(STORE_A1, ["config.read"]);
    const specA2 = frontendSpec(STORE_A2, ["config.read"]);
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(STORE_A1, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    const schedule = makeBatcher(box, STORE_A1);

    productionPushOnFields(STORE_A1, specA1, specA2, { a: "nope" }, schedule);
    productionPushOnFields(STORE_A1, specA1, specA1, { a: "refresh" }, schedule);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "refresh" });
    box.unload();
  });
});

describe("plugin sandbox config push guards", () => {
  it("mayPushSandboxOnPluginChange blocks cross-store edits", () => {
    expect.hasAssertions();
    const spec = frontendSpec(STORE_A1, ["config.read"]);
    expect(mayPushSandboxOnPluginChange(STORE_A1, STORE_A2, spec)).toBe(false);
    expect(mayPushSandboxOnPluginChange(STORE_A1, STORE_A1, spec)).toBe(true);
  });
});
