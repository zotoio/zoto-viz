import { describe, expect, it } from "vitest";
import { pluginSpecForStoreId } from "./plugin";

describe("plugin barrel exports", () => {
  it("re-exports pluginSpecForStoreId for main.ts config sync", () => {
    expect.hasAssertions();
    expect(typeof pluginSpecForStoreId).toBe("function");
  });
});
