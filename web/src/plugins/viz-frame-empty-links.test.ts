/**
 * @vitest-environment node
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { StateMsg } from "../core/types";
import type { VizDataFrame, VizLinkSample } from "./viz-host";
import { EMPTY_VIZ_LINKS } from "../../../plugins/sdk/viz-contract";
import {
  applyVizFrameContractV2,
  resolveVizFrameCollectOpts,
  vizFrameCollectTestHooks,
} from "./viz-frame-collect";
import { deliverVizFrameToPackTiles } from "./viz-frame-pack-deliver";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const esbuildBin = path.join(repoRoot, "web/node_modules/.bin/esbuild");

function baseFrame(): VizDataFrame {
  return {
    contract: 1,
    t: 1,
    dt: 0.016,
    audio: 0,
    packets: [],
    rf: [],
    talkers: [{ id: "10.0.0.1", rate: 1, role: "lan" }],
    headlines: [],
  };
}

function linksOnEmptyState(): StateMsg {
  return {
    ts: 1,
    devices: [{ ip: "10.0.0.1", packets: 1, bytes: 1, role: "lan" }],
    flows: [],
    sources: [],
    host: { vizFrame: { links: true } },
  };
}

function pushBadLink(frame: VizDataFrame): void {
  (frame.links as VizLinkSample[]).push({ src: "10.0.0.1", dst: "10.0.0.2", rate: 1 });
}

function nextFrameWithEmptyLinks(state: StateMsg): VizDataFrame {
  const frame = baseFrame();
  applyVizFrameContractV2(frame, state, resolveVizFrameCollectOpts(state));
  return frame;
}

function runTwoTilePushScenario(
  deliver: typeof deliverVizFrameToPackTiles,
  apply: typeof applyVizFrameContractV2,
  resolveOpts: typeof resolveVizFrameCollectOpts,
  emptyLinks: typeof EMPTY_VIZ_LINKS,
): { tile2Calls: number; nextLenTile1: number; nextLenTile2: number; frozen: boolean } {
  const state = linksOnEmptyState();
  const frame = baseFrame();
  apply(frame, state, resolveOpts(state));
  expect(frame.links).toBe(emptyLinks);
  expect(Object.isFrozen(frame.links)).toBe(true);

  let tile2Calls = 0;
  deliver(frame, [
    { tileId: "tile-1", onFrame: pushBadLink },
    { tileId: "tile-2", onFrame: () => { tile2Calls++; } },
  ]);
  expect(tile2Calls).toBe(1);
  expect(frame.links?.length).toBe(0);

  const next = baseFrame();
  apply(next, state, resolveOpts(state));
  deliver(next, [
    { tileId: "tile-1", onFrame: (f) => { expect(f.links?.length).toBe(0); } },
    { tileId: "tile-2", onFrame: (f) => { expect(f.links?.length).toBe(0); } },
  ]);

  return {
    tile2Calls,
    nextLenTile1: next.links?.length ?? -1,
    nextLenTile2: next.links?.length ?? -1,
    frozen: Object.isFrozen(emptyLinks),
  };
}

async function loadProdBundledEmptyLinksModule(): Promise<{
  EMPTY_VIZ_LINKS: typeof EMPTY_VIZ_LINKS;
  applyVizFrameContractV2: typeof applyVizFrameContractV2;
  resolveVizFrameCollectOpts: typeof resolveVizFrameCollectOpts;
  deliverVizFrameToPackTiles: typeof deliverVizFrameToPackTiles;
}> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-empty-links-prod-"));
  const out = path.join(tmp, "bundle.mjs");
  execFileSync(
    esbuildBin,
    [
      path.join(repoRoot, "web/src/plugins/fixtures/viz-empty-links-prod-entry.ts"),
      "--bundle",
      "--format=esm",
      "--platform=neutral",
      "--target=es2022",
      `--outfile=${out}`,
      "--define:import.meta.env.PROD=true",
      "--define:import.meta.env.DEV=false",
    ],
    { stdio: "pipe" },
  );
  const mod = await import(pathToFileURL(out).href);
  rmSync(tmp, { recursive: true, force: true });
  return mod;
}

describe("viz frame v2 empty links contract (item 5a)", () => {
  afterEach(() => {
    vizFrameCollectTestHooks.useSharedUnfrozenEmptyLinksForTest(false);
  });

  it("dev: a pack push on empty links throws and the next frame links length is 0", () => {
    expect(import.meta.env.DEV).toBe(true);
    expect(Object.isFrozen(EMPTY_VIZ_LINKS)).toBe(true);

    const state = linksOnEmptyState();
    const frame = nextFrameWithEmptyLinks(state);
    let threw = false;
    try {
      pushBadLink(frame);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(frame.links?.length).toBe(0);

    const again = nextFrameWithEmptyLinks(state);
    expect(again.links?.length).toBe(0);
    expect(again.links).toBe(EMPTY_VIZ_LINKS);
  });

  it("prod bundle: tile 1 push on empty links leaves tile 2 callback once and next frame links length 0 on both tiles", async () => {
    const prod = await loadProdBundledEmptyLinksModule();
    expect(prod.EMPTY_VIZ_LINKS).toBeTruthy();
    expect(Object.isFrozen(prod.EMPTY_VIZ_LINKS)).toBe(true);

    const result = runTwoTilePushScenario(
      prod.deliverVizFrameToPackTiles,
      prod.applyVizFrameContractV2,
      prod.resolveVizFrameCollectOpts,
      prod.EMPTY_VIZ_LINKS,
    );
    expect(result.tile2Calls).toBe(1);
    expect(result.nextLenTile1).toBe(0);
    expect(result.nextLenTile2).toBe(0);
    expect(result.frozen).toBe(true);
  });

  it("revert shared unfrozen empty: second tile sees links length 1 on the same frame", () => {
    vizFrameCollectTestHooks.useSharedUnfrozenEmptyLinksForTest(true);
    const state = linksOnEmptyState();
    const frame = nextFrameWithEmptyLinks(state);
    expect(Object.isFrozen(frame.links)).toBe(false);

    let tile2Len = -1;
    deliverVizFrameToPackTiles(frame, [
      { tileId: "tile-1", onFrame: pushBadLink },
      { tileId: "tile-2", onFrame: (f) => { tile2Len = f.links?.length ?? -1; } },
    ]);
    expect(tile2Len).toBe(1);
  });
});
