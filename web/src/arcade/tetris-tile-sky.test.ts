import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NetScene } from "../graph/scene";
import { mockPartial } from "../../test-support/mock-partial";
import { NetScene as NetSceneCtor } from "../graph/scene";
import { bindTetrisStandaloneHost, TETRIS_TILE_BACKDROP } from "./tetris-standalone-host";
import { TetrisView } from "./tetris";

/** Lit Stage3D well: hemisphere + key + rim, themed fog (not flat grey). */
const EXPECTED_WELL_LIT_SIGNATURE = "lights:3,bg:none,fog:0b1220";

function mockScene(): NetScene {
  return mockPartial<NetScene>({
    pulseNow: mockPartial<NetScene["pulseNow"]>({ level: 0 }),
    selectedIp: "",
    deviceOf: () => undefined,
    selectIp: () => {},
  });
}

describe("Tetris standalone tile sky", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  const hosts: HTMLElement[] = [];

  afterEach(() => {
    for (const h of hosts) h.remove();
    hosts.length = 0;
  });

  it("well stage keeps lit sky signature while graph idles", () => {
    const sceneEl = document.createElement("div");
    sceneEl.style.width = "640px";
    sceneEl.style.height = "480px";
    Object.defineProperty(sceneEl, "clientWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(sceneEl, "clientHeight", { configurable: true, get: () => 480 });
    document.body.append(sceneEl);
    hosts.push(sceneEl);
    const host = document.createElement("div");
    host.style.width = "400px";
    host.style.height = "300px";
    Object.defineProperty(host, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 300 });
    document.body.append(host);
    hosts.push(host);
    const graph = new NetSceneCtor(sceneEl);
    const view = new TetrisView(host, mockScene());
    view.start();
    bindTetrisStandaloneHost(graph, view);
    expect(view.testWellLitSkySignature()).toBe(EXPECTED_WELL_LIT_SIGNATURE);
    expect(graph.testFarFieldLitSkyToken()).toBe(`lit:${TETRIS_TILE_BACKDROP}`);
  });
});
