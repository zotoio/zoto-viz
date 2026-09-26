import { afterEach, describe, expect, it } from "vitest";
import { PluginSandbox } from "../plugins/host";
import { defaultVizContract } from "../plugins/viz-host";
import {
  capturePresentDriveBeforeLiveModeCommit,
  getPresentDriveTileId,
  refreshPluginDriveState,
  restorePresentDriveAfterModeRollback,
} from "./present-drive-app";

const backrooms = { id: "backrooms", viz: defaultVizContract({ presentTick: true }) } as const;
const stereo = { id: "stereo-gram", viz: defaultVizContract({ presentTick: true }) } as const;

function deps(sandbox: PluginSandbox) {
  return {
    sandbox,
    pluginClock: () => 0,
    stageAspect: () => 16 / 9,
  };
}

describe("applyMode present-drive rollback (present-drive-app)", () => {
  afterEach(() => {
    document.querySelectorAll("iframe").forEach((el) => el.remove());
  });

  it("restores the prior pack tileId after a declined mode switch", () => {
    const sandbox = new PluginSandbox();
    const d = deps(sandbox);
    refreshPluginDriveState(backrooms, "plugin:backrooms", d);
    expect(getPresentDriveTileId()).toBe("backrooms");

    const prevMode = "plugin:backrooms";
    const { prevPresentSpec, prevPresentMode } = capturePresentDriveBeforeLiveModeCommit(prevMode);
    refreshPluginDriveState(stereo, "plugin:stereo-gram", d);
    expect(getPresentDriveTileId()).toBe("stereo-gram");

    restorePresentDriveAfterModeRollback(
      prevPresentSpec,
      prevPresentMode,
      "plugin:stereo-gram",
      (id) => (id === "plugin:backrooms" ? backrooms : stereo),
      d,
    );
    expect(getPresentDriveTileId()).toBe("backrooms");
  });

  it("fails if prevPresentMode is captured after liveMode advances (Bugbot 4111987406)", () => {
    const sandbox = new PluginSandbox();
    const d = deps(sandbox);
    refreshPluginDriveState(backrooms, "plugin:backrooms", d);

    const prevMode = "plugin:backrooms";
    const buggyPrevPresentMode = "plugin:stereo-gram";
    const { prevPresentSpec } = capturePresentDriveBeforeLiveModeCommit(prevMode);
    refreshPluginDriveState(stereo, "plugin:stereo-gram", d);

    restorePresentDriveAfterModeRollback(
      prevPresentSpec,
      buggyPrevPresentMode,
      "plugin:stereo-gram",
      (id) => (id === "plugin:backrooms" ? backrooms : stereo),
      d,
    );
    expect(getPresentDriveTileId()).not.toBe("backrooms");
  });

  it("restores present drive when mosaic setPaneView would fail (Bugbot 4111907051)", () => {
    const sandbox = new PluginSandbox();
    const d = deps(sandbox);
    refreshPluginDriveState(backrooms, "plugin:backrooms", d);
    const prevMode = "plugin:backrooms";
    const { prevPresentSpec, prevPresentMode } = capturePresentDriveBeforeLiveModeCommit(prevMode);
    refreshPluginDriveState(stereo, "plugin:stereo-gram", d);

    restorePresentDriveAfterModeRollback(
      prevPresentSpec,
      prevPresentMode,
      prevMode,
      (id) => (id === "plugin:backrooms" ? backrooms : stereo),
      d,
    );
    expect(getPresentDriveTileId()).toBe("backrooms");
  });
});
