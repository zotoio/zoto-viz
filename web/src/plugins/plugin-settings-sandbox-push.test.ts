import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { handleSandboxHostMessage, type SandboxZoto } from "./sandbox-frame";
import { loadSettingsDeclFixture } from "./test/load-settings-fixture";
import { fillPluginFields } from "./plugin-ui";
import { configStoreId } from "./plugin";

describe("settings-fixture config reaches sandbox onConfig", () => {
  beforeEach(() => localStorage.clear());

  it("pushes each field type through persist → config message shape", async () => {
    const spec = loadSettingsDeclFixture();
    const fields = spec.config ?? [];
    const host = document.createElement("div");
    document.body.append(host);
    const configs: Record<string, string>[] = [];
    const api: SandboxZoto = {
      onTick: null,
      onConfig: (c) => configs.push({ ...c }),
      onFrame: null,
      onPresent: null,
      setStyle: () => {},
      setNodeColor: () => {},
      writeBuffer: () => {},
      writeUniform: () => {},
      writeParticles: () => {},
      getConfig: () => configs.at(-1) ?? {},
    };
    fillPluginFields(host, spec, fields, (id, values) => {
      handleSandboxHostMessage(
        { source: "zoto-viz-host", type: "config", config: values },
        new Set(["config.read"]),
        api,
      );
    });

    const locked = host.querySelector<HTMLInputElement>('[data-field-key="locked"] input[type="range"]')!;
    locked.value = "0";
    locked.dispatchEvent(new Event("input", { bubbles: true }));
    const gain = host.querySelector<HTMLElement>('[data-field-key="gain"] input') as HTMLInputElement;
    gain.value = "0";
    gain.dispatchEvent(new Event("input", { bubbles: true }));
    const modeWrap = host.querySelector('[data-field-key="mode"]')!;
    const modeBtn = modeWrap.querySelector<HTMLButtonElement>("button.field-btn")!;
    await userEvent.click(modeBtn);
    const menuId = modeBtn.getAttribute("aria-controls")!;
    const modeY = document.getElementById(menuId)!.querySelector<HTMLElement>('li[data-value="y"]')!;
    await userEvent.click(modeY);

    const last = configs.at(-1)!;
    expect(last.locked).toBe("0");
    expect(last.gain).toBe("0");
    expect(last.mode).toBe("y");
    expect(last.preset).toBe("custom");
    expect(configStoreId(spec)).toBe("settings-fixture");
    host.remove();
  });
});
