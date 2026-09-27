import { beforeEach, describe, expect, it } from "vitest";
import { NEST_NO_CAMERAS } from "../plugins/pack-shared-copy";
import { Settings } from "../ui/settings";

function cameraChipButtons(root: ParentNode): HTMLButtonElement[] {
  const fields = [...root.querySelectorAll<HTMLElement>(".nest-cam-field")];
  const cameras = fields.find((f) => f.querySelector(".subcap")?.textContent === "cameras");
  if (!cameras) return [];
  return [...cameras.querySelectorAll<HTMLButtonElement>("button")];
}

describe("nest cams drawer empty devices", () => {
  beforeEach(() => {
    expect.hasAssertions();
    localStorage.clear();
  });

  it("hides camera chips and shows account empty copy when Device Access lists no cameras", () => {
    const s = new Settings({ storePrefix: "zoto-nest-empty-devices", onChange: () => {} });
    document.body.append(s.el);
    s.bindView({ id: "nest-cams", packName: "Nest cams", version: 1, engine: "graph" });
    s.openView();
    s.setNestDevices([]);
    const viewPane = s.el.querySelector('[data-pane="view"]');
    expect(viewPane).toBeTruthy();
    expect(cameraChipButtons(viewPane!)).toHaveLength(0);
    const status = [...viewPane!.querySelectorAll<HTMLElement>(".nest-cam-empty")];
    expect(status).toHaveLength(1);
    expect(status[0]!.textContent).toBe(NEST_NO_CAMERAS);
    expect(status[0]!.classList.contains("fail")).toBe(false);
    s.el.remove();
  });
});
