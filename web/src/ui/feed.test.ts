import { describe, expect, it } from "vitest";
import { DEFAULT_FEED, FEED_LAYOUTS, FEED_SCOPES } from "./feed";

describe("feed defaults", () => {
  it("is on with shipped layouts", () => {
    expect(DEFAULT_FEED.on).toBe(true);
    expect(FEED_LAYOUTS.map((o) => o.value)).toEqual(["ticker", "bars", "both"]);
    expect(FEED_SCOPES.map((o) => o.value)).toContain("lan");
  });
});
