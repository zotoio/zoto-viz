import { describe, expect, it } from "vitest";
import { SHIPPED_ID, USER_ID, normalizeSettings, quiet, shippedSettings, suggestId } from "./profiles";

describe("profiles", () => {
  it("ships netviz and fills defaults", () => {
    expect(SHIPPED_ID).toBe("netviz");
    const s = shippedSettings();
    expect(s.mode).toBe("topology");
    expect(s.chrome).toBe("top");
    expect(s.show.lan).toBe(true);
  });

  it("normalizes partial blobs and suggests ids", () => {
    const n = normalizeSettings({
      theme: "matrix", dream: true, chrome: "left", merge: true, redact: true,
      show: { lan: false }, filters: { allowNames: "nest" }, arcade: { a: "1" }, plugins: { p: { k: "v" } },
    });
    expect(n.theme).toBe("matrix");
    expect(n.dream).toBe(true);
    expect(n.chrome).toBe("left");
    expect(n.show.lan).toBe(false);
    expect(n.show.internet).toBe(true);
    expect(n.filters.allowNames).toBe("nest");
    expect(n.arcade.a).toBe("1");
    expect(normalizeSettings(null).theme).toBe(shippedSettings().theme);
    expect(quiet(() => 7)).toBe(7);
    expect(suggestId([])).toBe(USER_ID);
    expect(suggestId([USER_ID])).toBe("user-2");
    expect(suggestId([USER_ID, ...Array.from({ length: 98 }, (_, i) => `user-${i + 2}`)])).toMatch(/^user-/);
  });
});
