import { describe, expect, it, vi } from "vitest";
import { mockPartial } from "../../test-support/mock-partial";
import type { PluginView } from "../plugins/plugin";
import { paneSandboxGaps, TileSandboxes, type TileSandboxLike } from "./tile-sandboxes";

/**
 * #235 (graph.read per tile): a graph.read pack (lan-pulse, pulse-ts) gets a pane sandbox of its own,
 * and each graph refresh reaches it, so its pane no longer waits on the "Preview only" label until
 * `look` is clicked. Reverts: the graph-read gap in paneSandboxGaps; the tileSandboxes.tick call in main.ts.
 */

const LAN_PULSE = mockPartial<PluginView>({
  id: "lan-pulse",
  name: "LAN Pulse",
  hash: "h-lan-pulse",
  has_frontend: true,
  capabilities: ["graph.read", "graph.style", "ui.overlay"],
});

const NODES = [{ id: "10.0.0.2", rate: 4, role: "lan" }];

type GraphNodes = readonly { id: string; rate: number; role: string }[];

/** A pane sandbox stand-in that records every graph tick it receives. */
function stubSandbox(ticks: GraphNodes[]): TileSandboxLike {
  return mockPartial<TileSandboxLike>({
    readyPack: "",
    setActiveTile: vi.fn(),
    frame: vi.fn(),
    unload: vi.fn(),
    tick: (nodes: GraphNodes) => {
      ticks.push(nodes);
    },
  });
}

describe("#235: graph.read reaches each pane's own sandbox", () => {
  it("graph.read is no longer a pane sandbox gap", () => {
    expect(paneSandboxGaps(LAN_PULSE)).toEqual([]);
  });

  it("a graph.read pack's pane owns its sandbox, and a graph refresh reaches that sandbox", async () => {
    const ticksByPane: GraphNodes[][] = [];
    const tiles = new TileSandboxes<TileSandboxLike>({
      main: stubSandbox([]),
      create: () => {
        const ticks: GraphNodes[] = [];
        ticksByPane.push(ticks);
        return stubSandbox(ticks);
      },
      drivenTile: () => "topology",
      target: () => null,
      mayLoad: () => true,
      attach: async () => {},
    });

    await tiles.sync([{ id: "plugin:lan-pulse!1", spec: LAN_PULSE }]);
    await Promise.resolve();

    expect(tiles.owns("plugin:lan-pulse!1", LAN_PULSE)).toBe(true);
    expect(tiles.previewOnly("plugin:lan-pulse!1", LAN_PULSE)).toBe(false);

    tiles.tick(NODES);
    expect(ticksByPane.length).toBeGreaterThan(0);
    for (const ticks of ticksByPane) expect(ticks).toEqual([NODES]);
  });
});
