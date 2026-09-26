import { describe, expect, it, vi } from "vitest";
import { SERVER_RESTART_WALL_NOTICE } from "./plugin-copy";
import { runPackAssetProtectedLoad } from "./pack-asset-rebuild";
import { PackAssetForbiddenError } from "../core/http";
import { resetPackAssetFrameState } from "./pack-asset-frame";

describe("wall notice on secret rotation", () => {
  it("shows one wall notice when two tiles hit a 403 rebuild", async () => {
    resetPackAssetFrameState();
    const mosaic = { setPaneNotice: vi.fn(), setWallNotice: vi.fn() };
    const load = async () => {
      throw new PackAssetForbiddenError("demo");
    };
    await runPackAssetProtectedLoad("plugin:a", "A", mosaic, load, { serverRestart: true }).catch(() => {});
    await runPackAssetProtectedLoad("plugin:b", "B", mosaic, load, { serverRestart: true }).catch(() => {});
    expect(mosaic.setWallNotice).toHaveBeenCalledTimes(1);
    expect(mosaic.setWallNotice.mock.calls[0]?.[0]).toBe(SERVER_RESTART_WALL_NOTICE);
  });
});
