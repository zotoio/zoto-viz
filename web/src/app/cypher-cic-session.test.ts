import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCypherCicPanelSession,
  applyProductionChatHeaderToggle,
  applyProductionFeedHeaderToggle,
  type CypherCicPanelSessionHolder,
} from "./cypher-cic-panels";
import { Settings } from "../ui/settings";

describe("cypher-cic applyCypherCicPanelSession (R10/R11)", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it("collapse and restore: restored feed matches last saved value exactly", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    localStorage.setItem(`${prefix}.chat.on`, "0");
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    const holder: CypherCicPanelSessionHolder = { session: null };
    applyCypherCicPanelSession(holder, settings, { pluginId: "cypher-cic" });
    expect(settings.feedSettings.on).toBe(false);
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    applyCypherCicPanelSession(holder, settings, { pluginId: "lan" });
    expect(settings.feedSettings.on).toBe(true);
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    expect(settings.chatSettings.on).toBe(false);
  });

  it("chat leak: chat toggled during session persists saved chat value on leave", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    localStorage.setItem(`${prefix}.chat.on`, "0");
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    const holder: CypherCicPanelSessionHolder = { session: null };
    applyCypherCicPanelSession(holder, settings, { pluginId: "cypher-cic" });
    applyProductionChatHeaderToggle(settings);
    expect(settings.chatSettings.on).toBe(true);
    expect(localStorage.getItem(`${prefix}.chat.on`)).toBe("0");
    applyCypherCicPanelSession(holder, settings, { pluginId: "lan" });
    expect(settings.chatSettings.on).toBe(false);
    expect(localStorage.getItem(`${prefix}.chat.on`)).toBe("0");
  });

  it("header f during cypher-cic persists feed exactly once via production toggle", () => {
    const prefix = "zoto-viz.test";
    localStorage.setItem(`${prefix}.feed.on`, "1");
    const settings = new Settings({ storePrefix: prefix, onChange: () => {} });
    const holder: CypherCicPanelSessionHolder = { session: null };
    applyCypherCicPanelSession(holder, settings, { pluginId: "cypher-cic" });
    expect(settings.feedSettings.on).toBe(false);
    applyProductionFeedHeaderToggle(settings);
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
    applyCypherCicPanelSession(holder, settings, { pluginId: "lan" });
    expect(settings.feedSettings.on).toBe(true);
    expect(localStorage.getItem(`${prefix}.feed.on`)).toBe("1");
  });
});
