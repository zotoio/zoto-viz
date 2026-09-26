/**
 * @vitest-environment node
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { StateMsg } from "../core/types";
import type { VizDataFrame, VizLinkSample } from "./viz-host";
import { EMPTY_VIZ_LINKS } from "../../../plugins/sdk/viz-contract";
import { applyVizFrameContractV2, resolveVizFrameCollectOpts } from "./viz-frame-collect";
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

  it("prod bundle: shared EMPTY_VIZ_LINKS stays frozen and push on empty links throws", async () => {
    const prod = await loadProdBundledEmptyLinksModule();
    expect(Object.isFrozen(prod.EMPTY_VIZ_LINKS)).toBe(true);

    const state = linksOnEmptyState();
    const frame = baseFrame();
    prod.applyVizFrameContractV2(frame, state, prod.resolveVizFrameCollectOpts(state));
    expect(frame.links).toBe(prod.EMPTY_VIZ_LINKS);

    let threw = false;
    try {
      pushBadLink(frame);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(frame.links?.length).toBe(0);
  });

  it("dev: tile 1 push on empty links leaves tile 2 callback exactly once", () => {
    const state = linksOnEmptyState();
    const frame = nextFrameWithEmptyLinks(state);
    let tile2Calls = 0;
    try {
      deliverVizFrameToPackTiles(frame, [
        { tileId: "tile-1", onFrame: pushBadLink },
        { tileId: "tile-2", onFrame: () => { tile2Calls++; } },
      ]);
    } catch {
      /* outer host tick may still observe partial delivery; tile 2 must have run */
    }
    expect(tile2Calls).toBe(1);
    expect(frame.links?.length).toBe(0);

    const next = nextFrameWithEmptyLinks(state);
    expect(next.links?.length).toBe(0);
  });

  it("prod bundle: tile 1 push on empty links leaves tile 2 callback exactly once", async () => {
    const prod = await loadProdBundledEmptyLinksModule();
    const state = linksOnEmptyState();
    const frame = baseFrame();
    prod.applyVizFrameContractV2(frame, state, prod.resolveVizFrameCollectOpts(state));

    let tile2Calls = 0;
    prod.deliverVizFrameToPackTiles(frame, [
      { tileId: "tile-1", onFrame: pushBadLink },
      { tileId: "tile-2", onFrame: () => { tile2Calls++; } },
    ]);
    expect(tile2Calls).toBe(1);
    expect(frame.links?.length).toBe(0);

    const next = baseFrame();
    prod.applyVizFrameContractV2(next, state, prod.resolveVizFrameCollectOpts(state));
    expect(next.links?.length).toBe(0);
  });
});
