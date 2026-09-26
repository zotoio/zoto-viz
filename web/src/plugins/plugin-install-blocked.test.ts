import { describe, expect, it } from "vitest";
import { compilePlugin } from "./plugin";
import { toPluginView } from "./plugin-visualisation";
import {
  formatInstallBlockedMessage,
  installBlockedUserMessage,
  pluginTileDraws,
} from "./plugin-install-blocked";
import type { PaneStartupSnap } from "../graph/pane-health";

describe("formatInstallBlockedMessage", () => {
  it("uses #35 wording naming the blocked and running versions", () => {
    expect(formatInstallBlockedMessage(2, 1)).toBe("v2 was blocked; v1 is still running");
  });
});

describe("installBlockedUserMessage", () => {
  it("returns the server message for install_blocked", () => {
    expect(installBlockedUserMessage({
      ok: false,
      error: "install_blocked",
      message: "v2 was blocked; v1 is still running",
      blockedVersion: 2,
      runningVersion: 1,
    })).toBe("v2 was blocked; v1 is still running");
  });

  it("rebuilds the message from version fields when message is omitted", () => {
    expect(installBlockedUserMessage({
      ok: false,
      error: "install_blocked",
      blockedVersion: 2,
      runningVersion: 1,
    })).toBe("v2 was blocked; v1 is still running");
  });
});

describe("pluginTileDraws", () => {
  const base: PaneStartupSnap = {
    id: "plugin:keep-pack",
    kind: "graph",
    bound: true,
    stageOnly: false,
    backdrop: "aurora",
    pluginSkyId: null,
    pluginSkyWanted: false,
    nodes: 12,
    hasSnapshot: true,
  };

  it("reports a healthy graph tile as drawing", () => {
    expect(pluginTileDraws(base)).toBe(true);
  });

  it("reports an unbound tile as not drawing", () => {
    expect(pluginTileDraws({ ...base, bound: false })).toBe(false);
  });

  it("v1 graph catalog mode still compiles for mosaic tile startup", () => {
    const mode = compilePlugin(toPluginView({
      id: "keep-pack",
      name: "Keep",
      version: 1,
      visualisation: { engine: "graph", base: "topology" },
    }));
    expect(mode.pluginId).toBe("keep-pack");
    const snap: PaneStartupSnap = {
      ...base,
      id: mode.id,
      kind: "graph",
      stageOnly: Boolean(mode.stageOnly),
    };
    expect(pluginTileDraws(snap)).toBe(true);
  });
});
