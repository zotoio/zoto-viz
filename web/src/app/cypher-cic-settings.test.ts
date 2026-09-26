import { beforeEach, describe, expect, it } from "vitest";
import { Settings } from "../ui/settings";

/** Legacy direct-Settings rows — superseded by `cypher-cic-session.test.ts` (R10/R11). */
describe("cypher-cic saved settings (legacy)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it.skip("leaves persisted feed and chat toggles unchanged after session-only collapse", () => {
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

  it.skip("row 1: other feed settings persist during collapse without clobbering saved on toggles", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    localStorage.setItem(`${prefix}.chat.on`, "1");
    localStorage.setItem(`${prefix}.feed.layout`, "list");
    const snap = new Map<string, string | null>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      snap.set(key, localStorage.getItem(key));
    }
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    settings.setCypherCicPanelCollapsed(true);
    settings.setFeedOn(false, { persist: false });
    settings.setChatOn(false, { persist: false });
    settings.applyFeed({ ...settings.feedSettings, layout: "grid" });
    settings.setCypherCicPanelCollapsed(false);
    settings.setFeedOn(settings.readPersistedFeedOn(), { persist: false });
    settings.setChatOn(settings.readPersistedChatOn(), { persist: false });
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    expect(localStorage.getItem(`${prefix}.chat.on`)).toBe("1");
    expect(localStorage.getItem(`${prefix}.feed.layout`)).toBe("grid");
    expect(settings.feedSettings.on).toBe(true);
    expect(settings.chatSettings.on).toBe(true);
  });

  it.skip("row 2: header f-key toggle persists once during cypher-cic and restores after leave", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    settings.setCypherCicPanelCollapsed(true);
    settings.setFeedOn(false, { persist: false });
    settings.setFeedOn(false, { persist: true });
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("0");
    settings.setCypherCicPanelCollapsed(false);
    settings.setFeedOn(settings.readPersistedFeedOn(), { persist: false });
    expect(settings.feedSettings.on).toBe(false);
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("0");
  });
});
