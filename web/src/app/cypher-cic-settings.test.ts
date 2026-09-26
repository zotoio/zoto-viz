import { beforeEach, describe, expect, it } from "vitest";
import { Settings } from "../ui/settings";

describe("cypher-cic saved settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("leaves persisted feed and chat toggles unchanged after session-only collapse", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    localStorage.setItem(`${prefix}.chat.on`, "1");
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    settings.setFeedOn(false, { persist: false });
    settings.setChatOn(false, { persist: false });
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    expect(localStorage.getItem(`${prefix}.chat.on`)).toBe("1");
    settings.setFeedOn(true, { persist: false });
    settings.setChatOn(true, { persist: false });
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    expect(localStorage.getItem(`${prefix}.chat.on`)).toBe("1");
  });
});
