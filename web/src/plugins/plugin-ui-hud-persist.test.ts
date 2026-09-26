import { describe, expect, it } from "vitest";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields, setPluginHudCaptionSink } from "./plugin-ui";

describe("plugin UI HUD persist order", () => {
  it("writes caption to sink before onPersist runs", () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const host = document.createElement("div");
    document.body.append(host);
    let sinkCaption: string | null = null;
    let persistCaption: string | null = "unset";
    setPluginHudCaptionSink((_spec, caption) => { sinkCaption = caption; });
    fillPluginFields(host, spec, fields, () => {
      persistCaption = sinkCaption;
    });
    host.querySelector<HTMLButtonElement>('[data-toolbar-action="randomise"]')?.click();
    expect(persistCaption).not.toBe("unset");
    expect(persistCaption).toBeTruthy();
  });
});
