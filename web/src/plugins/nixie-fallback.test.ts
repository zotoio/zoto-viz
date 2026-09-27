import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatNixieFallbackLine,
  parseNixieLook,
} from "../../../plugins/src/nixie-clock/frontend/tubes";

describe("nixie shader fallback text", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("nixie-text", () => {
    vi.useFakeTimers({ now: new Date(2026, 0, 1, 1, 5, 0, 0) });
    const look24sec = parseNixieLook({ format: "24", seconds: "1" });
    const look12 = parseNixieLook({ format: "12", seconds: "0" });
    const scratch = { h: 0, m: 0, s: 0 };
    const cache = { key: -1, text: "" };
    const now = new Date();
    now.setTime(Date.now());
    expect(formatNixieFallbackLine(now, look24sec, scratch, cache)).toBe("01 05 00");
    vi.setSystemTime(new Date(2026, 0, 1, 1, 5, 30, 0));
    now.setTime(Date.now());
    const cacheNoSec = { key: -1, text: "" };
    expect(formatNixieFallbackLine(now, parseNixieLook({ format: "24", seconds: "0" }), scratch, cacheNoSec))
      .toBe("01 05");
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 0));
    now.setTime(Date.now());
    expect(formatNixieFallbackLine(now, look12, scratch, { key: -1, text: "" })).toBe("12 00");
    vi.useRealTimers();
  });
});
