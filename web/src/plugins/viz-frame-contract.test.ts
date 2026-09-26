import { describe, expect, it } from "vitest";
import type { VizDataFrame as HostFrame } from "./viz-host";
import type { VizDataFrame as PackFrame } from "../../../plugins/src/viz-frame";
import { buildIdleVizFrame } from "./fixtures/idle-viz-frame";

/** Pack `viz-frame.ts` must stay assignable to the host frame (no invented fields). */
describe("viz.read real data contract", () => {
  it("host idle frame satisfies pack VizDataFrame", () => {
    const host: HostFrame = buildIdleVizFrame(0);
    const pack: PackFrame = host;
    expect(pack.talkers[0]).toMatchObject({ id: expect.any(String), rate: expect.any(Number), role: expect.any(String) });
    expect(pack.packets[0]).toMatchObject({ proto: expect.any(String), size: expect.any(Number), field: expect.any(Number) });
    expect(pack.sys?.failed).toBe(0);
  });
});
