import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPackAssetTokenForTests } from "../core/http";
import * as packAssetFrame from "./pack-asset-frame";
import {
  allowOnPluginChangeConfigPush,
  allowOnPluginFieldsConfigPush,
} from "./plugin-config-sync";
import { PluginSandbox } from "./host";

const PACK_A = "pack-a";
const PACK_B = "pack-b";
const PACK_A_TILE1 = "pack-a:tile-a1";
const PACK_A_TILE2 = "pack-a:tile-a2";

type ConfigPost = { type: string; config: Record<string, string> };

function createConfigPostTap(box: PluginSandbox): { posted: ConfigPost[]; rehook: () => void } {
  const posted: ConfigPost[] = [];
  const rehook = () => {
    const port = box.sandboxHostPort();
    if (!port) return;
    const orig = port.postMessage.bind(port);
    port.postMessage = (data, transfer) => {
      const msg = data as { type?: string; config?: Record<string, string> };
      if (msg?.type === "config" && msg.config) posted.push({ type: msg.type, config: msg.config });
      orig(data, transfer);
    };
  };
  return { posted, rehook };
}

function tryOnPluginChangePush(
  box: PluginSandbox,
  loadedStoreId: string | null,
  editStoreId: string,
  values: Record<string, string>,
  configRead: boolean,
): void {
  if (!allowOnPluginChangeConfigPush(loadedStoreId, editStoreId, configRead)) return;
  box.setConfig(values);
}

function tryOnPluginFieldsPush(
  box: PluginSandbox,
  loadedStoreId: string | null,
  iframeStoreId: string,
  values: Record<string, string>,
  configRead: boolean,
): void {
  if (!allowOnPluginFieldsConfigPush(loadedStoreId, iframeStoreId, configRead)) return;
  box.setConfig(values);
}

describe("plugin sandbox config push guards", () => {
  beforeEach(() => {
    vi.spyOn(packAssetFrame, "openPackAssetFrame").mockResolvedValue("11111111-1111-4111-8111-111111111111");
    vi.spyOn(packAssetFrame, "closePackAssetFrameForTile").mockResolvedValue();
    setPackAssetTokenForTests("_sandbox", "tok-config-push");
  });

  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
    vi.restoreAllMocks();
    setPackAssetTokenForTests("_sandbox", "");
  });

  it("onPluginChange path: edit pack A yields 0 posts to B and 1 to A", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_B, "globalThis.ok = true;", ["config.read"], { b: "0" });
    tap.rehook();

    tryOnPluginChangePush(box, PACK_B, PACK_A, { a: "1" }, true);
    expect(tap.posted.length).toBe(0);

    box.unload();
    await box.load(PACK_A, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    tryOnPluginChangePush(box, PACK_A, PACK_A, { a: "2" }, true);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "2" });
    box.unload();
  });

  it("onPluginFields path: refresh pack A yields 0 posts to B and 1 to A", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_B, "globalThis.ok = true;", ["config.read"], { b: "0" });
    tap.rehook();

    tryOnPluginFieldsPush(box, PACK_B, PACK_A, { a: "1" }, true);
    expect(tap.posted.length).toBe(0);

    box.unload();
    await box.load(PACK_A, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();
    tryOnPluginFieldsPush(box, PACK_A, PACK_A, { a: "3" }, true);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "3" });
    box.unload();
  });

  it("onPluginChange path: edit instance A1 yields 0 posts to A2 or B and 1 to A1", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_A_TILE1, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();

    tryOnPluginChangePush(box, PACK_A_TILE1, PACK_A_TILE2, { a: "1" }, true);
    tryOnPluginChangePush(box, PACK_A_TILE1, PACK_B, { b: "1" }, true);
    expect(tap.posted).toHaveLength(0);

    tryOnPluginChangePush(box, PACK_A_TILE1, PACK_A_TILE1, { a: "tile-a1-val" }, true);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "tile-a1-val" });
    box.unload();
  });

  it("onPluginFields path: refresh instance A1 yields 0 posts to A2 or B and 1 to A1", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_A_TILE1, "globalThis.ok = true;", ["config.read"], { a: "0" });
    tap.rehook();

    tryOnPluginFieldsPush(box, PACK_A_TILE1, PACK_A_TILE2, { a: "1" }, true);
    tryOnPluginFieldsPush(box, PACK_A_TILE1, PACK_B, { b: "1" }, true);
    expect(tap.posted).toHaveLength(0);

    tryOnPluginFieldsPush(box, PACK_A_TILE1, PACK_A_TILE1, { a: "tile-a1-refresh" }, true);
    expect(tap.posted).toHaveLength(1);
    expect(tap.posted[0]!.config).toEqual({ a: "tile-a1-refresh" });
    box.unload();
  });

  it("onPluginChange path: no config.read yields 0 posts", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_A, "globalThis.ok = true;", ["graph.read"], { a: "0" });
    tap.rehook();
    tryOnPluginChangePush(box, PACK_A, PACK_A, { a: "2" }, false);
    expect(tap.posted).toHaveLength(0);
    box.unload();
  });

  it("onPluginFields path: no config.read yields 0 posts", async () => {
    expect.hasAssertions();
    const box = new PluginSandbox();
    const tap = createConfigPostTap(box);
    await box.load(PACK_A, "globalThis.ok = true;", ["graph.read"], { a: "0" });
    tap.rehook();
    tryOnPluginFieldsPush(box, PACK_A, PACK_A, { a: "2" }, false);
    expect(tap.posted).toHaveLength(0);
    box.unload();
  });
});
