import { describe, expect, it } from "vitest";
import { parseHostMeshInstances } from "./host-mesh-lane";

describe("host mesh lane", () => {
  it("parses instance matrices from a buffer slot", () => {
    const data = new Array(16).fill(0);
    data[0] = 1;
    data[5] = 1;
    data[10] = 1;
    data[15] = 1;
    const frame = parseHostMeshInstances("cube", data);
    expect(frame?.assetId).toBe("cube");
    expect(frame?.matrices.length).toBe(16);
  });
});
