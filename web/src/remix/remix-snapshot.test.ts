import { describe, expect, it } from "vitest";
import { mergeDemoSnapshotIntoFrame } from "./remix-snapshot";
import type { DemoSnapshotPayload } from "./remix-types";
import { monoMs } from "../core/viz-time";

describe("mergeDemoSnapshotIntoFrame", () => {
  it("marks frame demo and applies headline slice", () => {
    const payload: DemoSnapshotPayload = {
      demo: true,
      label: "DEMO SNAPSHOT",
      vizFrame: {
        headlines: [
          { id: "hn:1", label: "HN", text: "DEMO story", kind: "demo" },
        ],
      },
    };
    const frame = mergeDemoSnapshotIntoFrame(payload, monoMs(1000), 0.2);
    expect(frame.demo).toBe(true);
    expect(frame.headlines[0]?.text).toBe("DEMO story");
    expect(frame.demoSlices?.headlines).toBe(true);
  });
});
